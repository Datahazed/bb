import {
  getCommandAttempt,
  getCommand,
  listLegacyTerminalizedExpiredLifecycleCommandsNeedingSettlement,
  reportCommandResult,
  type ExpiredCommandAttempt,
  type HostDaemonCommandRow,
} from "@bb/db";
import type { AppDeps } from "../../types.js";
import {
  buildCommandResultSettlementDeps,
  type CommandResultSideEffectReport,
} from "../../internal/command-result-side-effects.js";
import {
  dispatchCommandResultPostCommitActions,
  handleCommandResultSideEffects,
} from "../../internal/command-results.js";
import { NotificationBuffer } from "../lib/notification-buffer.js";
import { EngineDispatchBuffer } from "../engine/engine-dispatch.js";

const EXPIRED_COMMAND_ERROR_CODE = "command_expired";
const EXPIRED_COMMAND_ERROR_MESSAGE = "Command expired after retry";
const LEGACY_EXPIRED_COMMAND_ATTEMPT_ID = "legacy-expired";
const LEGACY_TERMINALIZED_EXPIRED_LIFECYCLE_SETTLEMENT_BATCH_SIZE = 100;

type ExpiredCommandDeps = Pick<
  AppDeps,
  | "config"
  | "db"
  | "engineDispatch"
  | "hub"
  | "lifecycleDedupers"
  | "logger"
  | "machineAuth"
  | "pendingInteractions"
  | "terminalSessions"
>;

export interface LegacyTerminalizedExpiredLifecycleSettlementResult {
  hasMore: boolean;
  settled: number;
}

interface BuildExpiredCommandFailureReportArgs {
  attemptId: string;
  command: Pick<HostDaemonCommandRow, "id" | "type">;
  completedAt: number;
}

function buildExpiredCommandFailureReport(
  args: BuildExpiredCommandFailureReportArgs,
): CommandResultSideEffectReport {
  return {
    attemptId: args.attemptId,
    commandId: args.command.id,
    completedAt: args.completedAt,
    errorCode: EXPIRED_COMMAND_ERROR_CODE,
    errorMessage: EXPIRED_COMMAND_ERROR_MESSAGE,
    ok: false,
    type: args.command.type,
  };
}

async function settleLegacyTerminalizedExpiredLifecycleCommand(
  deps: ExpiredCommandDeps,
  commandRow: HostDaemonCommandRow,
): Promise<void> {
  const notificationBuffer = new NotificationBuffer();
  const engineDispatches = new EngineDispatchBuffer();
  const failureReport = buildExpiredCommandFailureReport({
    attemptId: LEGACY_EXPIRED_COMMAND_ATTEMPT_ID,
    command: commandRow,
    completedAt: commandRow.completedAt ?? Date.now(),
  });
  const sideEffects = deps.db.transaction(
    (tx) =>
      handleCommandResultSideEffects(
        buildCommandResultSettlementDeps({
          db: tx,
          deps,
          engineDispatches,
          hub: notificationBuffer,
        }),
        failureReport,
        commandRow,
      ),
    { behavior: "immediate" },
  );
  notificationBuffer.flushInto(deps.hub);
  engineDispatches.flushInto(deps.engineDispatch);
  deps.hub.recordCommandResult(commandRow.id, {
    commandId: commandRow.id,
    errorCode: EXPIRED_COMMAND_ERROR_CODE,
    errorMessage: EXPIRED_COMMAND_ERROR_MESSAGE,
    ok: false,
    type: commandRow.type,
  });
  await dispatchCommandResultPostCommitActions({
    actions: sideEffects.postCommitActions,
    command: commandRow,
    deps,
    mode: "inline",
  });
}

export async function handleExpiredCommands(
  deps: ExpiredCommandDeps,
  args: {
    commands: ExpiredCommandAttempt[];
  },
): Promise<void> {
  for (const expired of args.commands) {
    await settleExpiredCommandAttempt(deps, expired);
  }
}

async function settleExpiredCommandAttempt(
  deps: ExpiredCommandDeps,
  args: ExpiredCommandAttempt,
): Promise<void> {
  const notificationBuffer = new NotificationBuffer();
  const engineDispatches = new EngineDispatchBuffer();
  const settlement = deps.db.transaction(
    (tx) => {
      const commandRow = getCommand(tx, args.commandId);
      if (
        !commandRow ||
        commandRow.state === "success" ||
        commandRow.state === "error"
      ) {
        return null;
      }

      const expiredAttempt = getCommandAttempt(tx, {
        attemptId: args.attemptId,
        commandId: args.commandId,
      });
      if (!expiredAttempt || expiredAttempt.status !== "expired") {
        return null;
      }

      const completedAt = expiredAttempt.settledAt ?? Date.now();
      const failureReport = buildExpiredCommandFailureReport({
        attemptId: expiredAttempt.id,
        command: commandRow,
        completedAt,
      });
      const sideEffects = handleCommandResultSideEffects(
        buildCommandResultSettlementDeps({
          db: tx,
          deps,
          engineDispatches,
          hub: notificationBuffer,
        }),
        failureReport,
        commandRow,
      );
      const updated = reportCommandResult(tx, notificationBuffer, {
        commandId: commandRow.id,
        state: "error",
        completedAt,
        resultPayload: JSON.stringify({
          errorCode: EXPIRED_COMMAND_ERROR_CODE,
          errorMessage: EXPIRED_COMMAND_ERROR_MESSAGE,
        }),
      });
      if (!updated) {
        throw new Error(
          `Command ${commandRow.id} disappeared during expired attempt settlement`,
        );
      }

      return {
        command: commandRow,
        postCommitActions: sideEffects.postCommitActions,
      };
    },
    { behavior: "immediate" },
  );

  if (!settlement) {
    return;
  }

  notificationBuffer.flushInto(deps.hub);
  engineDispatches.flushInto(deps.engineDispatch);
  deps.hub.recordCommandResult(settlement.command.id, {
    commandId: settlement.command.id,
    errorCode: EXPIRED_COMMAND_ERROR_CODE,
    errorMessage: EXPIRED_COMMAND_ERROR_MESSAGE,
    ok: false,
    type: settlement.command.type,
  });
  await dispatchCommandResultPostCommitActions({
    actions: settlement.postCommitActions,
    command: settlement.command,
    deps,
    mode: "schedule-after-daemon-ingress",
  });
}

/**
 * Repairs rows written by old expired-command sweeps that marked lifecycle
 * commands terminal before owner side effects ran. New expirations go through
 * handleExpiredCommands and do not enter this path.
 */
export async function settleLegacyTerminalizedExpiredLifecycleCommands(
  deps: ExpiredCommandDeps,
): Promise<LegacyTerminalizedExpiredLifecycleSettlementResult> {
  const commandIds =
    listLegacyTerminalizedExpiredLifecycleCommandsNeedingSettlement(deps.db, {
      limit: LEGACY_TERMINALIZED_EXPIRED_LIFECYCLE_SETTLEMENT_BATCH_SIZE + 1,
    });
  const commandIdsToSettle = commandIds.slice(
    0,
    LEGACY_TERMINALIZED_EXPIRED_LIFECYCLE_SETTLEMENT_BATCH_SIZE,
  );
  let settled = 0;

  for (const commandId of commandIdsToSettle) {
    const commandRow = getCommand(deps.db, commandId);
    if (!commandRow) {
      continue;
    }

    await settleLegacyTerminalizedExpiredLifecycleCommand(deps, commandRow);
    settled += 1;
  }

  return {
    hasMore: commandIds.length > commandIdsToSettle.length,
    settled,
  };
}

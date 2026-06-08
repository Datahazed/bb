import { and, eq, isNull, ne } from "drizzle-orm";
import {
  getEnvironment,
  threads,
  type DbNotifier,
  type DbQueryConnection,
  type DbTransaction,
} from "@bb/db";
import {
  cancelEnvironmentOperationRecord,
  setEnvironmentStatus,
} from "@bb/db/internal-environment-lifecycle";
import type { Environment } from "@bb/domain";
import type { EnvironmentProvisionCancelCommand } from "@bb/host-daemon-contract";
import type { AppDeps } from "../../types.js";
import type { EngineDispatchBuffer } from "../engine/engine-dispatch.js";
import { getActiveEnvironmentProvisionOperation } from "./environment-provisioning-operations.js";

export interface EnvironmentProvisionCancellationReadDeps {
  db: DbQueryConnection;
}

interface EnvironmentProvisionCancellationWriteDeps extends EnvironmentProvisionCancellationReadDeps {
  hub: DbNotifier;
}

interface EnvironmentProvisionCancellationTransactionDeps extends EnvironmentProvisionCancellationWriteDeps {
  db: DbTransaction;
  engineDispatch: AppDeps["engineDispatch"];
  /** Follow-up dispatches staged in-transaction; flushed by the tx owner. */
  engineDispatches: EngineDispatchBuffer;
}

interface CancelEnvironmentProvisioningForThreadStopArgs {
  environmentId: string;
  threadId: string;
}

export type EnvironmentProvisioningCancellationForThreadStopResult =
  | "awaiting_host_cancel"
  | "ready_to_finalize";

function hasOtherLiveThreadDependingOnEnvironmentProvision(
  deps: EnvironmentProvisionCancellationReadDeps,
  args: CancelEnvironmentProvisioningForThreadStopArgs,
): boolean {
  const row = deps.db
    .select({ id: threads.id })
    .from(threads)
    .where(
      and(
        eq(threads.environmentId, args.environmentId),
        ne(threads.id, args.threadId),
        isNull(threads.archivedAt),
        isNull(threads.deletedAt),
        isNull(threads.stopRequestedAt),
      ),
    )
    .limit(1)
    .get();
  return row !== undefined;
}

function restoreEnvironmentAfterProvisionCancellation(
  deps: EnvironmentProvisionCancellationWriteDeps,
  environment: Environment,
): void {
  if (environment.status !== "provisioning") {
    return;
  }
  setEnvironmentStatus(deps.db, deps.hub, environment.id, {
    status: environment.path ? "ready" : "error",
  });
}

function stageEnvironmentProvisionCancelCommand(
  deps: EnvironmentProvisionCancellationTransactionDeps,
  environment: Environment,
): void {
  // Registry-backed dedupe: a cancel already running in the engine covers
  // this stop request too (the cancel settlement finalizes every
  // stop-requested thread on the environment).
  if (
    deps.engineDispatch.getInFlightEnvironmentCommandId({
      environmentId: environment.id,
      type: "environment.provision.cancel",
    }) !== null
  ) {
    return;
  }

  const command: EnvironmentProvisionCancelCommand = {
    type: "environment.provision.cancel",
    environmentId: environment.id,
  };
  deps.engineDispatches.stage({ command });
}

export function cancelEnvironmentProvisioningForThreadStopInTransaction(
  deps: EnvironmentProvisionCancellationTransactionDeps,
  args: CancelEnvironmentProvisioningForThreadStopArgs,
): EnvironmentProvisioningCancellationForThreadStopResult {
  const operation = getActiveEnvironmentProvisionOperation(
    deps,
    args.environmentId,
  );
  if (!operation) {
    return "ready_to_finalize";
  }

  if (hasOtherLiveThreadDependingOnEnvironmentProvision(deps, args)) {
    return "ready_to_finalize";
  }

  const environment = getEnvironment(deps.db, args.environmentId);
  if (!environment) {
    return "ready_to_finalize";
  }

  // An in-flight provision is in the engine's hands: dispatch a cancel and
  // defer finalization to the cancel settlement. The daemon-era "pending"
  // (queued-but-unfetched, cancellable by row deletion) branch died with the
  // durable queue — a dispatch the registry no longer tracks has settled, so
  // cancelling the op record is sufficient.
  if (deps.engineDispatch.isCommandInFlight(operation.commandId)) {
    stageEnvironmentProvisionCancelCommand(deps, environment);
    return "awaiting_host_cancel";
  }

  cancelEnvironmentOperationRecord(deps.db, {
    environmentId: operation.environmentId,
    kind: operation.kind,
  });
  restoreEnvironmentAfterProvisionCancellation(deps, environment);
  return "ready_to_finalize";
}

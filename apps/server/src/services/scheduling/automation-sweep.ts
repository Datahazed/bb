import {
  claimAutomationScheduledRun,
  type ClaimAutomationScheduledRunResult,
  type DueAutomationCursor,
  listDueAutomations,
  restoreAutomationAfterFailedRun,
} from "@bb/db";
import type { AutomationAction } from "@bb/server-contract";
import type { AppDeps } from "../../types.js";
import {
  type AutomationRow,
  parseAutomationAction,
  parseAutomationTriggerConfig,
} from "./automation-config.js";
import { computeNextScheduledTime } from "./schedule-helpers.js";
import { createThreadFromRequest } from "../threads/thread-create.js";
const DUE_AUTOMATION_BATCH_SIZE = 100;

interface SweepDueAutomationsArgs {
  now?: number;
}

interface AutomationExecutionContext {
  action: AutomationAction;
  nextRunAt: number;
}

function toDueAutomationCursor(automation: AutomationRow): DueAutomationCursor {
  if (automation.nextRunAt === null) {
    throw new Error(`Due automation ${automation.id} is missing nextRunAt`);
  }
  return {
    createdAt: automation.createdAt,
    id: automation.id,
    nextRunAt: automation.nextRunAt,
  };
}

function resolveAutomationExecutionContext(
  automation: AutomationRow,
  now: number,
): AutomationExecutionContext {
  const action = parseAutomationAction(automation.action);
  const trigger = parseAutomationTriggerConfig(automation.triggerConfig);
  const nextRunAt = computeNextScheduledTime({
    cron: trigger.cron,
    now,
    timezone: trigger.timezone,
  });
  return {
    action,
    nextRunAt,
  };
}

async function runAutomation(
  deps: Pick<
    AppDeps,
    | "config"
    | "db"
    | "engineDispatch"
    | "hub"
    | "lifecycleDedupers"
    | "logger"
  >,
  automation: AutomationRow,
  now: number,
): Promise<void> {
  let executionContext: AutomationExecutionContext;
  try {
    executionContext = resolveAutomationExecutionContext(automation, now);
  } catch (error) {
    deps.logger.error(
      {
        automationId: automation.id,
        err: error,
      },
      "Skipping automation with invalid stored configuration",
    );
    return;
  }

  const decision: ClaimAutomationScheduledRunResult =
    claimAutomationScheduledRun(deps.db, deps.hub, {
      automationId: automation.id,
      expectedNextRunAt: automation.nextRunAt,
      nextRunAt: executionContext.nextRunAt,
    });

  if (!decision.advanced) {
    return;
  }

  if (!decision.shouldCreateThread) {
    deps.logger.info(
      {
        automationId: automation.id,
        reason: decision.reason,
      },
      "Skipped due automation run",
    );
    return;
  }

  try {
    await createThreadFromRequest(deps, {
      ...executionContext.action.threadRequest,
      automationId: automation.id,
      origin: null,
      projectId: automation.projectId,
      type: "standard",
    });
  } catch (error) {
    const restored = restoreAutomationAfterFailedRun(deps.db, deps.hub, {
      automationId: automation.id,
      expectedAdvancedNextRunAt: executionContext.nextRunAt,
      expectedRunCount: automation.runCount + 1,
      projectId: automation.projectId,
      restoredLastRunAt: automation.lastRunAt,
      restoredNextRunAt: executionContext.nextRunAt,
      restoredRunCount: automation.runCount,
    });
    deps.logger.error(
      {
        automationId: automation.id,
        restored,
        err: error,
      },
      "Failed to create a thread for a due automation",
    );
  }
}

export async function sweepDueAutomations(
  deps: Pick<
    AppDeps,
    | "config"
    | "db"
    | "engineDispatch"
    | "hub"
    | "lifecycleDedupers"
    | "logger"
  >,
  args: SweepDueAutomationsArgs = {},
): Promise<void> {
  const now = args.now ?? Date.now();
  let after: DueAutomationCursor | undefined;
  while (true) {
    const dueAutomations = listDueAutomations(deps.db, {
      now,
      after,
      limit: DUE_AUTOMATION_BATCH_SIZE,
    });
    for (const automation of dueAutomations) {
      try {
        await runAutomation(deps, automation, now);
      } catch (error) {
        deps.logger.error(
          {
            automationId: automation.id,
            err: error,
          },
          "Failed to process a due automation",
        );
      }
    }
    if (dueAutomations.length < DUE_AUTOMATION_BATCH_SIZE) {
      return;
    }
    after = toDueAutomationCursor(dueAutomations[dueAutomations.length - 1]!);
  }
}

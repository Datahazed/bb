import { listProviderTurnIdleWatchdogCandidates } from "@bb/db";
import type { ProviderTurnIdleWatchdogCandidateRow } from "@bb/db";
import type { SystemProviderTurnWatchdogEventData } from "@bb/domain";
import { threadScope } from "@bb/domain";
import type { AppDeps } from "../../types.js";
import { appendThreadEvent } from "./thread-events.js";
import { requestThreadStop } from "./thread-lifecycle.js";

export const PROVIDER_TURN_IDLE_WATCHDOG_THRESHOLD_MS = 15 * 60_000;
export const PROVIDER_TURN_IDLE_WATCHDOG_BATCH_SIZE = 25;

export type ProviderTurnWatchdogSweepDeps = Pick<
  AppDeps,
  "db" | "engineDispatch" | "hub" | "logger"
>;

export interface RunProviderTurnWatchdogSweepOptions {
  idleThresholdMs?: number;
  limit?: number;
  now?: number;
}

export interface RunProviderTurnWatchdogSweepResult {
  interruptedThreadIds: string[];
}

interface BuildProviderTurnWatchdogEventDataArgs {
  idleThresholdMs: number;
  now: number;
}

function buildProviderTurnWatchdogEventData(
  candidate: ProviderTurnIdleWatchdogCandidateRow,
  args: BuildProviderTurnWatchdogEventDataArgs,
): SystemProviderTurnWatchdogEventData {
  return {
    reason: "provider-turn-idle",
    thresholdMs: args.idleThresholdMs,
    elapsedMs: candidate.elapsedMs,
    activeTurnId: candidate.activeTurnId,
    activeTurnStartedAt: candidate.activeTurnStartedAt,
    lastActivityEventSequence: candidate.lastActivityEventSequence,
    lastActivityEventType: candidate.lastActivityEventType,
    lastActivityEventAt: candidate.lastActivityEventAt,
    providerId: candidate.providerId,
    providerThreadId: candidate.providerThreadId,
    firedAt: args.now,
  };
}

export function runProviderTurnWatchdogSweep(
  deps: ProviderTurnWatchdogSweepDeps,
  options: RunProviderTurnWatchdogSweepOptions = {},
): RunProviderTurnWatchdogSweepResult {
  const now = options.now ?? Date.now();
  const idleThresholdMs =
    options.idleThresholdMs ?? PROVIDER_TURN_IDLE_WATCHDOG_THRESHOLD_MS;
  const candidates = listProviderTurnIdleWatchdogCandidates(deps.db, {
    idleThresholdMs,
    limit: options.limit ?? PROVIDER_TURN_IDLE_WATCHDOG_BATCH_SIZE,
    now,
  });
  const interruptedThreadIds: string[] = [];

  for (const candidate of candidates) {
    const data = buildProviderTurnWatchdogEventData(candidate, {
      idleThresholdMs,
      now,
    });

    try {
      appendThreadEvent(deps, {
        threadId: candidate.threadId,
        environmentId: candidate.environmentId,
        type: "system/provider-turn-watchdog",
        scope: threadScope(),
        data,
      });
      requestThreadStop(deps, {
        environmentId: candidate.environmentId,
        interruptionReason: "provider-turn-idle",
        stopRequestedAt: null,
        threadId: candidate.threadId,
      });
      interruptedThreadIds.push(candidate.threadId);
      deps.logger.warn(
        {
          activeTurnId: candidate.activeTurnId,
          elapsedMs: candidate.elapsedMs,
          idleThresholdMs,
          lastActivityEventSequence: candidate.lastActivityEventSequence,
          lastActivityEventType: candidate.lastActivityEventType,
          providerId: candidate.providerId,
          providerThreadId: candidate.providerThreadId,
          threadId: candidate.threadId,
        },
        "Provider turn watchdog requested thread stop after idle provider turn",
      );
    } catch (error) {
      deps.logger.warn(
        {
          err: error,
          threadId: candidate.threadId,
        },
        "Provider turn watchdog failed to request thread stop",
      );
    }
  }

  return { interruptedThreadIds };
}

import type { ThreadTimelineResponse } from "@bb/server-contract";

const THROTTLE_MIN_BUILD_MS = 100;
const THROTTLE_COST_MULTIPLIER = 4;
const THROTTLE_MAX_HOLD_MS = 10_000;
const MAX_ENTRIES = 64;

interface ThrottleEntry {
  buildMs: number;
  builtAt: number;
  maxSeq: number;
  response: ThreadTimelineResponse;
}

export interface TimelineRefreshThrottle {
  getStale(paramsKey: string, now?: number): ThreadTimelineResponse | null;
  record(
    paramsKey: string,
    response: ThreadTimelineResponse,
    buildMs: number,
    now?: number,
  ): void;
}

export function createTimelineRefreshThrottle(): TimelineRefreshThrottle {
  const entries = new Map<string, ThrottleEntry>();
  return {
    getStale(paramsKey, now = Date.now()) {
      const entry = entries.get(paramsKey);
      if (entry === undefined || entry.buildMs < THROTTLE_MIN_BUILD_MS) {
        return null;
      }
      const holdMs = Math.min(
        entry.buildMs * THROTTLE_COST_MULTIPLIER,
        THROTTLE_MAX_HOLD_MS,
      );
      return now - entry.builtAt < holdMs ? entry.response : null;
    },
    record(paramsKey, response, buildMs, now = Date.now()) {
      entries.delete(paramsKey);
      entries.set(paramsKey, {
        buildMs,
        builtAt: now,
        maxSeq: response.maxSeq,
        response,
      });
      while (entries.size > MAX_ENTRIES) {
        const oldest = entries.keys().next().value;
        if (oldest === undefined) {
          break;
        }
        entries.delete(oldest);
      }
    },
  };
}

import { getThread, listStoredThreadEventExtents } from "@bb/db";
import type { AppDeps } from "../../types.js";
import { runEventLoopWork } from "../system/event-loop-work.js";
import {
  buildThreadTimelineCooperatively,
  hasFreshPersistedTimelineProjection,
} from "./timeline.js";
import { resolveSummaryTimelineBuildOptions } from "./timeline-build-options.js";

type WarmupDeps = Pick<
  AppDeps,
  "config" | "db" | "logger" | "providerRegistry"
>;

/** Threads at or above this sequence are worth projecting ahead of a request. */
const WARMUP_MIN_LATEST_SEQUENCE = 1_000;

/**
 * Builds (and, for settled threads, persists) the default summary projection
 * of one thread with the same options the timeline route uses, so the next
 * request finds it cached instead of paying the cold build.
 */
export async function warmThreadTimeline(
  deps: WarmupDeps,
  threadId: string,
): Promise<void> {
  const thread = getThread(deps.db, threadId);
  if (!thread) {
    return;
  }
  const options = resolveSummaryTimelineBuildOptions(deps, thread);
  if (hasFreshPersistedTimelineProjection(deps.db, thread, options)) {
    return;
  }
  await runEventLoopWork(`timeline-warmup ${threadId}`, () =>
    buildThreadTimelineCooperatively(deps.db, thread, options),
  );
}

/**
 * Projects every large thread once after startup, largest first, so the
 * first open of a big thread after a restart or upgrade is served from the
 * persisted projection. Each build yields to the event loop between slices.
 */
export async function warmLargeThreadTimelines(deps: WarmupDeps): Promise<void> {
  const extents = listStoredThreadEventExtents(deps.db, {
    minLatestSequence: WARMUP_MIN_LATEST_SEQUENCE,
  });
  let warmed = 0;
  const startedAt = Date.now();
  for (const extent of extents) {
    try {
      await warmThreadTimeline(deps, extent.threadId);
      warmed += 1;
    } catch (error) {
      deps.logger.warn(
        { err: error, threadId: extent.threadId },
        "Timeline warmup failed for thread",
      );
    }
  }
  deps.logger.info(
    { candidates: extents.length, warmed, durationMs: Date.now() - startedAt },
    "Timeline warmup finished",
  );
}

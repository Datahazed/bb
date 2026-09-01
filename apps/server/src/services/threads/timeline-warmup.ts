import { getThread, listStoredThreadEventExtents } from "@bb/db";
import type { AppDeps } from "../../types.js";
import { runEventLoopWork } from "../system/event-loop-work.js";
import {
  buildThreadTimelineCooperatively,
  hasFreshPersistedTimelineProjection,
  LARGE_THREAD_MIN_EVENT_COUNT,
} from "./timeline.js";
import { resolveSummaryTimelineBuildOptions } from "./timeline-build-options.js";

type WarmupDeps = Pick<
  AppDeps,
  "config" | "db" | "logger" | "providerRegistry"
>;

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
 * Re-projects the given threads one after another, off the request path.
 * Used after sweeps that rewrite stored events in place, which invalidate
 * the threads' cached and persisted projections.
 */
export async function warmThreadTimelines(
  deps: WarmupDeps,
  threadIds: readonly string[],
): Promise<void> {
  for (const threadId of threadIds) {
    try {
      await warmThreadTimeline(deps, threadId);
    } catch (error) {
      deps.logger.warn(
        { err: error, threadId },
        "Timeline refresh after event rewrite failed",
      );
    }
  }
}

/**
 * Projects every large thread once after startup, largest first, so the
 * first open of a big thread after a restart or upgrade is served from the
 * persisted projection. Each build yields to the event loop between slices.
 */
export async function warmLargeThreadTimelines(deps: WarmupDeps): Promise<void> {
  const extents = listStoredThreadEventExtents(deps.db, {
    minEventCount: LARGE_THREAD_MIN_EVENT_COUNT,
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

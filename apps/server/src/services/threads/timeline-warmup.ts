import {
  getLatestStoredEventTip,
  getLatestThreadSequence,
  getThread,
  listThreadIds,
} from "@bb/db";
import type { AppDeps } from "../../types.js";
import { runEventLoopWork } from "../system/event-loop-work.js";
import {
  buildThreadTimelineCooperatively,
  hasFreshPersistedTimelineProjection,
  LARGE_THREAD_MIN_EVENT_COUNT,
  yieldToEventLoop,
} from "./timeline.js";
import { resolveSummaryTimelineBuildOptions } from "./timeline-build-options.js";

type WarmupDeps = Pick<
  AppDeps,
  "config" | "db" | "logger" | "providerRegistry"
>;

export async function warmThreadTimeline(
  deps: WarmupDeps,
  threadId: string,
  cooperative: { forceRebuild?: boolean } = {},
): Promise<void> {
  await deps.providerRegistry.whenRegistrationsSettled();
  const thread = getThread(deps.db, threadId);
  if (!thread) {
    return;
  }
  const options = resolveSummaryTimelineBuildOptions(deps, thread);
  if (
    !cooperative.forceRebuild &&
    hasFreshPersistedTimelineProjection(deps.db, thread, options)
  ) {
    return;
  }
  await runEventLoopWork(`timeline-warmup ${threadId}`, () =>
    buildThreadTimelineCooperatively(deps.db, thread, options, cooperative),
  );
}

export async function rebuildThreadTimelines(
  deps: WarmupDeps,
  threadIds: readonly string[],
): Promise<void> {
  for (const threadId of threadIds) {
    try {
      await warmThreadTimeline(deps, threadId, { forceRebuild: true });
    } catch (error) {
      deps.logger.warn(
        { err: error, threadId },
        "Timeline refresh after event rewrite failed",
      );
    }
  }
}

async function listLargeThreadIds(deps: WarmupDeps): Promise<string[]> {
  const candidates: { eventCount: number; threadId: string }[] = [];
  let probed = 0;
  for (const threadId of listThreadIds(deps.db)) {
    if (
      getLatestThreadSequence(deps.db, { threadId }) <
      LARGE_THREAD_MIN_EVENT_COUNT
    ) {
      continue;
    }
    const tip = getLatestStoredEventTip(deps.db, { threadId });
    if (tip !== null && tip.eventCount >= LARGE_THREAD_MIN_EVENT_COUNT) {
      candidates.push({ eventCount: tip.eventCount, threadId });
    }
    probed += 1;
    if (probed % 10 === 0) {
      await yieldToEventLoop();
    }
  }
  return candidates
    .sort((a, b) => b.eventCount - a.eventCount)
    .map((candidate) => candidate.threadId);
}

export async function warmLargeThreadTimelines(
  deps: WarmupDeps,
): Promise<void> {
  const startedAt = Date.now();
  await deps.providerRegistry.whenRegistrationsSettled();
  const threadIds = await listLargeThreadIds(deps);
  let warmed = 0;
  for (const threadId of threadIds) {
    try {
      await warmThreadTimeline(deps, threadId);
      warmed += 1;
    } catch (error) {
      deps.logger.warn(
        { err: error, threadId },
        "Timeline warmup failed for thread",
      );
    }
  }
  deps.logger.info(
    { candidates: threadIds.length, warmed, durationMs: Date.now() - startedAt },
    "Timeline warmup finished",
  );
}

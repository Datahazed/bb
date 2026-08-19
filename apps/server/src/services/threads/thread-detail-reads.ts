import { getStoredThreadTabs, listQueuedThreadMessages } from "@bb/db";
import type { ResolvedThreadExecutionOptions } from "@bb/domain";
import {
  threadTabsSchema,
  type ThreadQueuedMessageListResponse,
  type ThreadTabsResponse,
} from "@bb/server-contract";
import type { AppDeps } from "../../types.js";
import { tryResolveExistingThreadExecutionPlan } from "./thread-execution-plan.js";
import { toThreadQueuedMessage } from "./thread-queued-messages.js";

// Per-thread reads shared by their stand-alone routes and by
// `GET /threads/:id?include=`. Both surfaces call the same reader so a
// bundled field and its route never diverge.

export function readThreadQueuedMessages(
  deps: Pick<AppDeps, "db">,
  threadId: string,
): ThreadQueuedMessageListResponse {
  return listQueuedThreadMessages(deps.db, threadId).map(toThreadQueuedMessage);
}

export async function readThreadDefaultExecutionOptions(
  deps: Pick<AppDeps, "db" | "providerRegistry">,
  threadId: string,
): Promise<ResolvedThreadExecutionOptions | null> {
  const plan = await tryResolveExistingThreadExecutionPlan(deps, {
    executionSource: "client/turn/requested",
    input: {},
    threadId,
  });
  return plan?.defaultView ?? null;
}

export function readThreadTabs(
  deps: Pick<AppDeps, "db">,
  threadId: string,
): ThreadTabsResponse {
  const stored = getStoredThreadTabs(deps.db, threadId);
  if (!stored) {
    return { revision: 0, tabs: [] };
  }

  const parsedJson: unknown = JSON.parse(stored.tabsJson);
  return {
    revision: stored.revision,
    tabs: threadTabsSchema.parse(parsedJson),
  };
}

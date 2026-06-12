import type { ThreadListEntry } from "@bb/domain";
import { compareCodepoint } from "@/lib/codepoint-compare";
import {
  buildProjectThreadGroups,
  type ProjectThreadItem,
  type ProjectThreadNode,
} from "./projectThreadGroups";

export interface PinnedSidebarState {
  effectivePinnedThreadIds: Set<string>;
  threadNodes: ProjectThreadNode[];
}

interface BuildPinnedSidebarStateArgs {
  threads: readonly ThreadListEntry[];
}

function compareByPinnedFallback(
  left: ThreadListEntry,
  right: ThreadListEntry,
): number {
  const pinnedAtDelta = (right.pinnedAt ?? 0) - (left.pinnedAt ?? 0);
  if (pinnedAtDelta !== 0) {
    return pinnedAtDelta;
  }

  const createdAtDelta = right.createdAt - left.createdAt;
  if (createdAtDelta !== 0) {
    return createdAtDelta;
  }

  return compareCodepoint(left.id, right.id);
}

function comparePinnedThreads(
  left: ThreadListEntry,
  right: ThreadListEntry,
): number {
  if (left.pinSortKey !== null && right.pinSortKey !== null) {
    const pinSortKeyDelta = compareCodepoint(left.pinSortKey, right.pinSortKey);
    if (pinSortKeyDelta !== 0) {
      return pinSortKeyDelta;
    }
  }

  return compareByPinnedFallback(left, right);
}

function collectThreadNodes(
  items: readonly ProjectThreadItem[],
): ProjectThreadNode[] {
  return items.flatMap((item) =>
    item.kind === "thread" ? [item.node] : item.group.nodes,
  );
}

export function buildPinnedSidebarState({
  threads,
}: BuildPinnedSidebarStateArgs): PinnedSidebarState {
  const explicitlyPinnedThreads = threads.filter(
    (thread) => thread.pinnedAt !== null,
  );

  const effectivePinnedThreadIds = new Set(
    explicitlyPinnedThreads.map((thread) => thread.id),
  );
  const groupedPinnedItems = buildProjectThreadGroups(explicitlyPinnedThreads);
  const threadNodes = collectThreadNodes(groupedPinnedItems);
  threadNodes.sort((left, right) =>
    comparePinnedThreads(left.thread, right.thread),
  );

  return {
    effectivePinnedThreadIds,
    threadNodes,
  };
}

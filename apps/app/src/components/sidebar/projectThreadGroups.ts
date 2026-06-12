import type {
  EnvironmentWorkspaceDisplayKind,
  ThreadListEntry,
} from "@bb/domain";
import { compareCodepoint } from "@/lib/codepoint-compare";
import {
  getCollapsedChildActivity,
  type CollapsedChildActivity,
} from "@/lib/thread-activity";

export interface EnvironmentThreadGroupStats {
  childActivity: CollapsedChildActivity;
}

export interface ProjectThreadNode {
  thread: ThreadListEntry;
}

export type EnvironmentThreadGroupNodes = [
  ProjectThreadNode,
  ProjectThreadNode,
  ...ProjectThreadNode[],
];

export interface EnvironmentThreadGroup {
  environmentId: string;
  nodes: EnvironmentThreadGroupNodes;
  stats: EnvironmentThreadGroupStats;
}

// A single render slot in a thread sibling list. Threads and env groups
// interleave by recency, so renderers iterate one ordered list rather than two
// parallel arrays.
export type ProjectThreadItem =
  | { kind: "thread"; node: ProjectThreadNode }
  | { kind: "environment"; group: EnvironmentThreadGroup };

type WorktreeDisplayKind = "managed-worktree" | "unmanaged-worktree";

interface BuildThreadNodeArgs {
  thread: ThreadListEntry;
}

interface BucketWorktreeEnvironmentGroupsResult {
  environmentThreadGroups: EnvironmentThreadGroup[];
  looseNodes: ProjectThreadNode[];
}

function isWorktreeDisplayKind(
  kind: EnvironmentWorkspaceDisplayKind,
): kind is WorktreeDisplayKind {
  return kind === "managed-worktree" || kind === "unmanaged-worktree";
}

function compareByCreatedAtDescending(
  left: ThreadListEntry,
  right: ThreadListEntry,
): number {
  const createdAtDelta = right.createdAt - left.createdAt;
  if (createdAtDelta !== 0) {
    return createdAtDelta;
  }

  return compareCodepoint(left.id, right.id);
}

function compareByLatestAttentionAtDescending(
  left: ThreadListEntry,
  right: ThreadListEntry,
): number {
  const latestAttentionAtDelta =
    right.latestAttentionAt - left.latestAttentionAt;
  if (latestAttentionAtDelta !== 0) {
    return latestAttentionAtDelta;
  }

  return compareByCreatedAtDescending(left, right);
}

function compareStandardThreads(
  left: ThreadListEntry,
  right: ThreadListEntry,
): number {
  // Use durable thread.status for the active bucket, not ephemeral runtime
  // display state. Active rows stream frequent updates, so pin their position
  // to createdAt; inactive rows use attention recency so read/archive metadata
  // updates do not reshuffle the sidebar.
  const leftIsActive = left.status === "active";
  const rightIsActive = right.status === "active";

  if (leftIsActive !== rightIsActive) {
    return leftIsActive ? -1 : 1;
  }

  if (leftIsActive) {
    return compareByCreatedAtDescending(left, right);
  }

  return compareByLatestAttentionAtDescending(left, right);
}

function representativeThread(item: ProjectThreadItem): ThreadListEntry {
  return item.kind === "thread" ? item.node.thread : item.group.nodes[0].thread;
}

function compareProjectThreadItems(
  left: ProjectThreadItem,
  right: ProjectThreadItem,
): number {
  return compareStandardThreads(
    representativeThread(left),
    representativeThread(right),
  );
}

function buildStatsForHiddenThreads(
  threads: readonly ThreadListEntry[],
): EnvironmentThreadGroupStats {
  return {
    childActivity: getCollapsedChildActivity(threads),
  };
}

function buildEnvironmentThreadGroup(
  environmentId: string,
  nodes: EnvironmentThreadGroupNodes,
): EnvironmentThreadGroup {
  const hiddenThreads = nodes.map((node) => node.thread);
  return {
    environmentId,
    nodes,
    stats: buildStatsForHiddenThreads(hiddenThreads),
  };
}

function buildThreadItem(node: ProjectThreadNode): ProjectThreadItem {
  return { kind: "thread", node };
}

function buildEnvironmentItem(
  group: EnvironmentThreadGroup,
): ProjectThreadItem {
  return { kind: "environment", group };
}

function buildSortedItems(nodes: ProjectThreadNode[]): ProjectThreadItem[] {
  const { environmentThreadGroups, looseNodes } =
    bucketWorktreeEnvironmentGroups(nodes);
  const items = [
    ...looseNodes.map(buildThreadItem),
    ...environmentThreadGroups.map(buildEnvironmentItem),
  ];
  items.sort(compareProjectThreadItems);
  return items;
}

function buildThreadNode({
  thread,
}: BuildThreadNodeArgs): ProjectThreadNode {
  return {
    thread,
  };
}

export function buildProjectThreadGroups(
  projectThreads: readonly ThreadListEntry[],
): ProjectThreadItem[] {
  const threadNodes: ProjectThreadNode[] = [];

  for (const thread of projectThreads) {
    threadNodes.push(buildThreadNode({ thread }));
  }

  return buildSortedItems(threadNodes);
}

// Bucket nodes by shared worktree environmentId. A bucket only becomes a group
// when >=2 sibling nodes share the environment; solo threads stay loose so we
// don't render degenerate 1-thread groups.
function bucketWorktreeEnvironmentGroups(
  nodes: ProjectThreadNode[],
): BucketWorktreeEnvironmentGroupsResult {
  const nodesByEnvironmentId = new Map<string, ProjectThreadNode[]>();
  for (const node of nodes) {
    if (node.thread.environmentId === null) continue;
    if (!isWorktreeDisplayKind(node.thread.environmentWorkspaceDisplayKind)) {
      continue;
    }
    const bucket = nodesByEnvironmentId.get(node.thread.environmentId);
    if (bucket) {
      bucket.push(node);
    } else {
      nodesByEnvironmentId.set(node.thread.environmentId, [node]);
    }
  }

  const groupedEnvironmentIds = new Set<string>();
  const environmentThreadGroups: EnvironmentThreadGroup[] = [];
  for (const [environmentId, bucket] of nodesByEnvironmentId) {
    if (!hasAtLeastTwoThreadNodes(bucket)) continue;
    bucket.sort((left, right) =>
      compareStandardThreads(left.thread, right.thread),
    );
    groupedEnvironmentIds.add(environmentId);
    environmentThreadGroups.push(buildEnvironmentThreadGroup(environmentId, bucket));
  }

  const looseNodes = nodes.filter(
    (node) =>
      node.thread.environmentId === null ||
      !groupedEnvironmentIds.has(node.thread.environmentId),
  );
  looseNodes.sort((left, right) =>
    compareStandardThreads(left.thread, right.thread),
  );

  return { environmentThreadGroups, looseNodes };
}

function hasAtLeastTwoThreadNodes(
  nodes: ProjectThreadNode[],
): nodes is EnvironmentThreadGroupNodes {
  return nodes.length >= 2;
}

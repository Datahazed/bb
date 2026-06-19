import type {
  EnvironmentWorkspaceDisplayKind,
  ThreadListEntry,
} from "@bb/domain";
import { compareCodepoint } from "@/lib/codepoint-compare";
import {
  getCollapsedChildActivity,
  type CollapsedChildActivity,
} from "@/lib/thread-activity";
import { buildFolderKey, parseThreadFolderPath } from "./folderPath";
import type { SidebarGroupBy } from "./sidebarCollapsedAtoms";

export interface ProjectThreadNodeStats {
  childCount: number;
  childActivity: CollapsedChildActivity;
}

export interface ProjectThreadNode {
  thread: ThreadListEntry;
  children: ProjectThreadItem[];
  depth: number;
  stats: ProjectThreadNodeStats;
}

export type EnvironmentThreadGroupNodes = [
  ProjectThreadNode,
  ProjectThreadNode,
  ...ProjectThreadNode[],
];

export interface EnvironmentThreadGroup {
  environmentId: string;
  nodes: EnvironmentThreadGroupNodes;
  stats: ProjectThreadNodeStats;
}

// A derived folder node (Group by: Folder). Folders are a pure rendering layer
// folded out of "/"-separated thread titles by bucketIntoFolders — never stored.
// A folder holds further items (threads, env groups, and nested folders) and
// rolls up its descendants' count + activity so a collapsed header can speak for
// them, mirroring a collapsed parent thread.
export interface SidebarFolderGroup {
  key: string; // `${containerId}::Work/Q3` — unique per project/section
  name: string; // leaf segment shown on the header ("Q3")
  path: string[]; // ["Work","Q3"]
  depth: number; // folder nesting depth (0 = first level), drives indentation
  items: ProjectThreadItem[];
  threadCount: number; // total descendant threads
  activity: CollapsedChildActivity; // rolled-up unread/working/pending
}

// A single render slot in a thread sibling list. Threads and env groups
// interleave by recency, so renderers iterate one ordered list rather than two
// parallel arrays. Folders join the same list only under Group by: Folder.
export type ProjectThreadItem =
  | { kind: "thread"; node: ProjectThreadNode }
  | { kind: "environment"; group: EnvironmentThreadGroup }
  | { kind: "folder"; group: SidebarFolderGroup };

// Opt-in folder grouping, threaded into the three assembly sites. `containerId`
// scopes folder identity to its section (a `proj_*` id, or the sentinels
// below). When groupBy is "none" each site early-returns its current output
// untouched — no folder logic runs.
export interface SidebarFolderOptions {
  groupBy: SidebarGroupBy;
  containerId: string;
}

// Container-id sentinels for the global (non-project) sections; project
// sections use their own `proj_*` id. These namespace folder keys and manual
// order so "Work" in one section never collides with "Work" in another.
export const CHRONOLOGICAL_CONTAINER_ID = "chronological";
export const PINNED_CONTAINER_ID = "pinned";

// Orders sibling threads. The default keeps active rows pinned to createdAt and
// inactive rows on attention recency; chronological mode can swap in a literal
// createdAt comparator instead.
export type ThreadComparator = (
  left: ThreadListEntry,
  right: ThreadListEntry,
) => number;

type WorktreeDisplayKind = "managed-worktree" | "unmanaged-worktree";
type SidebarProjectThreadShape = Pick<
  ThreadListEntry,
  "originKind" | "childOrigin"
>;

interface BuildThreadNodeArgs {
  ancestorThreadIds: ReadonlySet<string>;
  childrenByParentId: ReadonlyMap<string, readonly ThreadListEntry[]>;
  compareThreads: ThreadComparator;
  depth: number;
  thread: ThreadListEntry;
  visitedThreadIds: Set<string>;
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

export function compareByCreatedAtDescending(
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

export function compareStandardThreads(
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
  switch (item.kind) {
    case "thread":
      return item.node.thread;
    case "environment":
      return item.group.nodes[0].thread;
    case "folder":
      // Folders never reach this pre-bucket comparator path; fall back to the
      // first nested item's representative so the function stays total.
      return representativeThread(item.group.items[0]);
  }
}

function compareProjectThreadItems(
  left: ProjectThreadItem,
  right: ProjectThreadItem,
  compareThreads: ThreadComparator,
): number {
  return compareThreads(
    representativeThread(left),
    representativeThread(right),
  );
}

function getNodeAndDescendantThreads(
  node: ProjectThreadNode,
): ThreadListEntry[] {
  return [node.thread, ...getItemThreadDescendants(node.children)];
}

function getItemThreadDescendants(
  items: readonly ProjectThreadItem[],
): ThreadListEntry[] {
  return items.flatMap((item) => {
    switch (item.kind) {
      case "thread":
        return getNodeAndDescendantThreads(item.node);
      case "environment":
        return item.group.nodes.flatMap(getNodeAndDescendantThreads);
      case "folder":
        return getItemThreadDescendants(item.group.items);
    }
  });
}

function buildStatsForHiddenThreads(
  threads: readonly ThreadListEntry[],
): ProjectThreadNodeStats {
  return {
    childCount: threads.length,
    childActivity: getCollapsedChildActivity(threads),
  };
}

function buildEnvironmentThreadGroup(
  environmentId: string,
  nodes: EnvironmentThreadGroupNodes,
): EnvironmentThreadGroup {
  const hiddenThreads = nodes.flatMap(getNodeAndDescendantThreads);
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

function buildSortedItems(
  nodes: ProjectThreadNode[],
  compareThreads: ThreadComparator,
): ProjectThreadItem[] {
  const { environmentThreadGroups, looseNodes } =
    bucketWorktreeEnvironmentGroups(nodes, compareThreads);
  const items = [
    ...looseNodes.map(buildThreadItem),
    ...environmentThreadGroups.map(buildEnvironmentItem),
  ];
  items.sort((left, right) =>
    compareProjectThreadItems(left, right, compareThreads),
  );
  return items;
}

function buildThreadNode({
  ancestorThreadIds,
  childrenByParentId,
  compareThreads,
  depth,
  thread,
  visitedThreadIds,
}: BuildThreadNodeArgs): ProjectThreadNode {
  visitedThreadIds.add(thread.id);
  const nextAncestorThreadIds = new Set(ancestorThreadIds);
  nextAncestorThreadIds.add(thread.id);
  const childNodes: ProjectThreadNode[] = [];

  for (const childThread of childrenByParentId.get(thread.id) ?? []) {
    if (nextAncestorThreadIds.has(childThread.id)) continue;
    if (visitedThreadIds.has(childThread.id)) continue;

    childNodes.push(
      buildThreadNode({
        ancestorThreadIds: nextAncestorThreadIds,
        childrenByParentId,
        compareThreads,
        depth: depth + 1,
        thread: childThread,
        visitedThreadIds,
      }),
    );
  }

  const children = buildSortedItems(childNodes, compareThreads);
  return {
    thread,
    children,
    depth,
    stats: buildStatsForHiddenThreads(getItemThreadDescendants(children)),
  };
}

function isRootThread(
  thread: ThreadListEntry,
  projectThreadIds: ReadonlySet<string>,
): boolean {
  return (
    thread.parentThreadId === null ||
    !projectThreadIds.has(thread.parentThreadId)
  );
}

export function buildProjectThreadGroups(
  allProjectThreads: readonly ThreadListEntry[],
  compareThreads: ThreadComparator = compareStandardThreads,
  folderOptions?: SidebarFolderOptions,
): ProjectThreadItem[] {
  const projectThreads = allProjectThreads.filter(isSidebarProjectThread);
  const projectThreadIds = new Set(projectThreads.map((thread) => thread.id));
  const childrenByParentId = new Map<string, ThreadListEntry[]>();

  for (const thread of projectThreads) {
    if (thread.parentThreadId === null) continue;
    if (!projectThreadIds.has(thread.parentThreadId)) continue;

    const children = childrenByParentId.get(thread.parentThreadId);
    if (children) {
      children.push(thread);
    } else {
      childrenByParentId.set(thread.parentThreadId, [thread]);
    }
  }

  const visitedThreadIds = new Set<string>();
  const rootNodes: ProjectThreadNode[] = [];

  for (const thread of projectThreads) {
    if (!isRootThread(thread, projectThreadIds)) continue;
    if (visitedThreadIds.has(thread.id)) continue;

    rootNodes.push(
      buildThreadNode({
        ancestorThreadIds: new Set(),
        childrenByParentId,
        compareThreads,
        depth: 0,
        thread,
        visitedThreadIds,
      }),
    );
  }

  // Cycles have no natural root. Render any remaining cycle member once at the
  // project root and cut the back-edge when the walk reaches an ancestor.
  for (const thread of projectThreads) {
    if (visitedThreadIds.has(thread.id)) continue;

    rootNodes.push(
      buildThreadNode({
        ancestorThreadIds: new Set(),
        childrenByParentId,
        compareThreads,
        depth: 0,
        thread,
        visitedThreadIds,
      }),
    );
  }

  const rootItems = buildSortedItems(rootNodes, compareThreads);
  // Group by: None — return today's output untouched, no folder logic.
  if (folderOptions?.groupBy !== "folder") {
    return rootItems;
  }
  return bucketIntoFolders(rootItems, folderOptions.containerId, compareThreads);
}

// Flat ordering for the chronological "All Threads" bucket: one top-level row
// per thread, globally ordered by the chosen comparator. Unlike
// buildProjectThreadGroups this intentionally drops parent/child nesting and
// worktree grouping so every thread is visible (none hidden behind a collapsed
// parent) and the sort is global rather than per-sibling. Side chats are
// excluded to match buildProjectThreadGroups.
export function buildChronologicalThreadList(
  allThreads: readonly ThreadListEntry[],
  compareThreads: ThreadComparator = compareStandardThreads,
  folderOptions?: SidebarFolderOptions,
): ProjectThreadItem[] {
  const items = allThreads
    .filter(isSidebarProjectThread)
    .sort(compareThreads)
    .map(
      (thread): ProjectThreadItem => ({
        kind: "thread",
        node: {
          thread,
          children: [],
          depth: 0,
          stats: buildStatsForHiddenThreads([]),
        },
      }),
    );
  // Group by: None — flat globally-sorted list, no folder logic.
  if (folderOptions?.groupBy !== "folder") {
    return items;
  }
  return bucketIntoFolders(items, folderOptions.containerId, compareThreads);
}

export function isSidebarProjectThread(
  thread: SidebarProjectThreadShape,
): boolean {
  return (thread.originKind ?? thread.childOrigin) !== "side-chat";
}

// Bucket nodes by shared worktree environmentId. A bucket only becomes a group
// when >=2 sibling nodes share the environment; solo threads stay loose so we
// don't render degenerate 1-thread groups.
function bucketWorktreeEnvironmentGroups(
  nodes: ProjectThreadNode[],
  compareThreads: ThreadComparator,
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
      compareThreads(left.thread, right.thread),
    );
    groupedEnvironmentIds.add(environmentId);
    environmentThreadGroups.push(
      buildEnvironmentThreadGroup(environmentId, bucket),
    );
  }

  const looseNodes = nodes.filter(
    (node) =>
      node.thread.environmentId === null ||
      !groupedEnvironmentIds.has(node.thread.environmentId),
  );
  looseNodes.sort((left, right) =>
    compareThreads(left.thread, right.thread),
  );

  return { environmentThreadGroups, looseNodes };
}

function hasAtLeastTwoThreadNodes(
  nodes: ProjectThreadNode[],
): nodes is EnvironmentThreadGroupNodes {
  return nodes.length >= 2;
}

// ---------------------------------------------------------------------------
// Folder bucketing (Group by: Folder)
//
// A pure, opt-in layer that folds an already-built top-level item list into a
// nested folder tree derived from each top-level thread's "/"-separated title.
// Only top-level items form folders; a thread's own children and env groups
// keep nesting under its leaf exactly as today (a child's "/" is ignored). The
// active comparator still drives order — folders render as a block above loose
// items, and folders, their contents, and the loose block are each sorted
// recursively by the same comparator (folders by their representative
// descendant — the descendant that sorts first).
// ---------------------------------------------------------------------------

interface FolderBucket {
  subfolders: Map<string, FolderBucket>;
  items: ProjectThreadItem[];
}

function createFolderBucket(): FolderBucket {
  return { subfolders: new Map(), items: [] };
}

// The thread that orders an item among its siblings, and whose title decides
// its folder path: a thread/env item keeps today's representative; a folder
// uses the descendant thread that sorts first under the active comparator.
function getItemOrderingThread(
  item: ProjectThreadItem,
  compareThreads: ThreadComparator,
): ThreadListEntry {
  switch (item.kind) {
    case "thread":
      return item.node.thread;
    case "environment":
      return item.group.nodes[0].thread;
    case "folder":
      return getItemThreadDescendants(item.group.items).reduce((first, thread) =>
        compareThreads(thread, first) < 0 ? thread : first,
      );
  }
}

// The one sibling-ordering hook. Today it orders folders-first, each block by
// the active comparator (ties already handled inside the comparator's codepoint
// fallback). `parentKey` is unused here but is the seam Sort: None (manual
// order) swaps to a stored per-parent order; threading it now keeps that change
// from re-cutting the tree walk.
function orderSiblingItems(
  items: readonly ProjectThreadItem[],
  // Seam for Sort: None — manual order will key off this parent. Unused today.
  _parentKey: string,
  compareThreads: ThreadComparator,
): ProjectThreadItem[] {
  const decorated = items.map((item) => ({
    item,
    isFolder: item.kind === "folder",
    orderingThread: getItemOrderingThread(item, compareThreads),
  }));
  decorated.sort((left, right) => {
    if (left.isFolder !== right.isFolder) {
      return left.isFolder ? -1 : 1;
    }
    return compareThreads(left.orderingThread, right.orderingThread);
  });
  return decorated.map((entry) => entry.item);
}

function buildFolderGroup(
  containerId: string,
  path: string[],
  items: ProjectThreadItem[],
): SidebarFolderGroup {
  const descendantThreads = getItemThreadDescendants(items);
  return {
    key: buildFolderKey(containerId, path),
    name: path[path.length - 1],
    path,
    depth: path.length - 1,
    items,
    threadCount: descendantThreads.length,
    activity: getCollapsedChildActivity(descendantThreads),
  };
}

function buildFolderLevelItems(
  bucket: FolderBucket,
  containerId: string,
  parentPath: readonly string[],
  compareThreads: ThreadComparator,
): ProjectThreadItem[] {
  const folderItems: ProjectThreadItem[] = [];
  for (const [name, subBucket] of bucket.subfolders) {
    const path = [...parentPath, name];
    const childItems = buildFolderLevelItems(
      subBucket,
      containerId,
      path,
      compareThreads,
    );
    folderItems.push({
      kind: "folder",
      group: buildFolderGroup(containerId, path, childItems),
    });
  }
  const parentKey =
    parentPath.length === 0
      ? containerId
      : buildFolderKey(containerId, parentPath);
  return orderSiblingItems(
    [...folderItems, ...bucket.items],
    parentKey,
    compareThreads,
  );
}

// Fold a top-level item list into a nested folder tree. Items whose
// representative thread's title has no folder segment stay loose at the top
// level; the rest nest into the deepest folder of their path. No empty folders:
// a folder node exists only because >=1 item resolved into it.
export function bucketIntoFolders(
  items: readonly ProjectThreadItem[],
  containerId: string,
  compareThreads: ThreadComparator = compareStandardThreads,
): ProjectThreadItem[] {
  const root = createFolderBucket();
  for (const item of items) {
    const orderingThread = getItemOrderingThread(item, compareThreads);
    const { folders } = parseThreadFolderPath(orderingThread.title ?? "");
    let bucket = root;
    for (const segment of folders) {
      let next = bucket.subfolders.get(segment);
      if (!next) {
        next = createFolderBucket();
        bucket.subfolders.set(segment, next);
      }
      bucket = next;
    }
    bucket.items.push(item);
  }
  return buildFolderLevelItems(root, containerId, [], compareThreads);
}

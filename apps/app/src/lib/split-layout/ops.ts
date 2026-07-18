import type {
  LayoutNode,
  PaneContent,
  PaneNode,
  PaneTab,
  SplitLayout,
  SplitNode,
  SplitPath,
  SplitSide,
} from "./types";

export const MAX_PANES = 8;
// A sanity bound, not a UX budget: callers must still handle the no-op (and
// not navigate as if the open succeeded), but the bound is high enough that
// real usage never hits it.
export const MAX_TABS_PER_PANE = 16;

const MIN_SIZE = 0.15;
const MAX_SIZE = 0.85;
const SIZE_EPSILON = 1e-12;

export function clampSplitPairFraction(fraction: number): number {
  return Math.min(MAX_SIZE, Math.max(MIN_SIZE, fraction));
}

export function listPanes(root: LayoutNode): PaneNode[] {
  if (root.type === "pane") {
    return [root];
  }
  return root.children.flatMap(listPanes);
}

export function countPanes(root: LayoutNode): number {
  if (root.type === "pane") {
    return 1;
  }
  return root.children.reduce((count, child) => count + countPanes(child), 0);
}

export function findPane(root: LayoutNode, paneId: string): PaneNode | null {
  if (root.type === "pane") {
    return root.paneId === paneId ? root : null;
  }
  for (const child of root.children) {
    const pane = findPane(child, paneId);
    if (pane !== null) {
      return pane;
    }
  }
  return null;
}

/** The tab a pane currently renders. Normalized layouts always have a valid
 * active tab; the first-tab fallback covers transiently inconsistent input. */
export function activeTab(pane: PaneNode): PaneTab {
  const active = pane.tabs.find((tab) => tab.tabId === pane.activeTabId);
  const fallback = pane.tabs[0];
  if (active !== undefined) {
    return active;
  }
  if (fallback === undefined) {
    throw new Error("A pane must hold at least one tab");
  }
  return fallback;
}

export function activePaneContent(pane: PaneNode): PaneContent {
  return activeTab(pane).content;
}

export interface TabLocation {
  pane: PaneNode;
  tab: PaneTab;
}

export function listTabs(root: LayoutNode): TabLocation[] {
  return listPanes(root).flatMap((pane) =>
    pane.tabs.map((tab) => ({ pane, tab })),
  );
}

/**
 * View identity per content kind: two contents match when opening the second
 * should reveal the first instead of creating another view. Threads and diffs
 * are one-view-per-thread, terminals one-view-per-terminal, plugin panels one
 * view per panel (subpaths are navigation within it), and the compose page is
 * a singleton.
 */
export function contentMatches(a: PaneContent, b: PaneContent): boolean {
  if (a.kind !== b.kind) {
    return false;
  }
  switch (a.kind) {
    case "new-thread":
      return true;
    case "thread":
      return (
        b.kind === "thread" &&
        a.projectId === b.projectId &&
        a.threadId === b.threadId
      );
    case "plugin-panel":
      return (
        b.kind === "plugin-panel" &&
        a.pluginId === b.pluginId &&
        a.panelPath === b.panelPath
      );
    case "terminal":
      return b.kind === "terminal" && a.terminalId === b.terminalId;
    case "diff":
      return (
        b.kind === "diff" &&
        a.projectId === b.projectId &&
        a.threadId === b.threadId
      );
  }
}

/** Finds the tab whose content is the same view as `content`, anywhere in the
 * tree, for reveal-existing semantics. */
export function findContentTab(
  root: LayoutNode,
  content: PaneContent,
): TabLocation | null {
  return (
    listTabs(root).find(({ tab }) => contentMatches(tab.content, content)) ??
    null
  );
}

export function findPaneByThread(
  root: LayoutNode,
  projectId: string,
  threadId: string,
): PaneNode | null {
  return (
    findContentTab(root, { kind: "thread", projectId, threadId })?.pane ?? null
  );
}

export function findPaneByContent(
  root: LayoutNode,
  content: PaneContent,
): PaneNode | null {
  return findContentTab(root, content)?.pane ?? null;
}

function replacePaneNode(
  node: LayoutNode,
  paneId: string,
  replacement: LayoutNode,
): LayoutNode {
  if (node.type === "pane") {
    return node.paneId === paneId ? replacement : node;
  }
  return {
    ...node,
    children: node.children.map((child) =>
      replacePaneNode(child, paneId, replacement),
    ),
  };
}

function nextSequenceId(existingIds: ReadonlySet<string>, prefix: string) {
  let sequence = 1;
  while (existingIds.has(`${prefix}-${sequence}`)) {
    sequence += 1;
  }
  return `${prefix}-${sequence}`;
}

function nextPaneId(root: LayoutNode): string {
  return nextSequenceId(
    new Set(listPanes(root).map((pane) => pane.paneId)),
    "pane",
  );
}

function nextTabId(root: LayoutNode): string {
  return nextSequenceId(
    new Set(listTabs(root).map(({ tab }) => tab.tabId)),
    "tab",
  );
}

export function createPaneNode(
  paneId: string,
  tabId: string,
  content: PaneContent,
  options?: { preview?: boolean },
): PaneNode {
  return {
    type: "pane",
    paneId,
    tabs: [{ tabId, content, preview: options?.preview === true }],
    activeTabId: tabId,
  };
}

function splitDirection(side: SplitSide): SplitNode["dir"] {
  return side === "left" || side === "right" ? "row" : "col";
}

function insertPane(
  root: LayoutNode,
  targetPaneId: string,
  side: SplitSide,
  pane: PaneNode,
): LayoutNode {
  if (root.type === "pane") {
    if (root.paneId !== targetPaneId) {
      return root;
    }
    const paneComesFirst = side === "left" || side === "top";
    return {
      type: "split",
      dir: splitDirection(side),
      sizes: [0.5, 0.5],
      children: paneComesFirst ? [pane, root] : [root, pane],
    };
  }

  const directTargetIndex = root.children.findIndex(
    (child) => child.type === "pane" && child.paneId === targetPaneId,
  );
  const direction = splitDirection(side);
  if (root.dir === direction && directTargetIndex !== -1) {
    const insertionIndex =
      side === "left" || side === "top"
        ? directTargetIndex
        : directTargetIndex + 1;
    const children = [...root.children];
    children.splice(insertionIndex, 0, pane);
    return { ...root, children, sizes: equalSizes(children.length) };
  }

  const targetChildIndex = root.children.findIndex(
    (child) => findPane(child, targetPaneId) !== null,
  );
  if (targetChildIndex === -1) {
    return root;
  }
  return {
    ...root,
    children: root.children.map((child, index) =>
      index === targetChildIndex
        ? insertPane(child, targetPaneId, side, pane)
        : child,
    ),
  };
}

export function splitPane(
  layout: SplitLayout,
  targetPaneId: string,
  side: SplitSide,
  content: PaneContent,
): SplitLayout {
  if (
    countPanes(layout.root) >= MAX_PANES ||
    findPane(layout.root, targetPaneId) === null
  ) {
    return layout;
  }
  const pane = createPaneNode(
    nextPaneId(layout.root),
    nextTabId(layout.root),
    content,
  );
  return {
    root: insertPane(layout.root, targetPaneId, side, pane),
    focusedPaneId: pane.paneId,
  };
}

/** Replaces the pane's ACTIVE tab content in place: navigation within a view
 * (e.g. a thread pane navigating to another thread) rather than a new tab. */
export function replacePaneContent(
  layout: SplitLayout,
  paneId: string,
  content: PaneContent,
): SplitLayout {
  const pane = findPane(layout.root, paneId);
  if (pane === null) {
    return layout;
  }
  const active = activeTab(pane);
  const nextPane: PaneNode = {
    ...pane,
    tabs: pane.tabs.map((tab) =>
      tab.tabId === active.tabId ? { ...tab, content } : tab,
    ),
    activeTabId: active.tabId,
  };
  return {
    root: replacePaneNode(layout.root, paneId, nextPane),
    focusedPaneId: paneId,
  };
}

export interface OpenTabOptions {
  /** Open as the group's preview tab (replacing its current preview). */
  preview?: boolean;
}

/**
 * Opens `content` as a tab in `paneId`. If the same view already exists in the
 * target pane it is revealed (activated) instead of duplicated — callers
 * wanting tree-wide reveal check {@link findContentTab} first. A preview open
 * replaces the group's existing preview tab in its slot; a committed open
 * appends after the active tab.
 */
export function openTab(
  layout: SplitLayout,
  paneId: string,
  content: PaneContent,
  options?: OpenTabOptions,
): SplitLayout {
  const pane = findPane(layout.root, paneId);
  if (pane === null) {
    return layout;
  }
  // Stateful views never preview: a preview slot is silently destroyed by the
  // next single-click, which must not tear down a PTY view.
  const preview = options?.preview === true && content.kind !== "terminal";

  const existing = pane.tabs.find((tab) => contentMatches(tab.content, content));
  if (existing !== undefined) {
    const nextPane: PaneNode = {
      ...pane,
      // Re-opening a preview tab's view as committed commits it in place.
      tabs: pane.tabs.map((tab) =>
        tab.tabId === existing.tabId && !preview && tab.preview
          ? { ...tab, preview: false }
          : tab,
      ),
      activeTabId: existing.tabId,
    };
    return {
      root: replacePaneNode(layout.root, paneId, nextPane),
      focusedPaneId: paneId,
    };
  }

  if (preview) {
    const previewIndex = pane.tabs.findIndex((tab) => tab.preview);
    if (previewIndex !== -1) {
      const previewTab = pane.tabs[previewIndex];
      if (previewTab === undefined) {
        return layout;
      }
      const nextPane: PaneNode = {
        ...pane,
        tabs: pane.tabs.map((tab, index) =>
          index === previewIndex ? { ...tab, content } : tab,
        ),
        activeTabId: previewTab.tabId,
      };
      return {
        root: replacePaneNode(layout.root, paneId, nextPane),
        focusedPaneId: paneId,
      };
    }
  }

  if (pane.tabs.length >= MAX_TABS_PER_PANE) {
    return layout;
  }
  const tabId = nextTabId(layout.root);
  const activeIndex = pane.tabs.findIndex(
    (tab) => tab.tabId === pane.activeTabId,
  );
  const insertionIndex =
    activeIndex === -1 ? pane.tabs.length : activeIndex + 1;
  const tabs = [...pane.tabs];
  tabs.splice(insertionIndex, 0, { tabId, content, preview });
  const nextPane: PaneNode = { ...pane, tabs, activeTabId: tabId };
  return {
    root: replacePaneNode(layout.root, paneId, nextPane),
    focusedPaneId: paneId,
  };
}

export function activateTab(
  layout: SplitLayout,
  paneId: string,
  tabId: string,
): SplitLayout {
  const pane = findPane(layout.root, paneId);
  if (pane === null || !pane.tabs.some((tab) => tab.tabId === tabId)) {
    return layout;
  }
  return {
    root: replacePaneNode(layout.root, paneId, { ...pane, activeTabId: tabId }),
    focusedPaneId: paneId,
  };
}

/** Commits a preview tab (double-click / drag gestures). */
export function commitTab(
  layout: SplitLayout,
  paneId: string,
  tabId: string,
): SplitLayout {
  const pane = findPane(layout.root, paneId);
  if (pane === null) {
    return layout;
  }
  const target = pane.tabs.find((tab) => tab.tabId === tabId);
  if (target === undefined || !target.preview) {
    return layout;
  }
  const nextPane: PaneNode = {
    ...pane,
    tabs: pane.tabs.map((tab) =>
      tab.tabId === tabId ? { ...tab, preview: false } : tab,
    ),
  };
  return { ...layout, root: replacePaneNode(layout.root, paneId, nextPane) };
}

/**
 * Closes a tab. Closing a pane's last tab removes the pane (unless it is the
 * layout's only pane, which is refused like {@link removePane}). The active
 * tab falls to the neighbor that took the closed tab's index.
 */
export function closeTab(
  layout: SplitLayout,
  paneId: string,
  tabId: string,
): SplitLayout {
  const pane = findPane(layout.root, paneId);
  if (pane === null) {
    return layout;
  }
  const tabIndex = pane.tabs.findIndex((tab) => tab.tabId === tabId);
  if (tabIndex === -1) {
    return layout;
  }
  if (pane.tabs.length === 1) {
    return removePane(layout, paneId);
  }
  const tabs = pane.tabs.filter((tab) => tab.tabId !== tabId);
  const fallbackTab = tabs[Math.min(tabIndex, tabs.length - 1)];
  const nextPane: PaneNode = {
    ...pane,
    tabs,
    activeTabId:
      pane.activeTabId === tabId && fallbackTab !== undefined
        ? fallbackTab.tabId
        : pane.activeTabId,
  };
  return { ...layout, root: replacePaneNode(layout.root, paneId, nextPane) };
}

/**
 * Reorders a tab within its own group. Dragging is a commit gesture, so the
 * moved tab loses any preview state. `toIndex` is clamped to the tab list.
 */
export function reorderTab(
  layout: SplitLayout,
  paneId: string,
  tabId: string,
  toIndex: number,
): SplitLayout {
  const pane = findPane(layout.root, paneId);
  if (pane === null || !Number.isInteger(toIndex)) {
    return layout;
  }
  const fromIndex = pane.tabs.findIndex((tab) => tab.tabId === tabId);
  if (fromIndex === -1) {
    return layout;
  }
  const clampedIndex = Math.min(Math.max(toIndex, 0), pane.tabs.length - 1);
  const moved = pane.tabs[fromIndex];
  if (moved === undefined) {
    return layout;
  }
  if (clampedIndex === fromIndex && !moved.preview) {
    return layout;
  }
  const tabs = pane.tabs.filter((tab) => tab.tabId !== tabId);
  tabs.splice(clampedIndex, 0, { ...moved, preview: false });
  return {
    ...layout,
    root: replacePaneNode(layout.root, paneId, { ...pane, tabs }),
  };
}

export type TabDropTarget =
  | { type: "center"; targetPaneId: string }
  | { type: "side"; targetPaneId: string; side: SplitSide };

/**
 * Moves a tab between groups (center drop) or out into a new split (side
 * drop). Dragging always commits a preview tab. Moving a pane's last tab to a
 * side of itself is a no-op; moving it elsewhere dissolves the source pane.
 */
export function moveTab(
  layout: SplitLayout,
  sourcePaneId: string,
  tabId: string,
  target: TabDropTarget,
): SplitLayout {
  const sourcePane = findPane(layout.root, sourcePaneId);
  const tab = sourcePane?.tabs.find((candidate) => candidate.tabId === tabId);
  if (sourcePane === undefined || sourcePane === null || tab === undefined) {
    return layout;
  }
  const movedTab: PaneTab = { ...tab, preview: false };
  const sourceEmptiesOut = sourcePane.tabs.length === 1;

  if (target.type === "center") {
    if (target.targetPaneId === sourcePaneId) {
      // Same-group center drop just commits (reorder is out of scope for v1).
      return commitTab(layout, sourcePaneId, tabId);
    }
    const targetPane = findPane(layout.root, target.targetPaneId);
    if (
      targetPane === null ||
      targetPane.tabs.length >= MAX_TABS_PER_PANE
    ) {
      return layout;
    }
    let root = replacePaneNode(layout.root, target.targetPaneId, {
      ...targetPane,
      tabs: [...targetPane.tabs, movedTab],
      activeTabId: movedTab.tabId,
    });
    root = withTabRemoved(root, sourcePaneId, tabId);
    const collapsed = sourceEmptiesOut
      ? dropEmptyPane(root, sourcePaneId)
      : root;
    if (collapsed === null) {
      return layout;
    }
    return { root: collapsed, focusedPaneId: target.targetPaneId };
  }

  if (target.targetPaneId === sourcePaneId && sourceEmptiesOut) {
    return layout;
  }
  if (!sourceEmptiesOut && countPanes(layout.root) >= MAX_PANES) {
    return layout;
  }
  const newPane: PaneNode = {
    type: "pane",
    paneId: nextPaneId(layout.root),
    tabs: [movedTab],
    activeTabId: movedTab.tabId,
  };
  let root = withTabRemoved(layout.root, sourcePaneId, tabId);
  const collapsed = sourceEmptiesOut ? dropEmptyPane(root, sourcePaneId) : root;
  if (collapsed === null) {
    return layout;
  }
  root = insertPane(collapsed, target.targetPaneId, target.side, newPane);
  return { root, focusedPaneId: newPane.paneId };
}

function withTabRemoved(
  root: LayoutNode,
  paneId: string,
  tabId: string,
): LayoutNode {
  const pane = findPane(root, paneId);
  if (pane === null) {
    return root;
  }
  const tabIndex = pane.tabs.findIndex((tab) => tab.tabId === tabId);
  if (tabIndex === -1) {
    return root;
  }
  const tabs = pane.tabs.filter((tab) => tab.tabId !== tabId);
  const fallbackTab = tabs[Math.min(tabIndex, tabs.length - 1)];
  return replacePaneNode(root, paneId, {
    ...pane,
    tabs,
    activeTabId:
      pane.activeTabId === tabId && fallbackTab !== undefined
        ? fallbackTab.tabId
        : pane.activeTabId,
  });
}

/** Detaches a now-empty pane and collapses the tree; null when it can't. */
function dropEmptyPane(root: LayoutNode, paneId: string): LayoutNode | null {
  const result = detachPane(root, paneId);
  return result.detached === null ? root : result.node;
}

interface DetachResult {
  node: LayoutNode | null;
  detached: PaneNode | null;
}

function detachPane(node: LayoutNode, paneId: string): DetachResult {
  if (node.type === "pane") {
    return node.paneId === paneId
      ? { node: null, detached: node }
      : { node, detached: null };
  }

  for (let index = 0; index < node.children.length; index += 1) {
    const child = node.children[index];
    if (child === undefined) {
      continue;
    }
    const result = detachPane(child, paneId);
    if (result.detached === null) {
      continue;
    }
    if (result.node === null) {
      const children = node.children.filter(
        (_candidate, childIndex) => childIndex !== index,
      );
      if (children.length === 1) {
        return { node: children[0] ?? null, detached: result.detached };
      }
      return {
        node: {
          ...node,
          children,
          sizes: equalSizes(children.length),
        },
        detached: result.detached,
      };
    }
    return {
      node: {
        ...node,
        children: node.children.map((candidate, childIndex) =>
          childIndex === index ? (result.node ?? candidate) : candidate,
        ),
      },
      detached: result.detached,
    };
  }
  return { node, detached: null };
}

export function removePane(layout: SplitLayout, paneId: string): SplitLayout {
  const panesBefore = listPanes(layout.root);
  const removedIndex = panesBefore.findIndex((pane) => pane.paneId === paneId);
  if (panesBefore.length === 1 || removedIndex === -1) {
    return layout;
  }
  const result = detachPane(layout.root, paneId);
  if (result.node === null || result.detached === null) {
    return layout;
  }
  const panesAfter = listPanes(result.node);
  const fallbackPane =
    panesAfter[Math.min(removedIndex, panesAfter.length - 1)];
  return {
    root: result.node,
    focusedPaneId:
      layout.focusedPaneId === paneId && fallbackPane !== undefined
        ? fallbackPane.paneId
        : layout.focusedPaneId,
  };
}

export function movePane(
  layout: SplitLayout,
  paneId: string,
  targetPaneId: string,
  side: SplitSide,
): SplitLayout {
  if (
    paneId === targetPaneId ||
    findPane(layout.root, paneId) === null ||
    findPane(layout.root, targetPaneId) === null
  ) {
    return layout;
  }
  const result = detachPane(layout.root, paneId);
  if (result.node === null || result.detached === null) {
    return layout;
  }
  return {
    root: insertPane(result.node, targetPaneId, side, result.detached),
    focusedPaneId: paneId,
  };
}

export function swapPanes(
  layout: SplitLayout,
  paneId: string,
  targetPaneId: string,
): SplitLayout {
  if (paneId === targetPaneId) {
    return layout;
  }
  const pane = findPane(layout.root, paneId);
  const targetPane = findPane(layout.root, targetPaneId);
  if (pane === null || targetPane === null) {
    return layout;
  }
  const withFirstSwap = replacePaneNode(layout.root, paneId, {
    ...pane,
    tabs: targetPane.tabs,
    activeTabId: targetPane.activeTabId,
  });
  return {
    root: replacePaneNode(withFirstSwap, targetPaneId, {
      ...targetPane,
      tabs: pane.tabs,
      activeTabId: pane.activeTabId,
    }),
    focusedPaneId: targetPaneId,
  };
}

function equalSizes(count: number): number[] {
  if (count === 0) {
    return [];
  }
  return Array.from({ length: count }, () => 1 / count);
}

function normalizeSizes(
  sizes: readonly number[],
  childCount: number,
): number[] {
  if (
    sizes.length !== childCount ||
    sizes.some((size) => !Number.isFinite(size) || size <= 0)
  ) {
    return equalSizes(childCount);
  }
  const total = sizes.reduce((sum, size) => sum + size, 0);
  if (!Number.isFinite(total) || total <= 0) {
    return equalSizes(childCount);
  }
  const normalized = sizes.map((size) =>
    Math.min(MAX_SIZE, Math.max(MIN_SIZE, size / total)),
  );

  for (let pass = 0; pass < childCount + 1; pass += 1) {
    const currentTotal = normalized.reduce((sum, size) => sum + size, 0);
    const difference = 1 - currentTotal;
    if (Math.abs(difference) <= SIZE_EPSILON) {
      break;
    }
    const adjustable = normalized
      .map((size, index) => ({ index, size }))
      .filter(({ size }) =>
        difference > 0 ? size < MAX_SIZE : size > MIN_SIZE,
      );
    if (adjustable.length === 0) {
      return equalSizes(childCount);
    }
    const adjustment = difference / adjustable.length;
    for (const { index } of adjustable) {
      const size = normalized[index];
      if (size !== undefined) {
        normalized[index] = Math.min(
          MAX_SIZE,
          Math.max(MIN_SIZE, size + adjustment),
        );
      }
    }
  }

  const finalTotal = normalized.reduce((sum, size) => sum + size, 0);
  const correctionIndex = normalized.findIndex((size) => {
    const corrected = size + (1 - finalTotal);
    return corrected >= MIN_SIZE && corrected <= MAX_SIZE;
  });
  if (correctionIndex !== -1) {
    const size = normalized[correctionIndex];
    if (size !== undefined) {
      normalized[correctionIndex] = size + (1 - finalTotal);
    }
  }
  return normalized;
}

function updateSplitAtPath(
  node: LayoutNode,
  splitPath: SplitPath,
  pathIndex: number,
  update: (split: SplitNode) => SplitNode | null,
): LayoutNode | null {
  if (pathIndex === splitPath.length) {
    return node.type === "split" ? update(node) : null;
  }
  if (node.type === "pane") {
    return null;
  }
  const childIndex = splitPath[pathIndex];
  if (childIndex === undefined || node.children[childIndex] === undefined) {
    return null;
  }
  const child = updateSplitAtPath(
    node.children[childIndex],
    splitPath,
    pathIndex + 1,
    update,
  );
  if (child === null) {
    return null;
  }
  return {
    ...node,
    children: node.children.map((candidate, index) =>
      index === childIndex ? child : candidate,
    ),
  };
}

export function resizeSplit(
  layout: SplitLayout,
  splitPath: SplitPath,
  childIndex: number,
  fraction: number,
): SplitLayout {
  if (!Number.isFinite(fraction)) {
    return layout;
  }
  const root = updateSplitAtPath(layout.root, splitPath, 0, (split) => {
    if (
      !Number.isInteger(childIndex) ||
      childIndex < 0 ||
      childIndex + 1 >= split.children.length
    ) {
      return null;
    }
    const sizes = normalizeSizes(split.sizes, split.children.length);
    const first = sizes[childIndex];
    const second = sizes[childIndex + 1];
    if (first === undefined || second === undefined) {
      return null;
    }
    const pairTotal = first + second;
    const pairFraction = clampSplitPairFraction(fraction);
    const nextSizes = [...sizes];
    nextSizes[childIndex] = pairTotal * pairFraction;
    nextSizes[childIndex + 1] = pairTotal * (1 - pairFraction);
    return { ...split, sizes: nextSizes };
  });
  return root === null ? layout : { ...layout, root };
}

export function setFocus(layout: SplitLayout, paneId: string): SplitLayout {
  if (findPane(layout.root, paneId) === null) {
    return layout;
  }
  return { ...layout, focusedPaneId: paneId };
}

function normalizePane(pane: PaneNode): PaneNode | null {
  if (pane.tabs.length === 0) {
    return null;
  }
  // Terminals are never previews; otherwise at most one preview per group
  // (later duplicates commit).
  let sawPreview = false;
  let tabs = pane.tabs.map((tab) => {
    if (!tab.preview) {
      return tab;
    }
    if (tab.content.kind === "terminal" || sawPreview) {
      return { ...tab, preview: false };
    }
    sawPreview = true;
    return tab;
  });
  if (tabs.length > MAX_TABS_PER_PANE) {
    // Trim from the end, but never drop the active tab.
    const activeIndex = tabs.findIndex(
      (tab) => tab.tabId === pane.activeTabId,
    );
    const kept = tabs.slice(0, MAX_TABS_PER_PANE);
    const active = activeIndex >= MAX_TABS_PER_PANE ? tabs[activeIndex] : null;
    if (active != null) {
      kept[MAX_TABS_PER_PANE - 1] = active;
    }
    tabs = kept;
  }
  const activeTabId = tabs.some((tab) => tab.tabId === pane.activeTabId)
    ? pane.activeTabId
    : (tabs[0]?.tabId ?? pane.activeTabId);
  return { ...pane, tabs, activeTabId };
}

function normalizeNode(node: LayoutNode): LayoutNode | null {
  if (node.type === "pane") {
    return normalizePane(node);
  }
  const children = node.children
    .map(normalizeNode)
    .filter((child): child is LayoutNode => child !== null);
  if (children.length === 0) {
    return null;
  }
  if (children.length === 1) {
    return children[0] ?? null;
  }
  return {
    ...node,
    children,
    sizes:
      children.length === node.children.length
        ? normalizeSizes(node.sizes, children.length)
        : equalSizes(children.length),
  };
}

function trimToPaneLimit(root: LayoutNode): LayoutNode {
  let nextRoot = root;
  while (countPanes(nextRoot) > MAX_PANES) {
    const lastPane = listPanes(nextRoot).at(-1);
    if (lastPane === undefined) {
      break;
    }
    const result = detachPane(nextRoot, lastPane.paneId);
    if (result.node === null || result.detached === null) {
      break;
    }
    nextRoot = result.node;
  }
  return nextRoot;
}

export function normalize(layout: SplitLayout): SplitLayout {
  const normalizedRoot = normalizeNode(layout.root);
  if (normalizedRoot === null) {
    return layout;
  }
  const root = trimToPaneLimit(normalizedRoot);
  const panes = listPanes(root);
  const focusedPaneId = panes.some(
    (pane) => pane.paneId === layout.focusedPaneId,
  )
    ? layout.focusedPaneId
    : (panes[0]?.paneId ?? layout.focusedPaneId);
  return { root, focusedPaneId };
}

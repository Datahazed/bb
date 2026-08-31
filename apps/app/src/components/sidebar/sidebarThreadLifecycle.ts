import { atom } from "jotai";

export const SIDEBAR_THREAD_LIFECYCLE_STATES = [
  "active",
  "drafts",
  "archived",
] as const;

export type SidebarThreadLifecycleState =
  (typeof SIDEBAR_THREAD_LIFECYCLE_STATES)[number];

export type SidebarThreadLifecycleSelection =
  ReadonlySet<SidebarThreadLifecycleState>;

export const DEFAULT_SIDEBAR_THREAD_LIFECYCLE_SELECTION =
  new Set<SidebarThreadLifecycleState>(["active"]);

export const sidebarThreadLifecycleSelectionAtom =
  atom<SidebarThreadLifecycleSelection>(
    DEFAULT_SIDEBAR_THREAD_LIFECYCLE_SELECTION,
  );

export const builtInSidebarDraftRowsVisibleAtom = atom(false);

export function toggleSidebarThreadLifecycleState(
  current: SidebarThreadLifecycleSelection,
  state: SidebarThreadLifecycleState,
): SidebarThreadLifecycleSelection {
  if (current.has(state)) {
    if (current.size === 1) return current;
    const next = new Set(current);
    next.delete(state);
    return next;
  }

  const next = new Set(current);
  next.add(state);
  return next;
}

export function isDefaultSidebarThreadLifecycleSelection(
  selection: SidebarThreadLifecycleSelection,
): boolean {
  return selection.size === 1 && selection.has("active");
}

export interface BuiltInSidebarLifecycleRenderState {
  showActiveModeSections: boolean;
  showArchivedOnlyControl: boolean;
  showFilteredEmptyState: boolean;
  showLifecycleControlOnlySection: boolean;
}

export function getBuiltInSidebarLifecycleRenderState({
  activeCount,
  archivedCount,
  archivedHasNextPage,
  archivedIsPending,
  draftCount,
  isReady,
  selection,
}: {
  activeCount: number;
  archivedCount: number;
  archivedHasNextPage: boolean;
  archivedIsPending: boolean;
  draftCount: number;
  isReady: boolean;
  selection: SidebarThreadLifecycleSelection;
}): BuiltInSidebarLifecycleRenderState {
  const selectionIsDefault =
    isDefaultSidebarThreadLifecycleSelection(selection);
  const showActive = selection.has("active");
  const showDrafts = selection.has("drafts");
  const showArchived = selection.has("archived");
  const hasMatches =
    (showActive && activeCount > 0) ||
    (showDrafts && draftCount > 0) ||
    (showArchived && archivedCount > 0);
  const showActiveModeSections =
    showActive && (selectionIsDefault || activeCount > 0 || !isReady);

  return {
    showActiveModeSections,
    showArchivedOnlyControl: selection.size === 1 && showArchived,
    showFilteredEmptyState:
      !selectionIsDefault &&
      isReady &&
      !(showArchived && archivedIsPending) &&
      !hasMatches,
    showLifecycleControlOnlySection:
      !showActiveModeSections && archivedCount === 0 && !archivedHasNextPage,
  };
}

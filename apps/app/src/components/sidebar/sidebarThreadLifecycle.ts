import { atom } from "jotai";

export const SIDEBAR_THREAD_LIFECYCLE_STATES = [
  "active",
  "drafts",
  "archived",
] as const;

export type SidebarThreadLifecycleState =
  (typeof SIDEBAR_THREAD_LIFECYCLE_STATES)[number];

export type SidebarThreadLifecycleSelection = ReadonlySet<
  SidebarThreadLifecycleState
>;

export const DEFAULT_SIDEBAR_THREAD_LIFECYCLE_SELECTION = new Set<
  SidebarThreadLifecycleState
>(["active"]);

/**
 * Session-only by design. A fresh app launch always starts from the safe
 * active-only view so an old preference can never make every current thread
 * appear missing.
 */
export const sidebarThreadLifecycleSelectionAtom =
  atom<SidebarThreadLifecycleSelection>(
    DEFAULT_SIDEBAR_THREAD_LIFECYCLE_SELECTION,
  );

/**
 * Whether the built-in list is currently rendering its draft cluster. This is
 * deliberately separate from the selection: plugin replacements do not mount
 * ProjectList and therefore never claim that bb's draft rows are visible.
 */
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

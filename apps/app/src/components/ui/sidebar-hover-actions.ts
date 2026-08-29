export const SIDEBAR_HOVER_ACTIONS_ROW_CLASS = "bb-sidebar-hover-actions-row";

export const SIDEBAR_HOVER_ACTIONS_CLASS = "bb-sidebar-hover-actions";

export const SIDEBAR_HOVER_ACTIONS_GAP_CLASS = "gap-0.5";

/**
 * Stable trailing layout for rows that end in a collapse control. Status and
 * action affordances occupy the preceding region; the caret always owns the
 * final, fixed-width slot so revealing controls cannot move it.
 */
export const SIDEBAR_COLLAPSIBLE_TRAILING_CONTROLS_CLASS =
  "bb-sidebar-collapsible-trailing-controls inline-flex shrink-0 items-center";

export const SIDEBAR_COLLAPSE_CARET_SLOT_CLASS =
  "bb-sidebar-collapse-caret-slot inline-flex h-full w-6 shrink-0 items-center justify-center";

/**
 * Parent thread titles permanently reserve the extra hover-action width that
 * sits immediately before their fixed caret slot.
 */
export const SIDEBAR_COLLAPSIBLE_HOVER_ACTIONS_INSET_CLASS =
  "bb-sidebar-collapsible-hover-actions-inset";

/**
 * Fine-pointer rows show their status in the otherwise hidden caret slot at
 * rest. Hover/focus fades the status while actions and the caret replace it;
 * coarse mobile keeps status, menu, and caret as separate visible siblings.
 */
export const SIDEBAR_COLLAPSIBLE_STATUS_SLOT_CLASS =
  "bb-sidebar-collapsible-status-slot";

/**
 * Row content that must give way when the hover actions overlay extends past
 * its rest slot. Non-collapsible rows keep the existing reveal-time inset.
 */
export const SIDEBAR_HOVER_ACTIONS_INSET_CLASS =
  "bb-sidebar-hover-actions-inset";

export const SIDEBAR_HOVER_ACTIONS_FADE_CLASS = "bb-sidebar-hover-actions-fade";

export const SIDEBAR_HOVER_ACTIONS_MOBILE_ALWAYS_VALUE = "always";

/**
 * Destructive tone for a `ContextMenuItem`. `DropdownMenuItem` ships
 * `variant="destructive"`; its context-menu sibling takes no variant, so a menu
 * that renders both surfaces applies this class on the context side to keep the
 * two tones identical.
 */
export const CONTEXT_MENU_DESTRUCTIVE_ITEM_CLASS =
  "text-destructive focus:bg-destructive/15 focus:text-destructive data-[last-hovered]:bg-destructive/15 data-[last-hovered]:text-destructive";

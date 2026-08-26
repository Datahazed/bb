import type { AppShortcutPresentation } from "@/lib/app-keybindings";

/** Root sections, in their rendered order. Producers choose; the shell groups. */
export const PALETTE_ACTION_BUCKETS = [
  "Threads",
  "Actions",
  "Plugins",
] as const;

export type PaletteActionBucket = (typeof PALETTE_ACTION_BUCKETS)[number];

/**
 * One row of the quick palette. Producer-agnostic so ranking and rendering do
 * not care whether an action came from an app command or elsewhere.
 */
export interface PaletteAction {
  /** Stable across sessions; the recents key. `app:thread.new`. */
  id: string;
  /** Root section at rest. */
  bucket: PaletteActionBucket;
  /** Producer-owned metadata group; also matched against the query. */
  group: string;
  title: string;
  /** Drawn as a pill on the row; null when the command has no binding. */
  shortcut: AppShortcutPresentation | null;
  /** Runs after the palette has closed and restored focus. */
  run: () => void;
}

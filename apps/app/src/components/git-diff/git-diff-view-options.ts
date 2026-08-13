/**
 * Base `@pierre/diffs` view options every diff card starts from.
 *
 * These live apart from `GitDiffCard` because a caller that needs only the
 * options object must not import the diff renderer. `GitDiffCard` reaches
 * `@pierre/diffs` and Shiki, and one static import is enough to put both on the
 * thread route's preload set.
 */
export const GIT_DIFF_VIEW_BASE_OPTIONS = {
  overflow: "scroll",
  disableFileHeader: false,
  // Reveal 30 unchanged lines per expand-up / expand-down click. Library
  // default is 100 — too aggressive for our compact diff cards.
  expansionLineCount: 30,
} as const;

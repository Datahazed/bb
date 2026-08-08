export const GIT_DIFF_VIEW_BASE_OPTIONS = {
  overflow: "scroll",
  disableFileHeader: false,
  // Reveal 30 unchanged lines per expand-up or expand-down action. The library
  // default of 100 lines is too large for compact diff cards.
  expansionLineCount: 30,
} as const;

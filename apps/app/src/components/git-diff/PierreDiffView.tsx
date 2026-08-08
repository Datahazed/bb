import type { FileDiffOptions, SelectedLineRange } from "@pierre/diffs";
import { FileDiff } from "@pierre/diffs/react";
import type { ParsedGitDiffFile } from "./git-diff-parsing";

export interface PierreDiffViewProps {
  fileDiff: ParsedGitDiffFile;
  options: FileDiffOptions<undefined>;
  selectedLines: SelectedLineRange | null;
}

export function PierreDiffView({
  fileDiff,
  options,
  selectedLines,
}: PierreDiffViewProps) {
  return (
    <FileDiff
      fileDiff={fileDiff}
      options={options}
      selectedLines={selectedLines}
    />
  );
}

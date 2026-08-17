// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { GitDiffToolbar, type GitDiffSummaryState } from "./GitDiffToolbar";

afterEach(cleanup);

const noop = () => {};

function renderToolbar(summaryState: GitDiffSummaryState) {
  return render(
    <GitDiffToolbar
      selectionValue="all"
      selectionOptions={[{ value: "all", label: "All changes" }]}
      onSelectionChange={noop}
      isSelectorDisabled={false}
      stats={{ filesCount: 0, insertions: 0, deletions: 0 }}
      isTruncated={false}
      summaryState={summaryState}
      areAllFilesCollapsed
      isCollapseAllDisabled
      onToggleAllCollapsed={noop}
      displayMode="unified"
      onDisplayModeChange={noop}
      lineOverflowMode="scroll"
      onLineOverflowModeChange={noop}
    />,
  );
}

describe("GitDiffToolbar summary", () => {
  it("reserves No changes for a loaded, truly empty diff", () => {
    renderToolbar("available");

    expect(screen.getByText("No changes")).toBeTruthy();
  });

  it("does not describe an unavailable diff as empty", () => {
    renderToolbar("unavailable");

    expect(screen.getByText("Diff unavailable")).toBeTruthy();
    expect(screen.queryByText("No changes")).toBeNull();
  });
});

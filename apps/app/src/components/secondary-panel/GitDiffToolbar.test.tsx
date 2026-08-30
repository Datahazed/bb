// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { TooltipProvider } from "@bb/shared-ui/tooltip";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GitDiffToolbar } from "./GitDiffToolbar";
import { formatWorkspaceCheckoutDisplay } from "@/lib/workspace-checkout-display";

vi.mock("usehooks-ts", () => ({
  useResizeObserver: () => ({ width: 480 }),
}));

afterEach(cleanup);

describe("GitDiffToolbar", () => {
  it("shows branch context separately from the diff selection", () => {
    render(
      <TooltipProvider delayDuration={0}>
        <GitDiffToolbar
          checkout={formatWorkspaceCheckoutDisplay({
            checkout: {
              kind: "branch",
              branchName: "bb/design-system-polish",
              headSha: null,
            },
          })}
          selectionValue="all"
          selectionOptions={[{ value: "all", label: "All changes" }]}
          onSelectionChange={vi.fn()}
          isSelectorDisabled={false}
          stats={{ filesCount: 2, insertions: 12, deletions: 4 }}
          isTruncated={false}
          areAllFilesCollapsed={false}
          isCollapseAllDisabled={false}
          onToggleAllCollapsed={vi.fn()}
          displayMode="unified"
          onDisplayModeChange={vi.fn()}
          lineOverflowMode="wrap"
          onLineOverflowModeChange={vi.fn()}
        />
      </TooltipProvider>,
    );

    expect(screen.queryByText("Branch")).toBeNull();
    expect(screen.getByText("bb/design-system-polish")).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Copy branch name" }),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "All changes" })).toBeTruthy();
  });
});

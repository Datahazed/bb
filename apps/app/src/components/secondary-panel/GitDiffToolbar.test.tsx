// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { TooltipProvider } from "@bb/shared-ui/tooltip";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GitDiffToolbar } from "./GitDiffToolbar";
import { formatWorkspaceCheckoutDisplay } from "@/lib/workspace-checkout-display";

vi.mock("usehooks-ts", () => ({
  useResizeObserver: () => ({ width: 480 }),
}));

afterEach(cleanup);

describe("GitDiffToolbar", () => {
  it("shows branch context with a concise tooltip and complete accessible name", async () => {
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
    const branchButton = screen.getByRole("button", {
      name: "Copy branch name: bb/design-system-polish",
    });
    fireEvent.focus(branchButton);
    expect((await screen.findByRole("tooltip")).textContent).toBe(
      "Copy branch name",
    );
    expect(screen.getByRole("button", { name: "All changes" })).toBeTruthy();
  });
});

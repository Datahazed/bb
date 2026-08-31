// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { TooltipProvider } from "@bb/shared-ui/tooltip";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GitDiffToolbar } from "./GitDiffToolbar";
import {
  formatWorkspaceCheckoutDisplay,
  type WorkspaceCheckoutDisplay,
} from "@/lib/workspace-checkout-display";

vi.mock("usehooks-ts", () => ({
  useResizeObserver: () => ({ width: 480 }),
}));

afterEach(cleanup);

function renderToolbar(checkout: WorkspaceCheckoutDisplay) {
  return render(
    <TooltipProvider delayDuration={0}>
      <GitDiffToolbar
        checkout={checkout}
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
}

describe("GitDiffToolbar", () => {
  it("shows branch context with a concise tooltip and complete accessible name", async () => {
    renderToolbar(
      formatWorkspaceCheckoutDisplay({
        checkout: {
          kind: "branch",
          branchName: "bb/design-system-polish",
          headSha: null,
        },
      }),
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

  it("shows detached commit context without a generic checkout heading", () => {
    renderToolbar(
      formatWorkspaceCheckoutDisplay({
        checkout: {
          kind: "detached",
          headSha: "abcdef1234567890",
        },
      }),
    );

    expect(screen.queryByText("Checkout")).toBeNull();
    expect(screen.getByText("Detached at abcdef1")).toBeTruthy();
    expect(
      screen.getByRole("button", {
        name: "Copy commit SHA: abcdef1234567890",
      }),
    ).toBeTruthy();
  });
});

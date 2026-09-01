// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { TooltipProvider } from "@bb/shared-ui/tooltip";
import { afterEach, describe, expect, it } from "vitest";
import { formatWorkspaceCheckoutDisplay } from "@/lib/workspace-checkout-display";
import { ThreadEnvironmentSummary } from "./ThreadEnvironmentSummary";

afterEach(cleanup);

describe("ThreadEnvironmentSummary", () => {
  it("renders worktree, machine, and branch as separate context", () => {
    const { container } = render(
      <TooltipProvider>
        <ThreadEnvironmentSummary
          environmentLabel="Design system polish"
          environmentIcon="FolderGit"
          environmentTypeLabel="Worktree"
          machineName="Build Mac mini"
          environmentCheckout={formatWorkspaceCheckoutDisplay({
            checkout: {
              kind: "branch",
              branchName: "bb/design-system-polish",
              headSha: null,
            },
          })}
        />
      </TooltipProvider>,
    );

    expect(screen.getByText("Design system polish")).toBeTruthy();
    expect(screen.getByText("Build Mac mini")).toBeTruthy();
    expect(screen.getByText("bb/design-system-polish")).toBeTruthy();
    expect(container.querySelector('[data-icon="FolderGit"]')).not.toBeNull();
    expect(container.querySelector('[data-icon="Laptop"]')).not.toBeNull();
    expect(container.querySelector('[data-icon="GitBranch"]')).not.toBeNull();
  });

  it("keeps unnamed worktrees identifiable without showing a placeholder", () => {
    const { container } = render(
      <TooltipProvider>
        <ThreadEnvironmentSummary
          environmentLabel="Bersabel's MacBook Pro"
          environmentIcon="FolderGit"
          environmentTypeLabel="Worktree"
        />
      </TooltipProvider>,
    );

    expect(screen.queryByText("Unnamed")).toBeNull();
    expect(container.querySelector('[data-icon="FolderGit"]')).not.toBeNull();
  });
});

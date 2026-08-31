// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { TooltipProvider } from "@bb/shared-ui/tooltip";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ThreadEnvironmentSummary } from "./ThreadEnvironmentSummary";

afterEach(cleanup);

describe("ThreadEnvironmentSummary", () => {
  it("reveals the project name without repeating its type", async () => {
    const { container } = render(
      <TooltipProvider delayDuration={0}>
        <ThreadEnvironmentSummary projectName="bb UI QA" />
      </TooltipProvider>,
    );

    const projectDisplay = container.querySelector<HTMLElement>(
      '[data-option-display=""]',
    );
    expect(projectDisplay).not.toBeNull();
    fireEvent.focus(projectDisplay!);

    expect((await screen.findByRole("tooltip")).textContent).toBe("bb UI QA");
  });

  it("keeps worktree and machine labels visibly separate", () => {
    const { container } = render(
      <TooltipProvider delayDuration={0}>
        <ThreadEnvironmentSummary
          environmentLabel="Design system polish"
          environmentCompactLabel="Design system polish"
          environmentIcon="FolderGit"
          environmentTypeLabel="Remote worktree"
          machineName="Build Mac mini"
        />
      </TooltipProvider>,
    );

    expect(
      container.querySelector('[data-promptbox-full-label=""]')?.textContent,
    ).toBe("Design system polish");
    expect(
      container.querySelector('[data-promptbox-compact-label=""]')?.textContent,
    ).toBe("Design system polish");
    expect(screen.getAllByText("Build Mac mini")).toHaveLength(2);
    expect(
      screen.queryByText(/Build Mac mini · Design system polish/u),
    ).toBeNull();
  });

  it("reveals the full machine name when its label is constrained", async () => {
    const { container } = render(
      <TooltipProvider delayDuration={0}>
        <ThreadEnvironmentSummary machineName="Bersabel's MacBook Pro" />
      </TooltipProvider>,
    );

    const machineDisplay = container.querySelector<HTMLElement>(
      '[data-option-display=""]',
    );
    expect(machineDisplay).not.toBeNull();
    expect(machineDisplay!.className).toContain("max-w-[10rem]");
    fireEvent.focus(machineDisplay!);

    expect((await screen.findByRole("tooltip")).textContent).toBe(
      "Bersabel's MacBook Pro",
    );
  });

  it("renders Git checkout context in the composer summary", () => {
    render(
      <TooltipProvider delayDuration={0}>
        <ThreadEnvironmentSummary
          environmentLabel="Design system polish"
          environmentCompactLabel="Design system polish"
          environmentIcon="FolderGit"
          environmentTypeLabel="Local worktree"
          environmentCheckout={{
            copyErrorMessage: "Failed to copy branch name",
            copyLabel: "Copy branch name",
            copySuccessMessage: "Branch name copied",
            copyValue: "bb/design-system-polish",
            label: "bb/design-system-polish",
            rowLabel: "Branch",
            title: "Copy branch name: bb/design-system-polish",
          }}
        />
      </TooltipProvider>,
    );

    const copyButton = screen.getByRole("button", {
      name: "bb/design-system-polish",
    });
    expect(copyButton.textContent).toBe("bb/design-system-polish");
    expect(copyButton.className).toContain("min-w-24");
    expect(copyButton.querySelector('[data-icon="GitBranch"]')).not.toBeNull();
    expect(copyButton.getAttribute("data-promptbox-hide-branch-compact")).toBe(
      "",
    );
  });

  it.each(["Local worktree", "Remote worktree", "Local", "Remote"] as const)(
    "shows the %s environment type from the environment icon",
    async (environmentTypeLabel) => {
      render(
        <TooltipProvider delayDuration={0}>
          <ThreadEnvironmentSummary
            environmentLabel={
              environmentTypeLabel.endsWith("worktree")
                ? "Design system polish"
                : "Review workspace"
            }
            environmentCompactLabel="Workspace"
            environmentIcon="Laptop"
            environmentTypeLabel={environmentTypeLabel}
          />
        </TooltipProvider>,
      );

      fireEvent.focus(
        screen.getByRole("img", {
          name: `Environment type: ${environmentTypeLabel}`,
        }),
      );

      expect((await screen.findByRole("tooltip")).textContent).toBe(
        environmentTypeLabel,
      );
    },
  );

  it("explains the create-thread action in a tooltip", async () => {
    const { container } = render(
      <TooltipProvider delayDuration={0}>
        <ThreadEnvironmentSummary onCreateNewThreadInWorktree={vi.fn()} />
      </TooltipProvider>,
    );

    const createThreadButton = screen.getByRole("button", {
      name: "Create thread in worktree",
    });
    expect(createThreadButton.classList).toContain("text-subtle-foreground/75");
    expect(createThreadButton.classList).toContain(
      "hover:text-muted-foreground",
    );
    expect(
      container.querySelector('[data-icon="MessageSquarePlus"]'),
    ).not.toBeNull();
    fireEvent.focus(createThreadButton);

    expect((await screen.findByRole("tooltip")).textContent).toBe(
      "Create thread in worktree",
    );
  });

  it("does not add a naming affordance when the worktree has no custom name", () => {
    render(
      <TooltipProvider delayDuration={0}>
        <ThreadEnvironmentSummary
          environmentIcon="FolderGit"
          environmentTypeLabel="Local worktree"
          machineName="Bersabel's MacBook Pro"
          onRenameWorktree={vi.fn()}
        />
      </TooltipProvider>,
    );

    expect(screen.queryByRole("button", { name: "Name worktree" })).toBeNull();
    expect(screen.queryByText("Worktree")).toBeNull();
    expect(screen.getAllByText("Bersabel's MacBook Pro")).toHaveLength(2);
  });

  it("keeps the worktree name primary and exposes the rename action", async () => {
    const onRenameWorktree = vi.fn();
    const result = render(
      <TooltipProvider delayDuration={0}>
        <ThreadEnvironmentSummary
          environmentLabel="Design system polish"
          environmentCompactLabel="Design system polish"
          environmentIcon="FolderGit"
          environmentTypeLabel="Local worktree"
          machineName="Bersabel's MacBook Pro"
          onRenameWorktree={onRenameWorktree}
        />
      </TooltipProvider>,
    );

    expect(
      result.container.querySelector('[data-promptbox-full-label=""]')
        ?.textContent,
    ).toBe("Design system polish");
    expect(
      result.container.querySelector('[data-promptbox-compact-label=""]')
        ?.textContent,
    ).toBe("Design system polish");
    expect(screen.getAllByText("Bersabel's MacBook Pro")).toHaveLength(2);
    const renameButton = screen.getByRole("button", {
      name: "Rename worktree: Design system polish",
    });
    expect(renameButton.textContent).toContain("Design system polish");
    expect(
      renameButton.querySelector('[data-icon="Edit"]')?.getAttribute("class"),
    ).toContain("opacity-0");
    renameButton.focus();
    expect(document.activeElement).toBe(renameButton);
    expect((await screen.findByRole("tooltip")).textContent).toBe("Rename");
    fireEvent.click(renameButton);
    expect(onRenameWorktree).toHaveBeenCalledTimes(1);

    result.rerender(
      <TooltipProvider delayDuration={0}>
        <ThreadEnvironmentSummary
          environmentLabel="Release coordination"
          environmentCompactLabel="Release coordination"
          environmentIcon="FolderGit"
          environmentTypeLabel="Local worktree"
          machineName="Bersabel's MacBook Pro"
          onRenameWorktree={onRenameWorktree}
          renameWorktreePending
        />
      </TooltipProvider>,
    );

    const pendingRenameButton = screen.getByRole("button", {
      name: "Rename worktree: Release coordination",
    });
    expect(pendingRenameButton.hasAttribute("disabled")).toBe(true);
    expect(
      pendingRenameButton
        .querySelector('[data-icon="Loading"]')
        ?.getAttribute("class"),
    ).toContain("opacity-100");
  });

  it("truncates a long visible worktree name without overlapping controls", async () => {
    const longName =
      "internal-tooling-ingest-pipeline-rewrite-2026-cross-platform-rollout";
    render(
      <TooltipProvider delayDuration={0}>
        <ThreadEnvironmentSummary
          environmentLabel={longName}
          environmentCompactLabel={longName}
          environmentIcon="FolderGit"
          environmentTypeLabel="Local worktree"
          machineName="Bersabel's MacBook Pro"
          onRenameWorktree={vi.fn()}
        />
      </TooltipProvider>,
    );

    const renameButton = screen.getByRole("button", {
      name: `Rename worktree: ${longName}`,
    });
    expect(renameButton.className).toContain("min-w-0");
    expect(renameButton.textContent).toContain(longName);
    expect(
      renameButton.closest('[data-promptbox-worktree-context=""]'),
    ).not.toBeNull();
    renameButton.focus();
    expect((await screen.findByRole("tooltip")).textContent).toBe("Rename");
    expect(
      renameButton.querySelector('[data-icon="Edit"]')?.getAttribute("class"),
    ).toContain("shrink-0");
  });
});

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
          environmentTypeLabel="Worktree"
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

  it("uses the issue icon for an offline machine", () => {
    const { container } = render(
      <TooltipProvider delayDuration={0}>
        <ThreadEnvironmentSummary
          machineName="Build Mac mini"
          machineConnected={false}
        />
      </TooltipProvider>,
    );

    expect(container.querySelector('[data-icon="LaptopIssue"]')).not.toBeNull();
    expect(screen.getAllByText("Build Mac mini · Offline")).toHaveLength(2);
  });

  it("renders Git checkout context in the composer summary", () => {
    render(
      <TooltipProvider delayDuration={0}>
        <ThreadEnvironmentSummary
          environmentLabel="Design system polish"
          environmentCompactLabel="Design system polish"
          environmentIcon="FolderGit"
          environmentTypeLabel="Worktree"
          environmentCheckout={{
            copyAction: {
              accessibleLabel: "Copy branch name: bb/design-system-polish",
              errorMessage: "Failed to copy branch name",
              label: "Copy branch name",
              successMessage: "Branch name copied",
              value: "bb/design-system-polish",
            },
            detailTooltip: null,
            label: "bb/design-system-polish",
            rowLabel: "Branch",
          }}
        />
      </TooltipProvider>,
    );

    const copyButton = screen.getByRole("button", {
      name: "Copy branch name: bb/design-system-polish",
    });
    expect(copyButton.textContent).toBe("bb/design-system-polish");
    expect(copyButton.className).toContain("min-w-24");
    expect(copyButton.querySelector('[data-icon="GitBranch"]')).not.toBeNull();
    expect(copyButton.getAttribute("data-promptbox-hide-branch-compact")).toBe(
      "",
    );
  });

  it.each(["Worktree", "Machine"] as const)(
    "identifies the %s resource from its icon",
    async (environmentTypeLabel) => {
      render(
        <TooltipProvider delayDuration={0}>
          <ThreadEnvironmentSummary
            environmentLabel={
              environmentTypeLabel === "Worktree"
                ? "Design system polish"
                : "Build Mac mini"
            }
            environmentCompactLabel="Workspace"
            environmentIcon="Laptop"
            environmentTypeLabel={environmentTypeLabel}
          />
        </TooltipProvider>,
      );

      fireEvent.focus(
        screen.getByRole("img", {
          name: environmentTypeLabel,
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

  it("keeps unnamed worktree identity while using the machine name as its fallback", () => {
    const { container } = render(
      <TooltipProvider delayDuration={0}>
        <ThreadEnvironmentSummary
          environmentLabel="Bersabel's MacBook Pro"
          environmentCompactLabel="Bersabel's MacBook Pro"
          environmentIcon="FolderGit"
          environmentTypeLabel="Worktree"
        />
      </TooltipProvider>,
    );

    expect(screen.queryByRole("button", { name: "Name worktree" })).toBeNull();
    expect(screen.queryByText("Worktree")).toBeNull();
    expect(screen.getAllByText("Bersabel's MacBook Pro")).toHaveLength(2);
    expect(container.querySelector('[data-icon="FolderGit"]')).not.toBeNull();
    expect(container.querySelector('[data-icon="Laptop"]')).toBeNull();
    expect(screen.getByRole("img", { name: "Worktree" })).not.toBeNull();
  });

  it("keeps an existing custom worktree name primary and read-only", () => {
    const result = render(
      <TooltipProvider delayDuration={0}>
        <ThreadEnvironmentSummary
          environmentLabel="Design system polish"
          environmentCompactLabel="Design system polish"
          environmentIcon="FolderGit"
          environmentTypeLabel="Worktree"
          machineName="Bersabel's MacBook Pro"
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
    expect(
      screen.queryByRole("button", { name: /rename worktree/iu }),
    ).toBeNull();
    expect(
      result.container.querySelector(
        '[data-promptbox-worktree-context=""] [data-icon="Edit"]',
      ),
    ).toBeNull();
  });

  it("truncates a long visible worktree name without overlapping controls", async () => {
    const longName =
      "internal-tooling-ingest-pipeline-rewrite-2026-cross-platform-rollout";
    const { container } = render(
      <TooltipProvider delayDuration={0}>
        <ThreadEnvironmentSummary
          environmentLabel={longName}
          environmentCompactLabel={longName}
          environmentIcon="FolderGit"
          environmentTypeLabel="Worktree"
          machineName="Bersabel's MacBook Pro"
        />
      </TooltipProvider>,
    );

    const worktreeDisplay = container.querySelector<HTMLElement>(
      '[data-promptbox-worktree-context=""] [data-option-display=""]',
    );
    expect(worktreeDisplay).not.toBeNull();
    expect(worktreeDisplay!.className).toContain("min-w-0");
    expect(worktreeDisplay!.textContent).toContain(longName);
    expect(worktreeDisplay!.querySelector('[data-icon="Edit"]')).toBeNull();
    fireEvent.focus(worktreeDisplay!);
    expect((await screen.findByRole("tooltip")).textContent).toBe(longName);
  });
});

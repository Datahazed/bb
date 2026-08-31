// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { TooltipProvider } from "@bb/shared-ui/tooltip";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ThreadEnvironmentSummary } from "./ThreadEnvironmentSummary";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function mockMachineNameTruncation(isTruncated: boolean): void {
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockImplementation(
    function clientWidth(this: HTMLElement) {
      return this.hasAttribute("data-machine-name-text") ? 100 : 0;
    },
  );
  vi.spyOn(HTMLElement.prototype, "scrollWidth", "get").mockImplementation(
    function scrollWidth(this: HTMLElement) {
      if (!this.hasAttribute("data-machine-name-text")) return 0;
      return isTruncated ? 200 : 100;
    },
  );
}

function mockEnvironmentNameTruncation(isTruncated: boolean): void {
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockImplementation(
    function clientWidth(this: HTMLElement) {
      return this.hasAttribute("data-environment-name-text") ? 100 : 0;
    },
  );
  vi.spyOn(HTMLElement.prototype, "scrollWidth", "get").mockImplementation(
    function scrollWidth(this: HTMLElement) {
      if (!this.hasAttribute("data-environment-name-text")) return 0;
      return isTruncated ? 200 : 100;
    },
  );
}

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
    mockMachineNameTruncation(true);
    const { container } = render(
      <TooltipProvider delayDuration={0}>
        <ThreadEnvironmentSummary machineName="Bersabel's MacBook Pro" />
      </TooltipProvider>,
    );

    const machineDisplay = container.querySelector<HTMLElement>(
      '[aria-label="Machine: Bersabel\'s MacBook Pro"]',
    );
    expect(machineDisplay).not.toBeNull();
    expect(machineDisplay!.parentElement?.className).toContain("max-w-[10rem]");
    fireEvent.focus(machineDisplay!);

    expect((await screen.findByRole("tooltip")).textContent).toBe(
      "Bersabel's MacBook Pro",
    );
  });

  it("does not add a redundant machine-name tooltip when the label fits", () => {
    mockMachineNameTruncation(false);
    render(
      <TooltipProvider delayDuration={0}>
        <ThreadEnvironmentSummary machineName="Build Mac mini" />
      </TooltipProvider>,
    );

    const machineName = screen.getByLabelText("Machine: Build Mac mini");
    expect(machineName.getAttribute("tabindex")).toBeNull();
    expect(machineName.getAttribute("data-state")).toBeNull();
    fireEvent.pointerEnter(machineName);
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("separates offline state from the full machine-name tooltip", async () => {
    mockMachineNameTruncation(true);
    const { container } = render(
      <TooltipProvider delayDuration={0}>
        <ThreadEnvironmentSummary
          machineName="Build Mac mini"
          machineConnected={false}
        />
      </TooltipProvider>,
    );

    expect(container.querySelector('[data-icon="LaptopIssue"]')).not.toBeNull();
    expect(screen.getAllByText("Build Mac mini")).toHaveLength(2);
    expect(screen.queryByText("Build Mac mini · Offline")).toBeNull();

    const offlineIcon = screen.getByRole("img", { name: "Offline" });
    fireEvent.focus(offlineIcon);
    expect((await screen.findByRole("tooltip")).textContent).toBe("Offline");

    fireEvent.blur(offlineIcon);
    await waitFor(() => expect(screen.queryByRole("tooltip")).toBeNull());
    const machineName = screen.getByLabelText(
      "Machine: Build Mac mini, offline",
    );
    fireEvent.focus(machineName);
    expect((await screen.findByRole("tooltip")).textContent).toBe(
      "Build Mac mini",
    );
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

  it("identifies a worktree from its unfamiliar icon", async () => {
    render(
      <TooltipProvider delayDuration={0}>
        <ThreadEnvironmentSummary
          environmentLabel="Design system polish"
          environmentCompactLabel="Workspace"
          environmentIcon="FolderGit"
          environmentTypeLabel="Worktree"
        />
      </TooltipProvider>,
    );

    fireEvent.focus(screen.getByRole("img", { name: "Worktree" }));
    expect((await screen.findByRole("tooltip")).textContent).toBe("Worktree");
  });

  it("does not add a redundant tooltip or focus stop to a fitting direct machine name", () => {
    mockEnvironmentNameTruncation(false);
    const { container } = render(
      <TooltipProvider delayDuration={0}>
        <ThreadEnvironmentSummary
          environmentLabel="Build Mac mini"
          environmentCompactLabel="Build Mac mini"
          environmentIcon="Laptop"
          environmentTypeLabel="Machine"
        />
      </TooltipProvider>,
    );

    expect(screen.queryByRole("img", { name: "Machine" })).toBeNull();
    const laptopIcon = container.querySelector('[data-icon="Laptop"]');
    expect(laptopIcon).not.toBeNull();
    expect(laptopIcon?.parentElement?.getAttribute("tabindex")).toBeNull();

    const machineDisplay = container.querySelector<HTMLElement>(
      '[data-option-display=""]',
    );
    expect(machineDisplay).not.toBeNull();
    expect(machineDisplay!.getAttribute("tabindex")).toBeNull();
    fireEvent.pointerEnter(machineDisplay!);
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("reveals a direct machine name only when it is truncated", async () => {
    mockEnvironmentNameTruncation(true);
    const { container } = render(
      <TooltipProvider delayDuration={0}>
        <ThreadEnvironmentSummary
          environmentLabel="Bersabel's remote build MacBook Pro"
          environmentCompactLabel="Bersabel's remote build MacBook Pro"
          environmentIcon="Laptop"
          environmentTypeLabel="Machine"
        />
      </TooltipProvider>,
    );

    const machineDisplay = container.querySelector<HTMLElement>(
      '[data-option-display=""]',
    );
    expect(machineDisplay?.getAttribute("tabindex")).toBe("0");
    fireEvent.focus(machineDisplay!);
    expect((await screen.findByRole("tooltip")).textContent).toBe(
      "Bersabel's remote build MacBook Pro",
    );
  });

  it("shows direct machine offline status without adding a machine tooltip", async () => {
    mockEnvironmentNameTruncation(false);
    const { container } = render(
      <TooltipProvider delayDuration={0}>
        <ThreadEnvironmentSummary
          environmentLabel="Build Mac mini"
          environmentCompactLabel="Build Mac mini"
          environmentIcon="Laptop"
          environmentTypeLabel="Machine"
          machineConnected={false}
        />
      </TooltipProvider>,
    );

    expect(container.querySelector('[data-icon="Laptop"]')).toBeNull();
    expect(container.querySelector('[data-icon="LaptopIssue"]')).not.toBeNull();
    const machineDisplay = screen.getByLabelText(
      "Machine: Build Mac mini, offline",
    );
    expect(machineDisplay.getAttribute("tabindex")).toBeNull();

    fireEvent.focus(screen.getByRole("img", { name: "Offline" }));
    expect((await screen.findByRole("tooltip")).textContent).toBe("Offline");
  });

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

  it("keeps unnamed worktree identity while exposing offline machine status", async () => {
    mockEnvironmentNameTruncation(false);
    const { container } = render(
      <TooltipProvider delayDuration={0}>
        <ThreadEnvironmentSummary
          environmentLabel="Bersabel's MacBook Pro"
          environmentCompactLabel="Bersabel's MacBook Pro"
          environmentIcon="FolderGit"
          environmentTypeLabel="Worktree"
          machineConnected={false}
        />
      </TooltipProvider>,
    );

    expect(container.querySelector('[data-icon="FolderGit"]')).not.toBeNull();
    expect(container.querySelector('[data-icon="LaptopIssue"]')).not.toBeNull();
    expect(
      screen.getByLabelText("Worktree: Bersabel's MacBook Pro, offline"),
    ).not.toBeNull();

    fireEvent.focus(screen.getByRole("img", { name: "Offline" }));
    expect((await screen.findByRole("tooltip")).textContent).toBe("Offline");
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
    mockEnvironmentNameTruncation(true);
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

  it("keeps measuring the live machine name after its tooltip mounts", async () => {
    let isTruncated = false;
    const observers: Array<{
      callback: ResizeObserverCallback;
      target: Element | null;
    }> = [];
    vi.stubGlobal(
      "ResizeObserver",
      class ResizeObserverMock {
        private readonly observer = {
          callback: null as ResizeObserverCallback | null,
          target: null as Element | null,
        };

        constructor(callback: ResizeObserverCallback) {
          this.observer.callback = callback;
          observers.push({ callback, target: null });
        }

        observe(target: Element) {
          this.observer.target = target;
          observers.at(-1)!.target = target;
        }

        disconnect() {}

        unobserve() {}
      },
    );
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockImplementation(
      function clientWidth(this: HTMLElement) {
        return this.hasAttribute("data-machine-name-text") && this.isConnected
          ? 100
          : 0;
      },
    );
    vi.spyOn(HTMLElement.prototype, "scrollWidth", "get").mockImplementation(
      function scrollWidth(this: HTMLElement) {
        if (!this.hasAttribute("data-machine-name-text") || !this.isConnected) {
          return 0;
        }
        return isTruncated ? 200 : 100;
      },
    );

    render(
      <TooltipProvider delayDuration={0}>
        <ThreadEnvironmentSummary machineName="Build Mac mini" />
      </TooltipProvider>,
    );
    const getMachineName = () =>
      screen.getByLabelText("Machine: Build Mac mini");
    expect(getMachineName().getAttribute("tabindex")).toBeNull();

    isTruncated = true;
    for (const observer of observers.filter(
      ({ target }) => target?.isConnected,
    )) {
      observer.callback([], observer as never);
    }
    await waitFor(() =>
      expect(getMachineName().getAttribute("tabindex")).toBe("0"),
    );

    isTruncated = false;
    for (const observer of observers.filter(
      ({ target }) => target?.isConnected,
    )) {
      observer.callback([], observer as never);
    }
    await waitFor(() =>
      expect(getMachineName().getAttribute("tabindex")).toBeNull(),
    );
  });
});

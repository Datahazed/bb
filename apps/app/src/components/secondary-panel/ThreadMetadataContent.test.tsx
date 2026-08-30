// @vitest-environment jsdom

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import type { Environment, Thread } from "@bb/domain";
import { TooltipProvider } from "@bb/shared-ui/tooltip";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  EnvironmentRow,
  MachineRow,
  ParentSelectorRow,
  ThreadMetadataCard,
} from "./ThreadMetadataContent";
import { parentThreads } from "./ThreadMetadataContent.fixtures";

const localHost = { locality: "local", identity: null } as const;

function makeThread(overrides: Partial<Thread> = {}): Thread {
  return {
    id: "thr_test",
    projectId: "proj_test",
    environmentId: "env_test",
    providerId: "codex",
    title: null,
    titleFallback: null,
    sectionId: null,
    status: "idle",
    parentThreadId: null,
    sourceThreadId: null,
    originKind: null,
    originPluginId: null,
    visibility: "visible",
    archivedAt: null,
    pinnedAt: null,
    deletedAt: null,
    lastReadAt: null,
    latestAttentionAt: 0,
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  };
}

function makeEnvironment(overrides: Partial<Environment> = {}): Environment {
  return {
    id: "env_test",
    name: null,
    projectId: "proj_test",
    hostId: "host_test",
    path: "/workspace",
    managed: true,
    isGitRepo: true,
    isWorktree: true,
    workspaceProvisionType: "managed-worktree",
    branchName: "feature",
    baseBranch: "main",
    defaultBranch: "main",
    mergeBaseBranch: null,
    status: "ready",
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  };
}

function renderEnvironmentRow(environment: Environment): string {
  return renderToStaticMarkup(
    <TooltipProvider>
      <MemoryRouter>
        <EnvironmentRow
          thread={makeThread({ environmentId: environment.id })}
          environment={environment}
          environmentDisplayHost={localHost}
        />
      </MemoryRouter>
    </TooltipProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("ThreadMetadataCard", () => {
  it("shows its scrollbar only during active scrolling", () => {
    vi.useFakeTimers();
    const { container } = render(
      <ThreadMetadataCard>
        <div>Thread information</div>
      </ThreadMetadataCard>,
    );
    const scrollArea = container.querySelector("dl");
    if (!(scrollArea instanceof HTMLElement)) {
      throw new Error("missing info scroll area");
    }

    expect(scrollArea.classList).toContain("transient-scrollbar");
    expect(scrollArea.hasAttribute("data-scrollbar-scrolling")).toBe(false);

    fireEvent.scroll(scrollArea);
    expect(scrollArea.dataset.scrollbarScrolling).toBe("true");

    act(() => vi.advanceTimersByTime(599));
    expect(scrollArea.dataset.scrollbarScrolling).toBe("true");

    act(() => vi.advanceTimersByTime(1));
    expect(scrollArea.hasAttribute("data-scrollbar-scrolling")).toBe(false);
  });
});

describe("EnvironmentRow", () => {
  it("keeps the worktree name primary and exposes the rename action", async () => {
    const onRenameWorktree = vi.fn();
    const result = render(
      <TooltipProvider delayDuration={0}>
        <MemoryRouter>
          <EnvironmentRow
            thread={makeThread()}
            environment={makeEnvironment({
              id: "env_obfuscated",
              name: "Design system polish",
            })}
            environmentDisplayHost={localHost}
            onRenameWorktree={onRenameWorktree}
          />
        </MemoryRouter>
      </TooltipProvider>,
    );

    const worktreeName = screen.getByText("Design system polish");
    const worktreeValue = worktreeName.closest("dd");
    expect(worktreeValue).not.toBeNull();
    expect(
      worktreeValue?.previousElementSibling?.querySelector(
        '[data-icon="FolderGit"]',
      ),
    ).not.toBeNull();
    expect(screen.getByText("Worktree").closest("dt")).not.toBeNull();
    expect(screen.queryByText("Name")).toBeNull();
    expect(screen.queryByText("Bersabel's MacBook Pro")).toBeNull();
    expect(screen.queryByText("env_obfuscated")).toBeNull();
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
        <MemoryRouter>
          <EnvironmentRow
            thread={makeThread()}
            environment={makeEnvironment({ name: "Release coordination" })}
            environmentDisplayHost={localHost}
            onRenameWorktree={onRenameWorktree}
            renameWorktreePending
          />
        </MemoryRouter>
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

  it("offers naming without using the worktree type as a row label", () => {
    render(
      <TooltipProvider delayDuration={0}>
        <MemoryRouter>
          <EnvironmentRow
            thread={makeThread()}
            environment={makeEnvironment({ name: null })}
            environmentDisplayHost={localHost}
            onRenameWorktree={vi.fn()}
          />
        </MemoryRouter>
      </TooltipProvider>,
    );

    expect(
      screen.getByRole("button", { name: "Name worktree" }).textContent,
    ).toContain("Add name");
    expect(screen.getByText("Worktree").closest("dt")).not.toBeNull();
    expect(screen.queryByText("Name")).toBeNull();
  });

  it("does not present direct locality as a resource identity", () => {
    const result = render(
      <MemoryRouter>
        <EnvironmentRow
          thread={makeThread()}
          environment={makeEnvironment({
            isWorktree: false,
            workspaceProvisionType: "unmanaged",
          })}
          environmentDisplayHost={localHost}
        />
      </MemoryRouter>,
    );

    expect(screen.queryByText("Local")).toBeNull();

    result.rerender(
      <MemoryRouter>
        <EnvironmentRow
          thread={makeThread()}
          environment={makeEnvironment({
            isWorktree: false,
            workspaceProvisionType: "unmanaged",
          })}
          environmentDisplayHost={{ locality: "remote", identity: null }}
        />
      </MemoryRouter>,
    );

    expect(screen.queryByText("Remote")).toBeNull();
  });

  it("keeps worktree identity primary while lifecycle stays secondary", () => {
    render(
      <MemoryRouter>
        <EnvironmentRow
          thread={makeThread()}
          environment={makeEnvironment({
            name: "Design system polish",
            status: "provisioning",
            path: null,
            isWorktree: false,
            workspaceProvisionType: "managed-worktree",
          })}
          environmentDisplayHost={localHost}
        />
      </MemoryRouter>,
    );

    const worktreeName = screen.getByText("Design system polish");
    const worktreeValue = worktreeName.closest("dd");
    expect(worktreeValue).not.toBeNull();
    expect(
      worktreeValue?.previousElementSibling?.querySelector(
        '[data-icon="FolderGit"]',
      ),
    ).not.toBeNull();
    expect(screen.getByText("Worktree").closest("dt")).not.toBeNull();
    expect(screen.getByText("· Provisioning").getAttribute("class")).toContain(
      "text-muted-foreground",
    );
  });

  it("places the actual machine name beside its icon and keeps state secondary", () => {
    render(<MachineRow name="Bersabel's MacBook Pro" connected={false} />);

    const machineName = screen.getByText("Bersabel's MacBook Pro");
    const machineValue = machineName.closest("dd");
    expect(machineValue).not.toBeNull();
    expect(
      machineValue?.previousElementSibling?.querySelector(
        '[data-icon="Laptop"]',
      ),
    ).not.toBeNull();
    expect(screen.getByText("Machine").closest("dt")).not.toBeNull();
    expect(screen.getByText("· Offline").getAttribute("class")).toContain(
      "text-muted-foreground",
    );
  });

  it("shows the create-thread action for a provisioned worktree", () => {
    expect(renderEnvironmentRow(makeEnvironment())).toContain(
      'aria-label="Create thread in worktree"',
    );
  });

  it("explains the create-thread action in a tooltip", async () => {
    render(
      <TooltipProvider delayDuration={0}>
        <MemoryRouter>
          <EnvironmentRow
            thread={makeThread()}
            environment={makeEnvironment()}
            environmentDisplayHost={localHost}
          />
        </MemoryRouter>
      </TooltipProvider>,
    );

    fireEvent.focus(
      screen.getByRole("button", {
        name: "Create thread in worktree",
      }),
    );

    expect((await screen.findByRole("tooltip")).textContent).toBe(
      "Create thread in worktree",
    );
  });

  it("hides the create-thread action while a managed worktree is provisioning", () => {
    const markup = renderEnvironmentRow(
      makeEnvironment({
        status: "provisioning",
        path: null,
        isWorktree: false,
      }),
    );

    expect(markup).not.toContain('aria-label="Create thread in worktree"');
  });

  it("hides the create-thread action before a prepared worktree has a path", () => {
    const markup = renderEnvironmentRow(
      makeEnvironment({
        path: null,
        isWorktree: false,
      }),
    );

    expect(markup).not.toContain('aria-label="Create thread in worktree"');
  });
});

describe("ParentSelectorRow", () => {
  it("requests candidates only when the parent menu opens", async () => {
    const onOpenChange = vi.fn();
    render(
      <MemoryRouter>
        <ParentSelectorRow
          thread={makeThread({ environmentId: null })}
          projectId="proj_test"
          parentThreadProjectId={null}
          parentThreadDisplayName={null}
          parentThreads={[]}
          canAssignToParent
          canTakeOverThread={false}
          isLoadingParentThreads
          isParentThreadsError={false}
          updateThreadPending={false}
          onAssignParent={vi.fn()}
          onParentSelectorOpenChange={onOpenChange}
          onRetryParentThreads={vi.fn()}
        />
      </MemoryRouter>,
    );

    expect(onOpenChange).not.toHaveBeenCalled();
    fireEvent.pointerDown(screen.getByRole("button"), {
      button: 0,
      ctrlKey: false,
    });

    expect(onOpenChange).toHaveBeenCalledWith(true);
    expect(await screen.findByText("Loading threads…")).toBeTruthy();
  });

  it("offers a retry after candidate loading fails and shows recovered results", async () => {
    const onRetry = vi.fn();
    const row = (isError: boolean, candidates = parentThreads) => (
      <MemoryRouter>
        <ParentSelectorRow
          thread={makeThread({ environmentId: null })}
          projectId="proj_test"
          parentThreadProjectId={null}
          parentThreadDisplayName={null}
          parentThreads={candidates}
          canAssignToParent
          canTakeOverThread={false}
          isLoadingParentThreads={false}
          isParentThreadsError={isError}
          updateThreadPending={false}
          onAssignParent={vi.fn()}
          onParentSelectorOpenChange={vi.fn()}
          onRetryParentThreads={onRetry}
        />
      </MemoryRouter>
    );
    const result = render(row(true, []));

    fireEvent.pointerDown(screen.getByRole("button"), {
      button: 0,
      ctrlKey: false,
    });
    fireEvent.click(await screen.findByText("Retry loading threads"));
    expect(onRetry).toHaveBeenCalledTimes(1);

    result.rerender(row(false));
    const trigger = screen
      .getAllByRole("button")
      .reverse()
      .find((candidate) => candidate.getAttribute("aria-haspopup") === "menu");
    if (!trigger) {
      throw new Error("missing parent selector trigger");
    }
    fireEvent.pointerDown(trigger, {
      button: 0,
      ctrlKey: false,
    });
    expect(await screen.findByText("Codex Parent")).toBeTruthy();
  });
});

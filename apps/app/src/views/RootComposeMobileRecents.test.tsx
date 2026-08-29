// @vitest-environment jsdom

import type { ThreadListEntry } from "@bb/domain";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";
import {
  getMobileRecentThreads,
  RootComposeMobileRecents,
} from "./RootComposeMobileRecents";

function makeThread(overrides: Partial<ThreadListEntry> = {}): ThreadListEntry {
  return {
    id: "thr_mobile",
    projectId: "proj_mobile",
    environmentId: null,
    providerId: "codex",
    title: "Mobile activity",
    titleFallback: "Mobile activity",
    sectionId: null,
    status: "active",
    parentThreadId: null,
    sourceThreadId: null,
    originKind: null,
    originPluginId: null,
    visibility: "visible",
    archivedAt: null,
    pinnedAt: null,
    pinSortKey: null,
    deletedAt: null,
    lastReadAt: 1,
    latestAttentionAt: 2,
    createdAt: 1,
    updatedAt: 2,
    activity: {
      activeWorkflowCount: 0,
      activeBackgroundAgentCount: 0,
      activeBackgroundCommandCount: 0,
      activePlanModeCount: 1,
      activeGoalCount: 1,
    },
    hasPendingInteraction: false,
    environmentHostId: null,
    environmentName: null,
    environmentBranchName: null,
    environmentWorkspaceDisplayKind: "other",
    runtime: {
      displayStatus: "active",
      hostReconnectGraceExpiresAt: null,
    },
    ...overrides,
  };
}

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

describe("getMobileRecentThreads", () => {
  it("returns every active thread newest-first instead of a capped window", () => {
    const threads = Array.from({ length: 12 }, (_unused, index) =>
      makeThread({
        id: `thr_${index}`,
        latestAttentionAt: index,
        createdAt: index,
      }),
    );

    const ordered = getMobileRecentThreads({
      highlightedThreadId: null,
      threads,
    });

    expect(ordered).toHaveLength(12);
    expect(ordered.map((thread) => thread.id)).toEqual([
      "thr_11",
      "thr_10",
      "thr_9",
      "thr_8",
      "thr_7",
      "thr_6",
      "thr_5",
      "thr_4",
      "thr_3",
      "thr_2",
      "thr_1",
      "thr_0",
    ]);
  });

  it("pins the highlighted thread first without dropping the rest", () => {
    const threads = Array.from({ length: 5 }, (_unused, index) =>
      makeThread({
        id: `thr_${index}`,
        latestAttentionAt: index,
        createdAt: index,
      }),
    );

    const ordered = getMobileRecentThreads({
      highlightedThreadId: "thr_0",
      threads,
    });

    expect(ordered.map((thread) => thread.id)).toEqual([
      "thr_0",
      "thr_4",
      "thr_3",
      "thr_2",
      "thr_1",
    ]);
  });
});

describe("mobile recents section", () => {
  it("keeps the Recent label pinned while the list scrolls under it", () => {
    render(
      <MemoryRouter>
        <RootComposeMobileRecents
          highlightedThreadId={null}
          projectNamesById={new Map()}
          providersById={new Map()}
          showCreatingRow={false}
          threads={[makeThread()]}
        />
      </MemoryRouter>,
    );

    const label = screen.getByText("Recent").parentElement;
    if (!(label instanceof HTMLElement)) {
      throw new Error("Expected a Recent label wrapper");
    }
    expect(label.className).toContain("sticky");
    expect(label.className).toContain("top-0");
    expect(label.className).toContain("bg-background");
    expect(label.querySelector('[data-overflow-fade="below"]')).not.toBeNull();
  });
});

describe("mobile recent thread rows", () => {
  it("shows project and relative activity on a metadata line", () => {
    render(
      <MemoryRouter>
        <RootComposeMobileRecents
          highlightedThreadId={null}
          projectNamesById={new Map([["proj_mobile", "bb"]])}
          providersById={new Map()}
          showCreatingRow={false}
          threads={[
            makeThread({
              latestAttentionAt: Date.now() - 3 * 60 * 60 * 1000,
              activity: {
                activeWorkflowCount: 0,
                activeBackgroundAgentCount: 0,
                activeBackgroundCommandCount: 0,
                activePlanModeCount: 0,
                activeGoalCount: 0,
              },
            }),
          ]}
        />
      </MemoryRouter>,
    );

    expect(screen.getByText("bb \u00b7 3h ago")).not.toBeNull();
  });

  it("includes the worktree branch when the thread has one", () => {
    render(
      <MemoryRouter>
        <RootComposeMobileRecents
          highlightedThreadId={null}
          projectNamesById={new Map([["proj_mobile", "bb"]])}
          providersById={new Map()}
          showCreatingRow={false}
          threads={[
            makeThread({
              environmentBranchName: "bb/mobile-home",
              latestAttentionAt: Date.now() - 3 * 60 * 60 * 1000,
              activity: {
                activeWorkflowCount: 0,
                activeBackgroundAgentCount: 0,
                activeBackgroundCommandCount: 0,
                activePlanModeCount: 0,
                activeGoalCount: 0,
              },
            }),
          ]}
        />
      </MemoryRouter>,
    );

    expect(
      screen.getByText("bb \u00b7 bb/mobile-home \u00b7 3h ago"),
    ).not.toBeNull();
  });

  it("drops the status slot entirely when a thread has no indicator", () => {
    render(
      <MemoryRouter>
        <RootComposeMobileRecents
          highlightedThreadId={null}
          projectNamesById={new Map()}
          providersById={new Map()}
          showCreatingRow={false}
          threads={[
            makeThread({
              status: "idle",
              lastReadAt: 10,
              latestAttentionAt: 5,
              runtime: {
                displayStatus: "idle",
                hostReconnectGraceExpiresAt: null,
              },
              activity: {
                activeWorkflowCount: 0,
                activeBackgroundAgentCount: 0,
                activeBackgroundCommandCount: 0,
                activePlanModeCount: 0,
                activeGoalCount: 0,
              },
            }),
          ]}
        />
      </MemoryRouter>,
    );

    expect(screen.queryByLabelText("Plan mode active")).toBeNull();
    expect(screen.queryByLabelText("Thread working")).toBeNull();
    expect(
      screen.getByRole("link").querySelectorAll("span.size-6"),
    ).toHaveLength(0);
  });
});

describe("RootComposeMobileRecents", () => {
  it("shows concurrent Plan activity before the runtime spinner", () => {
    render(
      <MemoryRouter>
        <RootComposeMobileRecents
          highlightedThreadId={null}
          projectNamesById={new Map()}
          providersById={new Map()}
          showCreatingRow={false}
          threads={[makeThread()]}
        />
      </MemoryRouter>,
    );

    expect(screen.getByLabelText("Plan mode active")).not.toBeNull();
    expect(screen.queryByLabelText("Thread working")).toBeNull();
    expect(screen.queryByLabelText("Goal active")).toBeNull();
  });

  it("shows runtime activity before concurrent workflow activity", () => {
    render(
      <MemoryRouter>
        <RootComposeMobileRecents
          highlightedThreadId={null}
          projectNamesById={new Map()}
          providersById={new Map()}
          showCreatingRow={false}
          threads={[
            makeThread({
              activity: {
                activeWorkflowCount: 1,
                activeBackgroundAgentCount: 1,
                activeBackgroundCommandCount: 1,
                activePlanModeCount: 0,
                activeGoalCount: 0,
              },
            }),
          ]}
        />
      </MemoryRouter>,
    );

    expect(screen.getByLabelText("Thread working")).not.toBeNull();
    expect(screen.queryByLabelText("Workflow running")).toBeNull();
  });

  it("keeps the mobile working draft state ahead of runtime activity", () => {
    window.localStorage.setItem(
      "bb.promptbox.contents-proj_mobile-thr_mobile-3",
      JSON.stringify({ text: "Keep editing", attachments: [] }),
    );

    render(
      <MemoryRouter>
        <RootComposeMobileRecents
          highlightedThreadId={null}
          projectNamesById={new Map()}
          providersById={new Map()}
          showCreatingRow={false}
          threads={[makeThread()]}
        />
      </MemoryRouter>,
    );

    expect(
      screen.getByLabelText("Thread working with unsubmitted draft"),
    ).not.toBeNull();
    expect(screen.queryByLabelText("Thread working")).toBeNull();
    expect(screen.queryByLabelText("Plan mode active")).toBeNull();
  });

  it("includes only the resolved idle draft indicator in the link label", () => {
    window.localStorage.setItem(
      "bb.promptbox.contents-proj_mobile-thr_mobile-3",
      JSON.stringify({ text: "Keep editing", attachments: [] }),
    );

    render(
      <MemoryRouter>
        <RootComposeMobileRecents
          highlightedThreadId={null}
          projectNamesById={new Map()}
          providersById={new Map()}
          showCreatingRow={false}
          threads={[
            makeThread({
              status: "idle",
              activity: {
                activeWorkflowCount: 0,
                activeBackgroundAgentCount: 0,
                activeBackgroundCommandCount: 0,
                activePlanModeCount: 0,
                activeGoalCount: 0,
              },
              runtime: {
                displayStatus: "idle",
                hostReconnectGraceExpiresAt: null,
              },
            }),
          ]}
        />
      </MemoryRouter>,
    );

    expect(
      screen.getByRole("link", {
        name: "Open Mobile activity — Thread has unsubmitted draft",
      }),
    ).not.toBeNull();
    expect(screen.queryByLabelText("Plan mode active")).toBeNull();
  });
});

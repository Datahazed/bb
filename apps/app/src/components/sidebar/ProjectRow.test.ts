import { createElement } from "react";
import { describe, expect, it } from "vitest";
import type { ProjectResponse } from "@bb/server-contract";
import { makeThreadListEntry } from "@/test/fixtures/thread-list-entries";
import {
  areProjectRowPropsEqual,
  areProjectThreadListStatesEqual,
  formatArchivedEnvironmentThreadsToastTitle,
  shouldSuppressPinnedThreadDropPreview,
  type ProjectRowProps,
  type ProjectThreadListState,
} from "./ProjectRow";
import { PINNED_THREAD_PARENT_KEY } from "./useSectionThreadDnd";

describe("formatArchivedEnvironmentThreadsToastTitle", () => {
  it("uses the thread title when archiving one thread", () => {
    expect(
      formatArchivedEnvironmentThreadsToastTitle({
        archivedThreadIds: ["thr_one"],
        threads: [
          {
            id: "thr_one",
            title: "Investigate checkout warnings",
            titleFallback: null,
          },
        ],
      }),
    ).toBe("Archived Investigate checkout warnings");
  });

  it("uses a count when archiving multiple threads", () => {
    expect(
      formatArchivedEnvironmentThreadsToastTitle({
        archivedThreadIds: ["thr_one", "thr_two"],
        threads: [],
      }),
    ).toBe("Archived 2 threads");
  });
});

describe("shouldSuppressPinnedThreadDropPreview", () => {
  it("keeps the preview until the optimistic pinned row exists", () => {
    expect(
      shouldSuppressPinnedThreadDropPreview({
        activeThreadId: "thread-1",
        dragOverParentKey: PINNED_THREAD_PARENT_KEY,
        pinnedThreads: [],
      }),
    ).toBe(false);
  });

  it("suppresses the preview once the optimistic pinned row exists", () => {
    expect(
      shouldSuppressPinnedThreadDropPreview({
        activeThreadId: "thread-1",
        dragOverParentKey: PINNED_THREAD_PARENT_KEY,
        pinnedThreads: [{ id: "thread-1" }],
      }),
    ).toBe(true);
  });
});

describe("areProjectThreadListStatesEqual", () => {
  const threadA = makeThreadListEntry({ id: "thr_a" });
  const threadB = makeThreadListEntry({ id: "thr_b" });

  it("treats a new array with the same entries as equal", () => {
    expect(
      areProjectThreadListStatesEqual(
        { status: "ready", threads: [threadA, threadB] },
        { status: "ready", threads: [threadA, threadB] },
      ),
    ).toBe(true);
  });

  it("treats a replaced entry as a change even when its fields match", () => {
    // Identity is the test on purpose: React Query structurally shares the
    // sidebar payload, so an entry keeps its object while its fields are
    // unchanged and a new object always carries a change.
    const threadBCopy = makeThreadListEntry({ id: "thr_b" });
    expect(
      areProjectThreadListStatesEqual(
        { status: "ready", threads: [threadA, threadB] },
        { status: "ready", threads: [threadA, threadBCopy] },
      ),
    ).toBe(false);
  });

  it("treats added, removed and reordered entries as a change", () => {
    const both: ProjectThreadListState = {
      status: "ready",
      threads: [threadA, threadB],
    };
    expect(
      areProjectThreadListStatesEqual(both, {
        status: "ready",
        threads: [threadA],
      }),
    ).toBe(false);
    expect(
      areProjectThreadListStatesEqual(both, {
        status: "ready",
        threads: [threadB, threadA],
      }),
    ).toBe(false);
  });

  it("compares non-ready states by status alone", () => {
    expect(
      areProjectThreadListStatesEqual(
        { status: "ready", threads: [threadA] },
        { status: "unavailable" },
      ),
    ).toBe(false);
    expect(
      areProjectThreadListStatesEqual(
        { status: "loading" },
        { status: "unavailable" },
      ),
    ).toBe(false);
    expect(
      areProjectThreadListStatesEqual(
        { status: "loading" },
        { status: "loading" },
      ),
    ).toBe(true);
  });
});

describe("areProjectRowPropsEqual", () => {
  const threadA = makeThreadListEntry({ id: "thr_a" });
  const threadB = makeThreadListEntry({ id: "thr_b" });
  const collapsedThreadIds = new Set<string>();
  const collapsedEnvironmentIds = new Set<string>();
  const compareThreads = () => 0;
  const noop = () => {};
  const headerActions = createElement("span");
  // Shared like React Query's structural sharing shares an unchanged nested
  // value: a refetch gives the project a new object but the same `sources`.
  const sources: ProjectResponse["sources"] = [];

  function makeProject(
    overrides: Partial<ProjectResponse> = {},
  ): ProjectResponse {
    return {
      id: "proj_test",
      kind: "standard",
      name: "Test project",
      gitRemoteUrl: null,
      sources,
      createdAt: 0,
      updatedAt: 0,
      ...overrides,
    };
  }

  function makeProps(
    overrides: Partial<ProjectRowProps> = {},
  ): ProjectRowProps {
    return {
      project: makeProject(),
      threadListState: { status: "ready", threads: [threadA, threadB] },
      isActive: false,
      isCollapsed: false,
      compareThreads,
      collapsedThreadIds,
      collapsedEnvironmentIds,
      isLocalPathInvalid: false,
      headerActions,
      onToggleProjectCollapsed: noop,
      onToggleThreadCollapsed: noop,
      onToggleEnvironmentCollapsed: noop,
      ...overrides,
    };
  }

  it("keeps the row for an equal project object and the same thread entries", () => {
    // A refetch that touched another project's threads still hands this row
    // a fresh project object and a fresh thread array with identical content.
    expect(areProjectRowPropsEqual(makeProps(), makeProps())).toBe(true);
  });

  it("re-renders when a thread entry was replaced", () => {
    expect(
      areProjectRowPropsEqual(
        makeProps(),
        makeProps({
          threadListState: {
            status: "ready",
            threads: [threadA, makeThreadListEntry({ id: "thr_b" })],
          },
        }),
      ),
    ).toBe(false);
  });

  it("re-renders when a project field changed", () => {
    expect(
      areProjectRowPropsEqual(
        makeProps(),
        makeProps({ project: makeProject({ name: "Renamed" }) }),
      ),
    ).toBe(false);
  });

  it("re-renders when a nested project value was replaced", () => {
    // Nested identity is the contract: structural sharing keeps `sources`
    // when it is unchanged and hands the row a new array when it changed, so
    // the comparator must treat a fresh array with equal content as a change
    // (the actions menu reads `project.sources` to decide what it offers).
    expect(
      areProjectRowPropsEqual(
        makeProps(),
        makeProps({ project: makeProject({ sources: [] }) }),
      ),
    ).toBe(false);
  });

  it("re-renders when the thread list status changed", () => {
    expect(
      areProjectRowPropsEqual(
        makeProps(),
        makeProps({ threadListState: { status: "unavailable" } }),
      ),
    ).toBe(false);
  });

  it("re-renders when the header actions element changed identity", () => {
    // The list must therefore hand each row a cached element (see
    // useSectionDisplayOptionsRenderer); a fresh one per render would defeat
    // every other check here.
    expect(
      areProjectRowPropsEqual(
        makeProps(),
        makeProps({ headerActions: createElement("span") }),
      ),
    ).toBe(false);
  });
});

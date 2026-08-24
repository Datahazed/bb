import { describe, expect, it } from "vitest";
import type { ThreadListEntry } from "@bb/domain";
import type { ProjectResponse } from "@bb/server-contract";
import { makeThreadListEntry } from "@/test/fixtures/thread-list-entries";
import { retainProjectRows } from "./ProjectList";
import type { ProjectListRowModel } from "./ProjectListProjects";

function makeProject(id: string): ProjectResponse {
  return {
    id,
    kind: "standard",
    name: id,
    gitRemoteUrl: null,
    sources: [],
    createdAt: 0,
    updatedAt: 0,
  };
}

function makeRow(
  project: ProjectResponse,
  threads: ThreadListEntry[],
  overrides: Partial<Omit<ProjectListRowModel, "project">> = {},
): ProjectListRowModel {
  return {
    project,
    threadListState: { status: "ready", threads },
    isActive: false,
    isLocalPathInvalid: false,
    ...overrides,
  };
}

function readyThreads(row: ProjectListRowModel): ThreadListEntry[] {
  if (row.threadListState.status !== "ready") {
    throw new Error(`expected a ready row, got ${row.threadListState.status}`);
  }
  return row.threadListState.threads;
}

describe("retainProjectRows", () => {
  const projectA = makeProject("proj_a");
  const projectB = makeProject("proj_b");
  const threadA1 = makeThreadListEntry({ id: "thr_a1", projectId: "proj_a" });
  const threadA2 = makeThreadListEntry({ id: "thr_a2", projectId: "proj_a" });
  const threadB1 = makeThreadListEntry({ id: "thr_b1", projectId: "proj_b" });

  it("keeps the row and thread array of a project whose entries did not change", () => {
    const previous = retainProjectRows(
      [],
      [makeRow(projectA, [threadA1, threadA2]), makeRow(projectB, [threadB1])],
    );
    // A refetch regroups every project into fresh arrays. React Query's
    // structural sharing keeps an unchanged entry's identity and replaces a
    // changed one, so entry identity decides whether a row can be kept.
    const runningA1 = makeThreadListEntry({
      id: "thr_a1",
      projectId: "proj_a",
      status: "active",
    });
    const next = retainProjectRows(previous, [
      makeRow(projectA, [runningA1, threadA2]),
      makeRow(projectB, [threadB1]),
    ]);

    expect(next).not.toBe(previous);
    expect(next[0]).not.toBe(previous[0]);
    expect(readyThreads(next[0])).toEqual([runningA1, threadA2]);
    expect(next[1]).toBe(previous[1]);
    expect(next[1].threadListState).toBe(previous[1].threadListState);
    expect(readyThreads(next[1])).toBe(readyThreads(previous[1]));
  });

  it("returns the previous array when every row is kept in place", () => {
    const previous = retainProjectRows(
      [],
      [makeRow(projectA, [threadA1]), makeRow(projectB, [threadB1])],
    );
    expect(
      retainProjectRows(previous, [
        makeRow(projectA, [threadA1]),
        makeRow(projectB, [threadB1]),
      ]),
    ).toBe(previous);
    expect(retainProjectRows([], [])).toEqual([]);
  });

  it("returns a new array for a reorder while keeping the row objects", () => {
    const previous = retainProjectRows(
      [],
      [makeRow(projectA, [threadA1]), makeRow(projectB, [threadB1])],
    );
    const next = retainProjectRows(previous, [
      makeRow(projectB, [threadB1]),
      makeRow(projectA, [threadA1]),
    ]);
    expect(next).not.toBe(previous);
    expect(next).toEqual([previous[1], previous[0]]);
    expect(next[0]).toBe(previous[1]);
    expect(next[1]).toBe(previous[0]);
  });

  it("replaces every row when the list status changes", () => {
    const loading = retainProjectRows(
      [],
      [
        makeRow(projectA, [], { threadListState: { status: "loading" } }),
        makeRow(projectB, [], { threadListState: { status: "loading" } }),
      ],
    );
    const ready = retainProjectRows(loading, [
      makeRow(projectA, [threadA1]),
      makeRow(projectB, []),
    ]);
    expect(ready[0]).not.toBe(loading[0]);
    expect(ready[1]).not.toBe(loading[1]);
    expect(ready[1].threadListState).toEqual({ status: "ready", threads: [] });

    const unavailable = retainProjectRows(ready, [
      makeRow(projectA, [], { threadListState: { status: "unavailable" } }),
      makeRow(projectB, [], { threadListState: { status: "unavailable" } }),
    ]);
    expect(unavailable[0]).not.toBe(ready[0]);
    expect(unavailable[1]).not.toBe(ready[1]);
  });

  it("replaces a row whose project object or flags changed", () => {
    const previous = retainProjectRows(
      [],
      [makeRow(projectA, [threadA1]), makeRow(projectB, [threadB1])],
    );
    const next = retainProjectRows(previous, [
      makeRow(makeProject("proj_a"), [threadA1]),
      makeRow(projectB, [threadB1], { isLocalPathInvalid: true }),
    ]);
    expect(next[0]).not.toBe(previous[0]);
    expect(next[1]).not.toBe(previous[1]);
    expect(next[1].isLocalPathInvalid).toBe(true);
  });

  it("drops a removed project and keeps the rest", () => {
    const previous = retainProjectRows(
      [],
      [makeRow(projectA, [threadA1]), makeRow(projectB, [threadB1])],
    );
    const next = retainProjectRows(previous, [makeRow(projectB, [threadB1])]);
    expect(next).toHaveLength(1);
    expect(next[0]).toBe(previous[1]);
  });
});

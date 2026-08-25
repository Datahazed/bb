import { describe, expect, it } from "vitest";
import {
  DEFAULT_SIDEBAR_THREAD_LIFECYCLE_SELECTION,
  getBuiltInSidebarLifecycleRenderState,
  isDefaultSidebarThreadLifecycleSelection,
  toggleSidebarThreadLifecycleState,
} from "./sidebarThreadLifecycle";

describe("sidebar thread lifecycle selection", () => {
  it("starts active-only and recognizes only that selection as the default", () => {
    expect([...DEFAULT_SIDEBAR_THREAD_LIFECYCLE_SELECTION]).toEqual(["active"]);
    expect(
      isDefaultSidebarThreadLifecycleSelection(
        DEFAULT_SIDEBAR_THREAD_LIFECYCLE_SELECTION,
      ),
    ).toBe(true);
    expect(
      isDefaultSidebarThreadLifecycleSelection(new Set(["active", "drafts"])),
    ).toBe(false);
  });

  it("builds clean unions while refusing to remove the final state", () => {
    const activeAndDrafts = toggleSidebarThreadLifecycleState(
      DEFAULT_SIDEBAR_THREAD_LIFECYCLE_SELECTION,
      "drafts",
    );
    expect([...activeAndDrafts]).toEqual(["active", "drafts"]);

    const draftsOnly = toggleSidebarThreadLifecycleState(
      activeAndDrafts,
      "active",
    );
    expect([...draftsOnly]).toEqual(["drafts"]);
    expect(toggleSidebarThreadLifecycleState(draftsOnly, "drafts")).toBe(
      draftsOnly,
    );
  });

  it("derives union visibility, loading, and filtered-empty states", () => {
    expect(
      getBuiltInSidebarLifecycleRenderState({
        activeCount: 0,
        archivedCount: 0,
        archivedHasNextPage: false,
        archivedIsPending: false,
        draftCount: 0,
        isReady: true,
        selection: DEFAULT_SIDEBAR_THREAD_LIFECYCLE_SELECTION,
      }),
    ).toEqual({
      showActiveModeSections: true,
      showArchivedOnlyControl: false,
      showFilteredEmptyState: false,
      showLifecycleControlOnlySection: false,
    });

    expect(
      getBuiltInSidebarLifecycleRenderState({
        activeCount: 0,
        archivedCount: 0,
        archivedHasNextPage: false,
        archivedIsPending: false,
        draftCount: 1,
        isReady: true,
        selection: new Set(["active", "drafts"]),
      }),
    ).toEqual({
      showActiveModeSections: false,
      showArchivedOnlyControl: false,
      showFilteredEmptyState: false,
      showLifecycleControlOnlySection: true,
    });

    expect(
      getBuiltInSidebarLifecycleRenderState({
        activeCount: 0,
        archivedCount: 0,
        archivedHasNextPage: false,
        archivedIsPending: true,
        draftCount: 0,
        isReady: true,
        selection: new Set(["archived"]),
      }),
    ).toEqual({
      showActiveModeSections: false,
      showArchivedOnlyControl: true,
      showFilteredEmptyState: false,
      showLifecycleControlOnlySection: true,
    });

    expect(
      getBuiltInSidebarLifecycleRenderState({
        activeCount: 0,
        archivedCount: 0,
        archivedHasNextPage: false,
        archivedIsPending: false,
        draftCount: 0,
        isReady: true,
        selection: new Set(["archived"]),
      }).showFilteredEmptyState,
    ).toBe(true);
  });
});

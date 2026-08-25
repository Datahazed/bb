import { describe, expect, it } from "vitest";
import {
  DEFAULT_SIDEBAR_THREAD_LIFECYCLE_SELECTION,
  isDefaultSidebarThreadLifecycleSelection,
  toggleSidebarThreadLifecycleState,
} from "./sidebarThreadLifecycle";

describe("sidebar thread lifecycle selection", () => {
  it("starts active-only and recognizes only that selection as the default", () => {
    expect([...DEFAULT_SIDEBAR_THREAD_LIFECYCLE_SELECTION]).toEqual([
      "active",
    ]);
    expect(
      isDefaultSidebarThreadLifecycleSelection(
        DEFAULT_SIDEBAR_THREAD_LIFECYCLE_SELECTION,
      ),
    ).toBe(true);
    expect(
      isDefaultSidebarThreadLifecycleSelection(
        new Set(["active", "drafts"]),
      ),
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
});

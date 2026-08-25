// @vitest-environment jsdom

import { createStore } from "jotai";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  moveSidebarTopLevelSection,
  normalizeHiddenSidebarTopLevelSectionIds,
  normalizeSidebarTopLevelSectionOrder,
  setSidebarTopLevelSectionHidden,
} from "./sidebarTopLevelSectionPreferences";

afterEach(() => {
  window.localStorage.clear();
  vi.resetModules();
});

describe("top-level sidebar section preferences", () => {
  it("skips unknown and duplicate ids without dropping valid persisted order", () => {
    expect(
      normalizeSidebarTopLevelSectionOrder([
        "plugin-pages",
        "future-section",
        "new-thread-extensions",
        "plugin-pages",
      ]),
    ).toEqual(["plugin-pages", "new-thread-extensions", "thread-list"]);
  });

  it("normalizes an unknown id from persisted order without dropping valid ids", async () => {
    window.localStorage.setItem(
      "bb.sidebar.topLevelSectionOrder",
      JSON.stringify([
        "plugin-pages",
        "future-section",
        "new-thread-extensions",
      ]),
    );

    vi.resetModules();
    const reloadedModule = await import("./sidebarTopLevelSectionPreferences");
    const reloadedStore = createStore();

    expect(
      reloadedStore.get(reloadedModule.sidebarTopLevelSectionOrderAtom),
    ).toEqual(["plugin-pages", "new-thread-extensions", "thread-list"]);
  });

  it("never admits the Thread list or unknown ids into the hidden set", () => {
    expect(
      normalizeHiddenSidebarTopLevelSectionIds([
        "thread-list",
        "plugin-pages",
        "future-section",
      ]),
    ).toEqual(["plugin-pages"]);
    expect(setSidebarTopLevelSectionHidden([], "thread-list", true)).toEqual(
      [],
    );
  });

  it("moves all three sections while hiding the first two independently", () => {
    expect(
      moveSidebarTopLevelSection(
        ["new-thread-extensions", "plugin-pages", "thread-list"],
        "thread-list",
        -1,
      ),
    ).toEqual(["new-thread-extensions", "thread-list", "plugin-pages"]);

    const firstHidden = setSidebarTopLevelSectionHidden(
      [],
      "new-thread-extensions",
      true,
    );
    expect(
      setSidebarTopLevelSectionHidden(firstHidden, "plugin-pages", true),
    ).toEqual(["new-thread-extensions", "plugin-pages"]);
  });

  it("persists order and hidden sections across a fresh atom import", async () => {
    const firstModule = await import("./sidebarTopLevelSectionPreferences");
    const firstStore = createStore();
    firstStore.set(firstModule.sidebarTopLevelSectionOrderAtom, [
      "thread-list",
      "plugin-pages",
      "new-thread-extensions",
    ]);
    firstStore.set(firstModule.hiddenSidebarTopLevelSectionIdsAtom, [
      "new-thread-extensions",
    ]);

    vi.resetModules();
    const reloadedModule = await import("./sidebarTopLevelSectionPreferences");
    const reloadedStore = createStore();

    expect(
      reloadedStore.get(reloadedModule.sidebarTopLevelSectionOrderAtom),
    ).toEqual(["thread-list", "plugin-pages", "new-thread-extensions"]);
    expect(
      reloadedStore.get(reloadedModule.hiddenSidebarTopLevelSectionIdsAtom),
    ).toEqual(["new-thread-extensions"]);
  });
});

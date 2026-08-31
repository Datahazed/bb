// @vitest-environment jsdom

import { createStore } from "jotai";
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  window.localStorage.clear();
  vi.resetModules();
});

describe("marketplace secondary panel width storage", () => {
  it("clamps an older out-of-range width before the panel lays out", async () => {
    window.localStorage.setItem(
      "bb.extensions.secondaryPanel.widthPercent",
      "68",
    );
    vi.resetModules();
    const { marketplaceSecondaryPanelWidthPercentAtom } = await import(
      "./threadSecondaryPanelAtoms"
    );

    expect(createStore().get(marketplaceSecondaryPanelWidthPercentAtom)).toBe(
      44,
    );
  });
});

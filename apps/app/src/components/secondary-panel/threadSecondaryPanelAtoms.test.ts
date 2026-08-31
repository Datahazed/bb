// @vitest-environment jsdom

import { createStore } from "jotai";
import { afterEach, describe, expect, it } from "vitest";
import { marketplaceSecondaryPanelWidthPercentAtom } from "./threadSecondaryPanelAtoms";

afterEach(() => {
  window.localStorage.clear();
});

describe("marketplace secondary panel width storage", () => {
  it("clamps an older out-of-range width before the panel lays out", () => {
    window.localStorage.setItem(
      "bb.extensions.secondaryPanel.widthPercent",
      "68",
    );

    expect(createStore().get(marketplaceSecondaryPanelWidthPercentAtom)).toBe(
      44,
    );
  });
});

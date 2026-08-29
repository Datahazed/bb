import { describe, expect, it } from "vitest";
import {
  clampMarketplaceNavWidth,
  marketplaceDetailMinPercent,
  marketplaceNavWidth,
  marketplacePaneWidths,
  MARKETPLACE_DETAIL_MAX_WIDTH_PERCENT,
  MARKETPLACE_DETAIL_MIN_WIDTH_PERCENT,
  MARKETPLACE_DETAIL_WIDTH_PERCENT,
  MARKETPLACE_INLINE_PANES_MIN_VIEWPORT,
  MARKETPLACE_NAV_MAX_WIDTH,
  MARKETPLACE_NAV_MIN_WIDTH,
} from "./marketplacePaneSizing";

const WIDEST_SUPPORTED_VIEWPORT = 2560;

describe("marketplace pane sizing", () => {
  it("keeps catalog widest and nav narrowest at every inline viewport", () => {
    for (
      let viewport = MARKETPLACE_INLINE_PANES_MIN_VIEWPORT;
      viewport <= WIDEST_SUPPORTED_VIEWPORT;
      viewport += 1
    ) {
      const { nav, catalog, detail } = marketplacePaneWidths(viewport);
      expect(
        { viewport, nav, catalog, detail, ordered: catalog > detail && detail > nav },
        `viewport ${viewport}`,
      ).toMatchObject({ ordered: true });
    }
  });

  it("holds that ordering at both ends of the drag range too", () => {
    for (
      let viewport = MARKETPLACE_INLINE_PANES_MIN_VIEWPORT;
      viewport <= WIDEST_SUPPORTED_VIEWPORT;
      viewport += 1
    ) {
      for (const percent of [
        marketplaceDetailMinPercent(viewport),
        MARKETPLACE_DETAIL_MAX_WIDTH_PERCENT,
      ]) {
        const { nav, catalog, detail } = marketplacePaneWidths(
          viewport,
          percent,
        );
        expect(
          { viewport, percent, ordered: catalog > detail && detail > nav },
          `viewport ${viewport} at ${percent}%`,
        ).toMatchObject({ ordered: true });
      }
    }
  });

  it("scales the nav with the viewport between its bounds", () => {
    expect(marketplaceNavWidth(1024)).toBe(MARKETPLACE_NAV_MIN_WIDTH);
    expect(marketplaceNavWidth(1440)).toBe(216);
    expect(marketplaceNavWidth(1680)).toBe(252);
    expect(marketplaceNavWidth(2560)).toBe(MARKETPLACE_NAV_MAX_WIDTH);
    expect(marketplaceNavWidth(1680)).toBeGreaterThan(
      marketplaceNavWidth(1440),
    );
  });

  it("never lets the detail pane reach half the group", () => {
    expect(MARKETPLACE_DETAIL_MAX_WIDTH_PERCENT).toBeLessThan(50);
    expect(MARKETPLACE_DETAIL_WIDTH_PERCENT).toBeLessThan(
      MARKETPLACE_DETAIL_MAX_WIDTH_PERCENT,
    );
  });

  it("raises the detail floor only where a flat one would invert the layout", () => {
    expect(marketplaceDetailMinPercent(768)).toBeGreaterThan(
      MARKETPLACE_DETAIL_MIN_WIDTH_PERCENT,
    );
    expect(marketplaceDetailMinPercent(1440)).toBe(
      MARKETPLACE_DETAIL_MIN_WIDTH_PERCENT,
    );
  });

  it("clamps a nav width dragged past either bound", () => {
    expect(clampMarketplaceNavWidth(40)).toBe(MARKETPLACE_NAV_MIN_WIDTH);
    expect(clampMarketplaceNavWidth(9000)).toBe(MARKETPLACE_NAV_MAX_WIDTH);
  });

  it("falls back to the minimum for a viewport it cannot measure", () => {
    expect(marketplaceNavWidth(0)).toBe(MARKETPLACE_NAV_MIN_WIDTH);
    expect(marketplaceNavWidth(Number.NaN)).toBe(MARKETPLACE_NAV_MIN_WIDTH);
  });
});

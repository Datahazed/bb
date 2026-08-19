import { describe, expect, it } from "vitest";

import {
  chooseCardPlacement,
  GUTTER_CARD_MARGIN,
  GUTTER_CARD_WIDTH,
} from "@bb/plugin-api-map";

/** A 1512px window with the 896px map column centred: ~300px gutters. */
const WIDE = { contentLeft: 308, contentRight: 1204, containerWidth: 1512 };
/** The same column with far more room around it, as when a panel collapses. */
const VERY_WIDE = {
  contentLeft: 700,
  contentRight: 1596,
  containerWidth: 2296,
};
/** A phone: the column fills the width, so there is no gutter either side. */
const NARROW = { contentLeft: 0, contentRight: 390, containerWidth: 390 };
/** An in-app panel: wide, but still no gutter that can hold the card. */
const PANEL = { contentLeft: 112, contentRight: 1008, containerWidth: 1120 };

describe("chooseCardPlacement", () => {
  it("anchors to the left gutter for a marker on the left of the column", () => {
    const placement = chooseCardPlacement({
      ...WIDE,
      markerCenterX: 400,
      markerTop: 500,
    });
    expect(placement.side).toBe("left");
  });

  it("anchors to the right gutter for a marker on the right of the column", () => {
    const placement = chooseCardPlacement({
      ...WIDE,
      markerCenterX: 1100,
      markerTop: 500,
    });
    expect(placement.side).toBe("right");
  });

  it("breaks a dead-centre tie toward the left gutter", () => {
    const placement = chooseCardPlacement({
      ...WIDE,
      markerCenterX: (WIDE.contentLeft + WIDE.contentRight) / 2,
      markerTop: 0,
    });
    expect(placement.side).toBe("left");
  });

  it("keeps a gutter card tight to the column however wide the page is", () => {
    // The regression this guards: pinning the card to the container's edge
    // strands it far from its marker as the space around the map grows.
    const gap = GUTTER_CARD_MARGIN;
    const left = chooseCardPlacement({
      ...VERY_WIDE,
      markerCenterX: 800,
      markerTop: 100,
    });
    expect(left.side).toBe("left");
    if (left.side !== "below") {
      expect(left.left + left.width).toBe(VERY_WIDE.contentLeft - gap);
    }

    const right = chooseCardPlacement({
      ...VERY_WIDE,
      markerCenterX: 1500,
      markerTop: 100,
    });
    expect(right.side).toBe("right");
    if (right.side !== "below") {
      expect(right.left).toBe(VERY_WIDE.contentRight + gap);
    }
  });

  it("goes below the diagram when neither gutter can hold it", () => {
    // Both a phone and a mid-width in-app panel: same in-flow fallback, so
    // the card is always visible and never covers the diagram.
    expect(
      chooseCardPlacement({ ...NARROW, markerCenterX: 120, markerTop: 740 })
        .side,
    ).toBe("below");
    expect(
      chooseCardPlacement({ ...PANEL, markerCenterX: 560, markerTop: 200 })
        .side,
    ).toBe("below");
  });

  it("uses the only gutter that fits, even if the marker is nearer the other", () => {
    // Room on the right only; a marker hard against the left edge still has
    // to use it, because the left gutter cannot hold the card.
    const placement = chooseCardPlacement({
      contentLeft: 8,
      contentRight: 900,
      containerWidth: 900 + GUTTER_CARD_WIDTH + GUTTER_CARD_MARGIN,
      markerCenterX: 20,
      markerTop: 0,
    });
    expect(placement.side).toBe("right");
  });

  it("keeps the card from being positioned above the container", () => {
    const placement = chooseCardPlacement({
      ...WIDE,
      markerCenterX: 400,
      markerTop: 4,
    });
    expect(placement.side).toBe("left");
    if (placement.side !== "below") {
      expect(placement.top).toBe(0);
    }
  });
});

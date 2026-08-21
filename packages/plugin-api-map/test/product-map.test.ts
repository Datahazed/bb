import { describe, expect, it } from "vitest";

import { panCarets, SURFACE_GROUPS } from "../src/index";

const LAST = SURFACE_GROUPS.length - 1;

describe("panCarets", () => {
  it("disables the caret that has nowhere to go", () => {
    // Both carets always render; the end of the range just disables its
    // caret, so the row's geometry never changes.
    expect(panCarets(0, SURFACE_GROUPS.length)).toEqual({
      previous: false,
      next: true,
    });
    expect(panCarets(LAST, SURFACE_GROUPS.length)).toEqual({
      previous: true,
      next: false,
    });
  });

  it("enables both carets everywhere in between", () => {
    for (let index = 1; index < LAST; index++) {
      expect(panCarets(index, SURFACE_GROUPS.length), `slide ${index}`).toEqual(
        {
          previous: true,
          next: true,
        },
      );
    }
  });

  it("disables both carets when there is a single slide", () => {
    expect(panCarets(0, 1)).toEqual({ previous: false, next: false });
  });
});

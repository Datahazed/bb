import { describe, expect, it } from "vitest";

import {
  annotationNeighbors,
  nextProductMapSurfaceId,
  panCarets,
  parseProductMapRoute,
  productMapSelection,
  productMapSubPathForSurface,
  SURFACE_GROUPS,
} from "../src/index";

const LAST = SURFACE_GROUPS.length - 1;

describe("panCarets", () => {
  it("disables the caret that has nowhere to go", () => {
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

describe("annotationNeighbors", () => {
  const surfaces = SURFACE_GROUPS[0]!.surfaces;

  it("moves through annotations in their authored numeric order", () => {
    expect(annotationNeighbors(surfaces, surfaces[1]!.id)).toEqual({
      previous: surfaces[0],
      next: surfaces[2],
    });
  });

  it("keeps the missing direction disabled at each endpoint", () => {
    expect(annotationNeighbors(surfaces, surfaces[0]!.id)).toEqual({
      previous: null,
      next: surfaces[1],
    });
    expect(annotationNeighbors(surfaces, surfaces.at(-1)!.id)).toEqual({
      previous: surfaces.at(-2),
      next: null,
    });
  });
});

describe("product map routes", () => {
  it("closes an annotation when its selected marker is clicked again", () => {
    expect(nextProductMapSurfaceId(null, "nav-panel")).toBe("nav-panel");
    expect(nextProductMapSurfaceId("nav-panel", "nav-panel")).toBeNull();
    expect(nextProductMapSurfaceId("nav-panel", "sidebar-navigation")).toBe(
      "sidebar-navigation",
    );
  });

  it("restores a page and annotation from the panel sub-path", () => {
    expect(parseProductMapRoute("composer/composer-plus-menu")).toEqual({
      slideId: "composer",
      surfaceId: "composer-plus-menu",
    });
    expect(productMapSelection("composer", "composer-plus-menu")).toEqual({
      index: SURFACE_GROUPS.findIndex((group) => group.id === "composer"),
      surfaceId: "composer-plus-menu",
    });
  });

  it("restores copied legacy annotation hashes", () => {
    expect(
      parseProductMapRoute("composer", "#surface-composer-plus-menu"),
    ).toEqual({
      slideId: "composer",
      surfaceId: "composer-plus-menu",
    });
  });

  it("uses the annotation's owning page when route segments disagree", () => {
    expect(parseProductMapRoute("settings/composer-plus-menu")).toEqual({
      slideId: "composer",
      surfaceId: "composer-plus-menu",
    });
  });

  it("builds canonical annotation sub-paths", () => {
    expect(productMapSubPathForSurface("composer-plus-menu")).toBe(
      "composer/composer-plus-menu",
    );
    expect(productMapSubPathForSurface("missing-surface")).toBeNull();
  });
});

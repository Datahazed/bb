import { describe, expect, it } from "vitest";

import { ANATOMY_MANIFEST as anatomy } from "@bb/plugin-api-map";
import { SECTION_BY_SYMBOL_NAME, sectionById } from "./content";
import {
  SURFACE_GROUPS,
  SURFACE_NUMBERS,
  SURFACES_BY_ID,
} from "@bb/plugin-api-map";
import {
  ANATOMY_RENDERER_KEYS,
  APP_SHELL_MARKS,
  COMPOSE_MARKS,
  COMPOSER_MARKS,
  SETTINGS_MARKS,
} from "@bb/plugin-api-map";

const groupById = new Map(SURFACE_GROUPS.map((group) => [group.id, group]));

function surfaceIds(groupId: string): string[] {
  return (groupById.get(groupId as never)?.surfaces ?? []).map(
    (surface) => surface.id,
  );
}

describe("product-map surfaces", () => {
  it("has globally unique surface ids", () => {
    const all = SURFACE_GROUPS.flatMap((group) =>
      group.surfaces.map((surface) => surface.id),
    );
    expect(new Set(all).size).toBe(all.length);
    expect(SURFACES_BY_ID.size).toBe(all.length);
  });

  it("links every surface to real reference sections and anchors", () => {
    const broken: string[] = [];
    for (const group of SURFACE_GROUPS) {
      for (const surface of group.surfaces) {
        expect(surface.links.length).toBeGreaterThan(0);
        for (const link of surface.links) {
          if (!sectionById(link.sectionId)) {
            broken.push(`${surface.id}: unknown section "${link.sectionId}"`);
            continue;
          }
          if (
            link.anchor &&
            SECTION_BY_SYMBOL_NAME.get(link.anchor) !== link.sectionId
          ) {
            // The anchor must be a real exported symbol AND rendered on the
            // page the link targets, or the deep link lands nowhere.
            broken.push(
              `${surface.id}: anchor "${link.anchor}" is not on section "${link.sectionId}"`,
            );
          }
        }
      }
    }
    expect(broken).toEqual([]);
  });

  it("marks every visual-group surface on its wireframe exactly once", () => {
    // One skeleton per carousel slide, so each group's surfaces must all be
    // marked on that group's own wireframe.
    expect([...APP_SHELL_MARKS].sort()).toEqual(surfaceIds("app-shell").sort());
    expect([...COMPOSER_MARKS].sort()).toEqual(surfaceIds("composer").sort());
    expect([...COMPOSE_MARKS].sort()).toEqual(surfaceIds("home").sort());
    expect([...SETTINGS_MARKS].sort()).toEqual(surfaceIds("settings").sort());
  });

  it("numbers the surfaces a skeleton draws, and only those", () => {
    // A numbered surface with no marker would print a number the diagram
    // never shows; an unnumbered marked surface renders an empty chip.
    for (const group of SURFACE_GROUPS) {
      const numbers = group.surfaces.map((surface) =>
        SURFACE_NUMBERS.get(surface.id),
      );
      if (group.id === "headless") {
        expect(numbers.every((number) => number === undefined)).toBe(true);
        continue;
      }
      expect(numbers).toEqual(group.surfaces.map((_, index) => index + 1));
    }
  });

  it("renders every anatomy-manifest region and nothing else", () => {
    // The skeletons draw these regions by mapping over the manifest, so a
    // manifest key without a renderer would silently drop UI, and a stale
    // renderer key would be dead code hiding a manifest drift.
    for (const area of [
      "appSidebar",
      "sidebarFooter",
      "messageActionBar",
    ] as const) {
      expect([...ANATOMY_RENDERER_KEYS[area]].sort()).toEqual(
        [...anatomy[area]].sort(),
      );
    }
  });

  it("clusters every headless surface into exactly one named section", () => {
    // The pixel-less slide renders FROM these sections, so a surface missing
    // from them would silently vanish from the map.
    const headless = groupById.get("headless" as never);
    const sectioned = (headless?.sections ?? []).flatMap(
      (section) => section.surfaceIds,
    );
    expect([...sectioned].sort()).toEqual(surfaceIds("headless").sort());
    expect(new Set(sectioned).size).toBe(sectioned.length);
  });

  it("keeps the headless group off the wireframes", () => {
    const marked = new Set<string>([
      ...APP_SHELL_MARKS,
      ...COMPOSER_MARKS,
      ...COMPOSE_MARKS,
      ...SETTINGS_MARKS,
    ]);
    for (const id of surfaceIds("headless")) {
      expect(marked.has(id)).toBe(false);
    }
  });
});

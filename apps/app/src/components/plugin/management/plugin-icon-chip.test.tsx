// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { RESOURCE_ICON_FRAME_SIZES } from "@bb/shared-ui/resource-list";
import { CatalogEntryIcon, CatalogEntryIconChip } from "./plugin-ui";

afterEach(cleanup);

const BASE = {
  displayName: "Memory",
  icon: "Brain",
  iconUrl: null,
  iconTinted: false,
  categoryId: "memory-and-context",
};

/** jsdom has no layout, so assert the classes that decide the geometry. */
function glyphOf(container: HTMLElement): Element {
  const glyph = container.querySelector("svg, img, [data-plugin-icon-asset]");
  if (glyph === null) throw new Error("no glyph rendered");
  return glyph;
}

describe("catalog entry icon chip", () => {
  it("sizes every icon variant to the frame's glyph size", () => {
    // Raster artwork, custom SVG artwork, and a placeholder glyph sit in the
    // same chip beside each other, so they have to resolve to one footprint.
    const variants = [
      { label: "placeholder", entry: BASE },
      {
        label: "artwork",
        entry: { ...BASE, iconUrl: "https://example.test/icon.png" },
      },
      {
        label: "custom SVG artwork",
        entry: {
          ...BASE,
          iconUrl: "https://example.test/icon.svg",
          iconTinted: true,
        },
      },
    ];
    for (const { label, entry } of variants) {
      const { container, unmount } = render(
        <CatalogEntryIconChip entry={entry} />,
      );
      const glyph = glyphOf(container);
      const owner =
        glyph.tagName === "svg" ? (glyph.parentElement ?? glyph) : glyph;
      expect(
        `${label}: ${owner.getAttribute("class") ?? ""} ${glyph.getAttribute("class") ?? ""}`,
      ).toContain(RESOURCE_ICON_FRAME_SIZES.md.glyph);
      unmount();
    }
  });

  it("keeps the placeholder glyph inside the footprint it is handed", () => {
    // The regression: the placeholder hardcoded a 20px mark, so in the 14px
    // box a 24px chip centres it overflowed — and an overflowing grid item
    // resolves to the start edge, which put it 3px right and 3px low of the
    // artwork it stands in for. It must fill its box, never exceed it.
    const { container } = render(
      <CatalogEntryIcon entry={BASE} className="size-3.5" />,
    );
    const glyph = glyphOf(container);
    expect(glyph.getAttribute("class")).toContain("size-full");
    expect(glyph.getAttribute("class")).not.toMatch(/size-\d/u);
  });

  it("centers the frame's contents", () => {
    const { container } = render(<CatalogEntryIconChip entry={BASE} />);
    const frame = container.firstElementChild;
    const frameClass = frame?.getAttribute("class") ?? "";
    expect(frameClass).toContain("items-center");
    expect(frameClass).toContain("justify-center");
    expect(frameClass).toContain(RESOURCE_ICON_FRAME_SIZES.md.frame);
  });

  it("keeps the tile neutral across categories", () => {
    const memory = render(<CatalogEntryIconChip entry={BASE} />);
    const security = render(
      <CatalogEntryIconChip entry={{ ...BASE, categoryId: "security" }} />,
    );

    expect(memory.container.firstElementChild?.getAttribute("style")).toBe(
      security.container.firstElementChild?.getAttribute("style"),
    );
  });

  it("renders one glyph per chip, so nothing stacks inside the frame", () => {
    render(<CatalogEntryIconChip entry={BASE} />);
    expect(
      document.querySelectorAll("svg, img, [data-plugin-icon-asset]"),
    ).toHaveLength(1);
    expect(screen.queryByRole("img")).toBeNull();
  });
});

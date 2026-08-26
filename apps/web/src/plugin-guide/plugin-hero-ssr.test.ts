import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { PluginBrowseHeroCarousel } from "@bb/showcase-hero";

describe("PluginBrowseHeroCarousel SSR", () => {
  it("ships static icon artwork instead of hydration-only placeholders", () => {
    const html = renderToStaticMarkup(
      createElement(PluginBrowseHeroCarousel, { autoplay: false }),
    );

    expect(html).not.toContain("data-icon-pending");
    for (const name of [
      "Beaker",
      "ChartColumn",
      "Columns2",
      "Folder",
      "ListTodo",
      "Mail",
      "MessageSquare",
      "Play",
      "UserRound",
    ]) {
      expect(html).toMatch(
        new RegExp(`<svg[^>]*data-icon="${name}"[^>]*><path`),
      );
    }
  });
});

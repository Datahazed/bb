import { SURFACE_GROUPS } from "@bb/plugin-api-map";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { PluginSurfaceDocument } from "./plugin-guide-page.js";

describe("PluginSurfaceDocument", () => {
  it("server-renders every title, summary, reference, and SDK symbol", () => {
    const html = renderToStaticMarkup(<PluginSurfaceDocument />);
    for (const group of SURFACE_GROUPS) {
      expect(html).toContain(group.title);
      for (const surface of group.surfaces) {
        expect(html).toContain(surface.title);
        expect(html).toContain(
          surface.summary.split(" ").slice(0, 4).join(" "),
        );
        for (const symbol of surface.apiSymbols) expect(html).toContain(symbol);
      }
    }
  });
});

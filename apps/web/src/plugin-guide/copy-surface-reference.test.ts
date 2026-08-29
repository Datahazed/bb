import { SURFACE_GROUPS } from "@bb/plugin-api-map";
import { describe, expect, it } from "vitest";

import { pluginSurfaceReferenceText } from "./copy-surface-reference.js";

describe("plugin surface references", () => {
  it("copies the package's plain-text agent reference", () => {
    const surface = SURFACE_GROUPS[0]!.surfaces[0]!;
    const text = pluginSurfaceReferenceText(surface);
    expect(text).toContain(surface.title);
    expect(text).toContain(surface.apiSymbols[0]!);
    expect(text).not.toContain("<");
  });
});

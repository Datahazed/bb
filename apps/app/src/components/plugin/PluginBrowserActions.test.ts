import { describe, expect, it } from "vitest";
import { browserActionInlineCount } from "./PluginBrowserActions";

describe("browserActionInlineCount", () => {
  it("keeps ordinary Browser chrome actions inline", () => {
    expect(browserActionInlineCount(3, 760)).toBe(3);
  });

  it("reserves one compact slot for host-owned overflow", () => {
    expect(browserActionInlineCount(3, 360)).toBe(0);
    expect(browserActionInlineCount(1, 360)).toBe(1);
  });

  it("does not overflow before the Browser chrome has measured", () => {
    expect(browserActionInlineCount(4, null)).toBe(4);
  });
});

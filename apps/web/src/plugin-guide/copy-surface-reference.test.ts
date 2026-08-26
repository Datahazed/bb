import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createPluginSurfaceAgentReference,
  SURFACE_GROUPS,
} from "@bb/plugin-api-map";

import {
  copyPlainText,
  copyPluginSurfaceReferenceText,
} from "./copy-surface-reference";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("copyPluginSurfaceReferenceText", () => {
  it("copies the exact text arm and skips every rich clipboard path", async () => {
    const surface = SURFACE_GROUPS[0]?.surfaces[0];
    expect(surface).toBeDefined();
    if (!surface) return;

    const writeText = vi.fn(async () => undefined);
    const write = vi.fn(async () => undefined);
    const ClipboardItem = vi.fn();
    vi.stubGlobal("navigator", { clipboard: { write, writeText } });
    vi.stubGlobal("ClipboardItem", ClipboardItem);

    await expect(copyPluginSurfaceReferenceText(surface)).resolves.toBe(true);
    expect(writeText).toHaveBeenCalledOnce();
    expect(writeText).toHaveBeenCalledWith(
      createPluginSurfaceAgentReference(surface).clipboard.text,
    );
    expect(write).not.toHaveBeenCalled();
    expect(ClipboardItem).not.toHaveBeenCalled();
  });

  it("shares the text-only path with generic prompt copying", async () => {
    const writeText = vi.fn(async () => undefined);
    const write = vi.fn(async () => undefined);
    vi.stubGlobal("navigator", { clipboard: { write, writeText } });

    await expect(copyPlainText("Build a plugin for me")).resolves.toBe(true);
    expect(writeText).toHaveBeenCalledWith("Build a plugin for me");
    expect(write).not.toHaveBeenCalled();
  });
});

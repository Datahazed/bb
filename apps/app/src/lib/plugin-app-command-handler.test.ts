import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clearPluginAppCommandHandlerByOwner,
  registerPluginAppCommandHandler,
  resetPluginAppCommandHandlerForTest,
  runPluginAppCommandHandler,
} from "./plugin-app-command-handler";

afterEach(resetPluginAppCommandHandlerForTest);

describe("plugin app command handler", () => {
  it("replaces owner-safely, contains failures, and cleans up by generation", async () => {
    const warn = vi.fn();
    const old = vi.fn();
    const current = vi.fn(async () => {
      throw new Error("failed");
    });
    const disposeOld = registerPluginAppCommandHandler(
      "plugin.inspector.toggle",
      old,
      "old-plugin",
      "old-owner",
    );
    registerPluginAppCommandHandler(
      "plugin.inspector.toggle",
      current,
      "guide",
      "current-owner",
    );

    disposeOld();
    expect(runPluginAppCommandHandler("plugin.inspector.toggle", warn)).toBe(
      true,
    );
    await Promise.resolve();
    expect(old).not.toHaveBeenCalled();
    expect(current).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(
      '[plugin:guide] app command "plugin.inspector.toggle" failed: failed',
    );

    clearPluginAppCommandHandlerByOwner("old-owner");
    expect(runPluginAppCommandHandler("plugin.inspector.toggle")).toBe(true);
    clearPluginAppCommandHandlerByOwner("current-owner");
    expect(runPluginAppCommandHandler("plugin.inspector.toggle")).toBe(false);
  });
});

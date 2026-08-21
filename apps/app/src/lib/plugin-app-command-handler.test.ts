// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  installForeignDomMutationGuard,
  pluginHostNodeMoveRefusalCount,
  uninstallForeignDomMutationGuardForTest,
} from "./foreign-dom-mutation-guard";
import {
  clearPluginAppCommandHandlerByOwner,
  registerPluginAppCommandHandler,
  resetPluginAppCommandHandlerForTest,
  runPluginAppCommandHandler,
} from "./plugin-app-command-handler";

afterEach(() => {
  resetPluginAppCommandHandlerForTest();
  uninstallForeignDomMutationGuardForTest();
});

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
    await vi.waitFor(() => {
      expect(warn).toHaveBeenCalledWith(
        '[plugin:guide] app command "plugin.inspector.toggle" failed: failed',
      );
    });

    clearPluginAppCommandHandlerByOwner("old-owner");
    expect(runPluginAppCommandHandler("plugin.inspector.toggle")).toBe(true);
    clearPluginAppCommandHandlerByOwner("current-owner");
    expect(runPluginAppCommandHandler("plugin.inspector.toggle")).toBe(false);
  });

  it("runs command callbacks inside the plugin DOM isolation fence", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    installForeignDomMutationGuard();
    const reactParent = document.createElement("div");
    const reactOwned = document.createElement("button");
    Object.defineProperty(reactOwned, "__reactFiber$test", { value: {} });
    reactParent.append(reactOwned);
    const foreignParent = document.createElement("section");
    registerPluginAppCommandHandler(
      "plugin.inspector.toggle",
      () => foreignParent.append(reactOwned),
      "guide",
      "owner",
    );

    expect(runPluginAppCommandHandler("plugin.inspector.toggle")).toBe(true);
    await Promise.resolve();
    await Promise.resolve();

    expect(reactOwned.parentNode).toBe(reactParent);
    expect(pluginHostNodeMoveRefusalCount()).toBe(1);
  });
});

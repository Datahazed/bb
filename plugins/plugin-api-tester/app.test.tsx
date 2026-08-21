// @vitest-environment jsdom
import { cleanup, fireEvent } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";

const app = await loadPluginApp(() => import("./app"));

afterEach(cleanup);

describe("Plugin API Tester app", () => {
  it("renders reactive appearance state and writes client preferences", async () => {
    expect(app.navPanels).toHaveLength(1);
    expect(app.navPanels[0]).toMatchObject({
      id: "plugin-api-tester",
      title: "Plugin API Tester",
      icon: "Beaker",
      path: "plugin-api-tester",
    });

    const slot = renderSlot(
      app.navPanels[0]!,
      { subPath: "" },
      {
        experimental_appearance: {
          colorMode: "dark",
          colorModePreference: "system",
        },
      },
    );
    expect(await slot.findByText("Plugin API Tester is active")).toBeTruthy();
    expect(slot.getByLabelText("Resolved color mode").textContent).toBe("dark");
    expect(slot.getByLabelText("Color mode preference").textContent).toBe(
      "system",
    );

    fireEvent.click(slot.getByRole("button", { name: "Light" }));
    expect(slot.inspection.experimental_appearancePreferenceCalls).toEqual([
      "light",
    ]);
    expect(slot.getByLabelText("Resolved color mode").textContent).toBe(
      "light",
    );
    expect(slot.getByLabelText("Color mode preference").textContent).toBe(
      "light",
    );

    await slot.behavior.experimental_setAppearance({
      colorMode: "dark",
      colorModePreference: "system",
    });
    expect(slot.getByLabelText("Resolved color mode").textContent).toBe("dark");
    expect(slot.getByLabelText("Color mode preference").textContent).toBe(
      "system",
    );
  });

  it("registers a footer shortcut to the plugin detail page", async () => {
    expect(app.sidebarFooterActions).toHaveLength(1);
    expect(app.sidebarFooterActions[0]).toMatchObject({
      id: "open-plugin-api-tester",
      title: "Plugin API Tester",
      icon: "Beaker",
    });

    const openSettings = vi.fn();
    await app.sidebarFooterActions[0]!.run({ openSettings });
    expect(openSettings).toHaveBeenCalledOnce();
  });
});

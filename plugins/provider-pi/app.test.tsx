// @vitest-environment jsdom

import { cleanup, fireEvent, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import type { PiModelSettingsSnapshot } from "./src/model-settings-contract.js";

const snapshot: PiModelSettingsSnapshot = {
  models: [
    {
      id: "anthropic/claude-sonnet-5",
      displayName: "Claude Sonnet 5",
      provider: "anthropic",
      reasoning: true,
    },
    {
      id: "openai/gpt-5.1",
      displayName: "GPT-5.1",
      provider: "openai",
      reasoning: true,
    },
    {
      id: "google/gemini-3-pro",
      displayName: "Gemini 3 Pro",
      provider: "google",
      reasoning: true,
    },
  ],
  enabledModelIds: ["anthropic/claude-sonnet-5"],
};

afterEach(cleanup);

describe("Pi model settings editor", () => {
  it("tracks unsaved changes, resets, saves, and enables all", async () => {
    const write = vi.fn((input: unknown) => ({
      ...snapshot,
      enabledModelIds: (input as { enabledModelIds: string[] | null }).enabledModelIds,
    }));
    const app = await loadPluginApp(() => import("./app.js"));
    const slot = renderSlot(
      app.settingsSections.find(({ id }) => id === "models")!,
      { experimental_hostId: "host-1" },
      {
        rpc: {
          readModelSettings: () => snapshot,
          writeModelSettings: write,
        },
      },
    );

    const gpt = await slot.findByRole("switch", {
      name: "Enable openai/gpt-5.1",
    });
    const search = slot.getByRole("textbox", { name: "Search Pi models" });
    fireEvent.change(search, { target: { value: "openai" } });
    expect(slot.queryByText("Gemini 3 Pro")).toBeNull();
    fireEvent.change(search, { target: { value: "" } });

    fireEvent.click(gpt);
    expect(slot.getByText("Unsaved changes")).toBeTruthy();
    expect(
      slot.getByText("2 of 3 models enabled for Pi cycling."),
    ).toBeTruthy();

    fireEvent.click(slot.getByRole("button", { name: "Reset" }));
    expect(slot.queryByText("Unsaved changes")).toBeNull();
    expect((gpt as HTMLButtonElement).getAttribute("data-state")).toBe(
      "unchecked",
    );

    fireEvent.click(gpt);
    fireEvent.click(slot.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(write).toHaveBeenCalledWith({
        hostId: "host-1",
        enabledModelIds: ["anthropic/claude-sonnet-5", "openai/gpt-5.1"],
      }),
    );
    await waitFor(() => expect(slot.queryByText("Unsaved changes")).toBeNull());

    fireEvent.click(
      slot.getByRole("switch", { name: "Enable openai/gpt-5.1" }),
    );
    fireEvent.click(slot.getByRole("button", { name: "Enable all" }));
    fireEvent.click(slot.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(write).toHaveBeenLastCalledWith({
        hostId: "host-1",
        enabledModelIds: null,
      }),
    );
  });

  it("shows the selected host's no-model authentication state", async () => {
    const app = await loadPluginApp(() => import("./app.js"));
    const slot = renderSlot(
      app.settingsSections.find(({ id }) => id === "models")!,
      { experimental_hostId: "host-empty" },
      {
        rpc: {
          readModelSettings: () => ({ models: [], enabledModelIds: null }),
        },
      },
    );

    expect(
      await slot.findByText(
        "No authenticated Pi models are available on this host. Run `pi` there to sign in.",
      ),
    ).toBeTruthy();
    expect(slot.inspection.rpcCalls[0]).toMatchObject({
      method: "readModelSettings",
      input: { hostId: "host-empty" },
    });
  });
});

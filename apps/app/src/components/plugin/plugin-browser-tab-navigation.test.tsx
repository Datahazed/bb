// @vitest-environment jsdom

import { useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useBbNavigate } from "@/lib/plugin-sdk-hooks";
import { PluginSlotMount } from "./PluginSlotMount";
import { PluginBrowserTabNavigationProvider } from "./plugin-browser-tab-navigation";

afterEach(cleanup);

function NavigationProbe() {
  const navigate = useBbNavigate();
  const [accepted, setAccepted] = useState<boolean | null>(null);
  return (
    <>
      <button
        type="button"
        onClick={() =>
          setAccepted(
            navigate.experimental_openBrowserTab({
              url: "https://github.com/get-bb/bb/pull/42",
            }),
          )
        }
      >
        Open Browser
      </button>
      <span>
        {accepted === null ? "idle" : accepted ? "accepted" : "rejected"}
      </span>
    </>
  );
}

function PluginProbe() {
  return (
    <PluginSlotMount pluginId="github" slotKind="test" slotId="navigation">
      <NavigationProbe />
    </PluginSlotMount>
  );
}

describe("plugin Browser-tab navigation", () => {
  it("forwards Browser-tab requests to the current nav-panel host", () => {
    const experimentalOpenBrowserTab = vi.fn(() => true);
    render(
      <MemoryRouter>
        <PluginBrowserTabNavigationProvider
          experimentalOpenBrowserTab={experimentalOpenBrowserTab}
        >
          <PluginProbe />
        </PluginBrowserTabNavigationProvider>
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Open Browser" }));

    expect(experimentalOpenBrowserTab).toHaveBeenCalledWith({
      url: "https://github.com/get-bb/bb/pull/42",
    });
    expect(screen.getByText("accepted")).toBeTruthy();
  });

  it("returns false outside a nav-panel Browser host", () => {
    render(
      <MemoryRouter>
        <PluginProbe />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Open Browser" }));

    expect(screen.getByText("rejected")).toBeTruthy();
  });
});

// @vitest-environment jsdom

import { useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useBbNavigate } from "@/lib/plugin-sdk-hooks";
import { PluginSlotMount } from "./PluginSlotMount";
import {
  PluginRightPanelNavigationBridgeProvider,
  PluginRightPanelNavigationProvider,
  useRegisterPluginRightPanelOpenHandler,
} from "./plugin-right-panel-navigation";

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
            navigate.experimental_openRightPanel({
              kind: "browser",
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

describe("plugin right-panel navigation", () => {
  it("bridges requests from nav-panel header content to the mounted host", () => {
    const experimentalOpenRightPanel = vi.fn(() => true);
    function Registrar() {
      useRegisterPluginRightPanelOpenHandler(
        "plugin-panel:github:activity:standalone",
        experimentalOpenRightPanel,
      );
      return null;
    }
    render(
      <MemoryRouter>
        <Registrar />
        <PluginRightPanelNavigationBridgeProvider panelStateId="plugin-panel:github:activity:standalone">
          <PluginProbe />
        </PluginRightPanelNavigationBridgeProvider>
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Open Browser" }));

    expect(experimentalOpenRightPanel).toHaveBeenCalledOnce();
    expect(screen.getByText("accepted")).toBeTruthy();
  });

  it("forwards Browser-tab requests to the current nav-panel host", () => {
    const experimentalOpenRightPanel = vi.fn(() => true);
    render(
      <MemoryRouter>
        <PluginRightPanelNavigationProvider
          experimentalOpenRightPanel={experimentalOpenRightPanel}
        >
          <PluginProbe />
        </PluginRightPanelNavigationProvider>
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Open Browser" }));

    expect(experimentalOpenRightPanel).toHaveBeenCalledWith({
      kind: "browser",
      url: "https://github.com/get-bb/bb/pull/42",
    });
    expect(screen.getByText("accepted")).toBeTruthy();
  });

  it("returns false outside a nav-panel right-panel host", () => {
    render(
      <MemoryRouter>
        <PluginProbe />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Open Browser" }));

    expect(screen.getByText("rejected")).toBeTruthy();
  });
});

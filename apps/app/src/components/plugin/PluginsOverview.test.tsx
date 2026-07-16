// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import type { SystemConfigResponse } from "@bb/server-contract";
import {
  defaultAppSettings,
  defaultAppTheme,
  defaultExperiments,
} from "@bb/domain";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";
import { PluginsOverview } from "./PluginsOverview";

function responseJson(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function systemConfig(pluginsEnabled: boolean): SystemConfigResponse {
  return {
    generalSettings: defaultAppSettings,
    keybindings: [],
    defaultKeybindings: [],
    keybindingOverrides: [],
    experiments: { ...defaultExperiments, plugins: pluginsEnabled },
    appearance: defaultAppTheme,
    customThemes: [],
    pluginThemes: [],
    featureFlags: { placeholder: false },
    hostDaemonPort: null,
    primaryHostId: null,
    primaryHostPlatform: null,
    voiceTranscriptionEnabled: false,
    dataDir: "/tmp/bb-test",
  };
}

const AUTOMATIONS_PLUGIN = {
  id: "automations",
  source: "builtin:automations",
  rootDir: "/plugins/automations",
  version: "0.1.0",
  enabled: true,
  status: "running",
  statusDetail: null,
  description: "Schedule recurring and one-shot agent or script work.",
  displayName: "Automations",
  icon: "Clock",
  logoUrl: null,
  logoDarkUrl: null,
  hasSettings: false,
  provenance: "builtin",
  marketplaceName: null,
  sourceDisplay: "builtin · automations",
  updateState: {},
};

const BB_OFFICIAL_MARKETPLACE = {
  id: "bb-official",
  name: "bb-official",
  displayName: "BB Official",
  source: "https://github.com/ymichael/bb.git@main",
  pluginCount: 3,
};

const GITHUB_MARKETPLACE_ENTRY = {
  marketplaceId: "bb-official",
  entryId: "github",
  displayName: "GitHub",
  description: "Browse GitHub issues and pull requests in BB.",
  icon: "Github",
  category: "Developer tools",
  source: "github-release:ymichael/bb/bb-plugin-github-{version}.tgz@^0.1.0",
  installed: false,
  compatible: true,
};

function installFetch(
  pluginsEnabled = true,
  plugins: readonly unknown[] = [AUTOMATIONS_PLUGIN],
) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const rawUrl =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input.url;
      const url = new URL(rawUrl, "http://localhost");
      if (url.pathname === "/api/v1/system/config") {
        return responseJson(systemConfig(pluginsEnabled));
      }
      if (url.pathname === "/api/v1/plugins") {
        return responseJson({
          enabled: pluginsEnabled,
          plugins,
        });
      }
      if (url.pathname === "/api/v1/marketplaces") {
        return responseJson({ marketplaces: [BB_OFFICIAL_MARKETPLACE] });
      }
      if (url.pathname === "/api/v1/marketplaces/search") {
        return responseJson({ results: [GITHUB_MARKETPLACE_ENTRY] });
      }
      return responseJson({ error: "not found" }, 404);
    }),
  );
}

function LocationPath() {
  return <span data-testid="location-path">{useLocation().pathname}</span>;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("PluginsOverview", () => {
  it("renders Installed, Browse, and Marketplaces as real collection projections", async () => {
    installFetch();
    const { wrapper: QueryClientWrapper } = createQueryClientTestHarness();
    render(
      <MemoryRouter initialEntries={["/tools/plugins"]}>
        <QueryClientWrapper>
          <PluginsOverview />
        </QueryClientWrapper>
      </MemoryRouter>,
    );

    expect(await screen.findByText("Automations")).toBeTruthy();
    const installedTab = screen.getByRole("tab", {
      name: "Installed, 1 plugin",
    });
    expect(installedTab.className).toContain("cursor-pointer");
    expect(screen.getByRole("tab", { name: "Browse" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "New plugin" })).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "New plugin options" }),
    ).toBeTruthy();
    const marketplacesTab = await screen.findByRole("tab", {
      name: "Marketplaces, 1 marketplace",
    });

    fireEvent.click(screen.getByRole("tab", { name: "Browse" }));
    expect(await screen.findByText("GitHub")).toBeTruthy();

    fireEvent.click(marketplacesTab);
    expect(await screen.findByText("BB Official")).toBeTruthy();
    expect(
      screen.getByText(
        "Marketplaces are catalogs, not installed code. Adding or refreshing one never installs or runs a plugin.",
      ),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Add marketplace" }),
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: "New plugin" })).toBeNull();
  });

  it("opens installed resources on the canonical Tools detail route", async () => {
    installFetch();
    const { wrapper: QueryClientWrapper } = createQueryClientTestHarness();
    render(
      <MemoryRouter initialEntries={["/tools/plugins"]}>
        <QueryClientWrapper>
          <Routes>
            <Route path="/tools/plugins" element={<PluginsOverview />} />
            <Route path="*" element={<LocationPath />} />
          </Routes>
        </QueryClientWrapper>
      </MemoryRouter>,
    );

    fireEvent.click(
      await screen.findByRole("link", {
        name: "Automations plugin details",
      }),
    );
    expect(screen.getByTestId("location-path").textContent).toBe(
      "/tools/plugins/automations",
    );
  });

  it("paginates the installed plugin projection", async () => {
    const plugins = Array.from({ length: 12 }, (_, index) => {
      const ordinal = String(index + 1).padStart(2, "0");
      return {
        ...AUTOMATIONS_PLUGIN,
        id: `plugin-${ordinal}`,
        source: `builtin:plugin-${ordinal}`,
        displayName: `Plugin ${ordinal}`,
      };
    });
    installFetch(true, plugins);
    const { wrapper: QueryClientWrapper } = createQueryClientTestHarness();
    render(
      <MemoryRouter initialEntries={["/tools/plugins"]}>
        <QueryClientWrapper>
          <PluginsOverview />
        </QueryClientWrapper>
      </MemoryRouter>,
    );

    expect(await screen.findByText("Plugin 01")).toBeTruthy();
    expect(screen.getByText("1–10 of 12")).toBeTruthy();
    expect(screen.queryByText("Plugin 11")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Next" }));

    expect(screen.getByText("11–12 of 12")).toBeTruthy();
    expect(screen.getByText("Plugin 11")).toBeTruthy();
    expect(screen.queryByText("Plugin 01")).toBeNull();

    fireEvent.change(
      screen.getByRole("textbox", { name: "Search installed plugins" }),
      { target: { value: "Plugin 01" } },
    );

    expect(screen.getByText("Plugin 01")).toBeTruthy();
    expect(
      screen.queryByRole("navigation", { name: "Results pagination" }),
    ).toBeNull();
  });

  it("keeps installed plugins visible when marketplace management is off", async () => {
    installFetch(false);
    const { wrapper: QueryClientWrapper } = createQueryClientTestHarness();
    render(
      <MemoryRouter initialEntries={["/tools/plugins?view=browse"]}>
        <QueryClientWrapper>
          <PluginsOverview />
        </QueryClientWrapper>
      </MemoryRouter>,
    );

    expect(await screen.findByText("Automations")).toBeTruthy();
    expect(screen.queryByRole("tab", { name: "Browse" })).toBeNull();
    expect(screen.getByText(/Browsing and installation are off/)).toBeTruthy();
  });
});

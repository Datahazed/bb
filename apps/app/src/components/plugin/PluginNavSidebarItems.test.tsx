// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { createStore, Provider } from "jotai";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SidebarProvider } from "@/components/ui/sidebar.js";
import { createAppQueryClient } from "@/lib/query-client";
import {
  resetPluginSlotStoreForTest,
  setPluginSlotRegistrations,
  type PluginRegistrationSet,
} from "@/lib/plugin-slots";
import { PluginNavSidebarItems } from "./PluginNavSidebarItems";
import { pluginNavPanelOrderAtom } from "./pluginNavSidebarAtoms";

function registrationSet(
  overrides: Partial<PluginRegistrationSet>,
): PluginRegistrationSet {
  return {
    homepageSections: [],
    settingsSections: [],
    navPanels: [],
    threadPanelActions: [],
    sidebarFooterActions: [],
    fileOpeners: [],
    messageDirectives: [],
    ...overrides,
  };
}

function registerPanel(pluginId: string, title: string) {
  setPluginSlotRegistrations(
    pluginId,
    registrationSet({
      navPanels: [
        {
          id: "main",
          title,
          icon: "Puzzle",
          path: "main",
          component: () => null,
        },
      ],
    }),
  );
}

function responseJson(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** An installed-plugin row as GET /api/v1/plugins reports it. */
function installedPlugin(overrides: Record<string, unknown>) {
  return {
    id: "docs",
    source: "builtin:docs",
    rootDir: "/plugins/docs",
    version: "0.1.0",
    enabled: true,
    status: "running",
    statusDetail: null,
    description: "Create and edit Markdown documents.",
    name: "Docs",
    icon: "FileText",
    iconUrl: null,
    logoUrl: null,
    logoDarkUrl: null,
    hasSettings: false,
    provenance: "builtin",
    isOrphanedBuiltin: false,
    sourceDisplay: "builtin · docs",
    updateState: {},
    handlerStats: { count: 0, totalMs: 0, maxMs: 0, errorCount: 0 },
    services: [],
    schedules: [],
    cliCommand: null,
    capabilities: [],
    app: { hasApp: true, bundle: null },
    ...overrides,
  };
}

const DOCS_PLUGIN = installedPlugin({});
// A catalog install is the removable case: bb owns the downloaded files.
const GITHUB_PLUGIN = installedPlugin({
  id: "github",
  name: "GitHub",
  source: "github-release:bb/github@^0.1.0",
  rootDir: "/official-plugins/github",
  provenance: "catalog",
  sourceDisplay: "BB Official · GitHub",
});

function installFetch(plugins: readonly unknown[] = [DOCS_PLUGIN]) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const rawUrl =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url;
    const url = new URL(rawUrl, "http://localhost");
    if (url.pathname === "/api/v1/plugins") return responseJson({ plugins });
    if (/^\/api\/v1\/plugins\/[^/]+\/(enable|disable)$/.test(url.pathname)) {
      return responseJson({ ok: true, plugin: plugins[0] });
    }
    if (/^\/api\/v1\/plugins\/[^/]+$/.test(url.pathname)) {
      return responseJson({ ok: true });
    }
    return responseJson({ error: "not found" }, 404);
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function requestedPaths(fetchMock: ReturnType<typeof installFetch>): string[] {
  return fetchMock.mock.calls.map((call) => {
    const [input] = call;
    const rawUrl =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url;
    return new URL(rawUrl, "http://localhost").pathname;
  });
}

function LocationPath() {
  return <span data-testid="location-path">{useLocation().pathname}</span>;
}

function renderSidebarItems(
  options: {
    toolsRoutePath?: string;
    storedOrder?: string[];
    initialPath?: string;
  } = {},
) {
  const store = createStore();
  // Seed the store rather than localStorage: the storage atom captured its
  // initial value when this module was imported, before the test could write.
  if (options.storedOrder) {
    store.set(pluginNavPanelOrderAtom, options.storedOrder);
  }
  const queryClient = createAppQueryClient({
    defaultOptions: {
      mutations: { retry: false },
      queries: { gcTime: Infinity, retry: false },
    },
  });
  return render(
    <Provider store={store}>
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={[options.initialPath ?? "/"]}>
          <SidebarProvider>
            <PluginNavSidebarItems toolsRoutePath={options.toolsRoutePath} />
          </SidebarProvider>
          <LocationPath />
        </MemoryRouter>
      </QueryClientProvider>
    </Provider>,
  );
}

/** Labels of the items in the currently open menu, top to bottom. */
function openMenuItemLabels(): string[] {
  return screen
    .getAllByRole("menuitem")
    .map((item) => item.textContent?.trim() ?? "");
}

async function openRowMenu(rowTitle: string) {
  fireEvent.pointerDown(
    screen.getByRole("button", { name: `${rowTitle} panel options` }),
    { button: 0 },
  );
  await screen.findByRole("menuitem", { name: "Hide from sidebar" });
}

const ROW_LABELS = new Set(["Extensions", "Docs", "GitHub"]);

function panelRowNames(): string[] {
  return screen
    .getAllByRole("button")
    .map((button) => button.textContent?.trim() ?? "")
    .filter((label) => ROW_LABELS.has(label));
}

beforeEach(() => {
  window.localStorage.clear();
  installFetch();
});

afterEach(() => {
  cleanup();
  resetPluginSlotStoreForTest();
  window.localStorage.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("PluginNavSidebarItems", () => {
  it("moves a hidden panel into an expanded More disclosure and back", async () => {
    registerPanel("docs", "Docs");
    registerPanel("github", "GitHub");

    renderSidebarItems();

    expect(panelRowNames()).toEqual(["Docs", "GitHub"]);
    expect(
      screen.queryByTestId("plugin-nav-sidebar-overflow-toggle"),
    ).toBeNull();

    fireEvent.pointerDown(
      screen.getByRole("button", { name: "Docs panel options" }),
      { button: 0 },
    );
    fireEvent.click(
      await screen.findByRole("menuitem", { name: "Hide from sidebar" }),
    );

    // The row moves under a collapsed "More (1)" — hiding never expands the
    // disclosure, so the sidebar doesn't grow back to its old height.
    await waitFor(() => {
      expect(
        screen.getByTestId("plugin-nav-sidebar-overflow-toggle").textContent,
      ).toContain("More (1)");
    });
    expect(panelRowNames()).toEqual(["GitHub"]);
    expect(
      window.localStorage.getItem("bb.sidebar.hiddenPluginPanels"),
    ).toContain("docs/main");

    fireEvent.click(screen.getByTestId("plugin-nav-sidebar-overflow-toggle"));
    await waitFor(() => {
      expect(panelRowNames()).toEqual(["GitHub", "Docs"]);
    });

    fireEvent.pointerDown(
      screen.getByRole("button", { name: "Docs panel options" }),
      { button: 0 },
    );
    fireEvent.click(
      await screen.findByRole("menuitem", { name: "Show in sidebar" }),
    );

    await waitFor(() => {
      expect(
        screen.queryByTestId("plugin-nav-sidebar-overflow-toggle"),
      ).toBeNull();
    });
    // Unhiding restores the panel's original slot rather than appending it.
    expect(panelRowNames()).toEqual(["Docs", "GitHub"]);
  });

  it("collapses hidden panels behind the More toggle on a later mount", async () => {
    registerPanel("docs", "Docs");
    registerPanel("github", "GitHub");
    window.localStorage.setItem(
      "bb.sidebar.hiddenPluginPanels",
      JSON.stringify(["docs/main"]),
    );

    renderSidebarItems();

    expect(panelRowNames()).toEqual(["GitHub"]);
    const toggle = screen.getByTestId("plugin-nav-sidebar-overflow-toggle");
    expect(toggle.textContent).toContain("More (1)");

    fireEvent.click(toggle);
    await waitFor(() => {
      expect(panelRowNames()).toEqual(["GitHub", "Docs"]);
    });
  });

  it("hides the built-in Extensions row like a plugin row", async () => {
    registerPanel("docs", "Docs");

    renderSidebarItems({ toolsRoutePath: "/tools/skills" });

    // Extensions leads the list, above the plugin rows.
    expect(panelRowNames()).toEqual(["Extensions", "Docs"]);

    fireEvent.pointerDown(
      screen.getByRole("button", { name: "Extensions panel options" }),
      { button: 0 },
    );
    fireEvent.click(
      await screen.findByRole("menuitem", { name: "Hide from sidebar" }),
    );

    await waitFor(() => {
      expect(panelRowNames()).toEqual(["Docs"]);
    });
    expect(
      screen.getByTestId("plugin-nav-sidebar-overflow-toggle").textContent,
    ).toContain("More (1)");
    expect(
      window.localStorage.getItem("bb.sidebar.hiddenPluginPanels"),
    ).toContain("__builtin__/tools");
  });

  it("keeps Extensions on top for users who already reordered their plugin rows", () => {
    registerPanel("docs", "Docs");
    registerPanel("github", "GitHub");

    renderSidebarItems({
      toolsRoutePath: "/tools/skills",
      storedOrder: ["github/main", "docs/main"],
    });

    expect(panelRowNames()).toEqual(["Extensions", "GitHub", "Docs"]);
  });

  it("keeps a saved order when plugin frontends register after the first render", async () => {
    // The Extensions row makes this list mount before any plugin has registered.
    // The order effect must not save that empty snapshot over the user's rows.
    renderSidebarItems({
      toolsRoutePath: "/tools/skills",
      storedOrder: ["github/main", "__builtin__/tools", "docs/main"],
    });

    expect(panelRowNames()).toEqual(["Extensions"]);

    registerPanel("docs", "Docs");
    registerPanel("github", "GitHub");

    await waitFor(() => {
      expect(panelRowNames()).toEqual(["GitHub", "Extensions", "Docs"]);
    });
  });

  it("puts the lifecycle actions under the existing visibility item, destructive last", async () => {
    installFetch([DOCS_PLUGIN, GITHUB_PLUGIN]);
    registerPanel("docs", "Docs");
    registerPanel("github", "GitHub");

    renderSidebarItems();

    // Wait for the installed list: the actions need real enabled/provenance
    // state before they can label themselves.
    await openRowMenu("GitHub");
    await waitFor(() => {
      expect(openMenuItemLabels()).toEqual([
        "Hide from sidebar",
        "Disable",
        "Uninstall",
      ]);
    });
    const uninstall = screen.getByRole("menuitem", { name: "Uninstall" });
    expect(uninstall.className).toContain("text-destructive");
    expect(uninstall.getAttribute("aria-disabled")).not.toEqual("true");
  });

  it("refuses to uninstall a plugin that ships with bb", async () => {
    registerPanel("docs", "Docs");

    renderSidebarItems();

    await openRowMenu("Docs");
    await waitFor(() => {
      expect(openMenuItemLabels()).toContain("Uninstall");
    });
    const uninstall = screen.getByRole("menuitem", { name: "Uninstall" });
    expect(uninstall.getAttribute("aria-disabled")).toEqual("true");
    expect(uninstall.getAttribute("title")).toEqual(
      "Included with BB; disable this plugin instead.",
    );
  });

  it("disables a plugin through the same route the Extensions page calls", async () => {
    const fetchMock = installFetch();
    registerPanel("docs", "Docs");

    renderSidebarItems();

    await openRowMenu("Docs");
    fireEvent.click(await screen.findByRole("menuitem", { name: "Disable" }));

    await waitFor(() => {
      expect(requestedPaths(fetchMock)).toContain(
        "/api/v1/plugins/docs/disable",
      );
    });
  });

  it("offers Enable, and enables, for a plugin that is already disabled", async () => {
    const fetchMock = installFetch([
      installedPlugin({ enabled: false, status: "disabled" }),
    ]);
    registerPanel("docs", "Docs");

    renderSidebarItems();

    await openRowMenu("Docs");
    await waitFor(() => {
      expect(openMenuItemLabels()).toContain("Enable");
    });
    expect(openMenuItemLabels()).not.toContain("Disable");

    fireEvent.click(screen.getByRole("menuitem", { name: "Enable" }));
    await waitFor(() => {
      expect(requestedPaths(fetchMock)).toContain("/api/v1/plugins/docs/enable");
    });
  });

  it("confirms an uninstall, then leaves the removed plugin's panel route", async () => {
    const fetchMock = installFetch([GITHUB_PLUGIN]);
    registerPanel("github", "GitHub");

    renderSidebarItems({ initialPath: "/plugins/github/main" });

    await openRowMenu("GitHub");
    await waitFor(() => {
      expect(openMenuItemLabels()).toContain("Uninstall");
    });
    fireEvent.click(screen.getByRole("menuitem", { name: "Uninstall" }));

    // Destructive actions never fire straight off the menu.
    expect(await screen.findByText("Uninstall plugin?")).toBeTruthy();
    expect(requestedPaths(fetchMock)).not.toContain("/api/v1/plugins/github");

    fireEvent.click(screen.getByRole("button", { name: "Uninstall" }));

    await waitFor(() => {
      expect(requestedPaths(fetchMock)).toContain("/api/v1/plugins/github");
    });
    await waitFor(() => {
      expect(screen.getByTestId("location-path").textContent).toEqual("/");
    });
  });

  it("keeps the Extensions row's menu to its visibility item", async () => {
    registerPanel("docs", "Docs");

    renderSidebarItems({ toolsRoutePath: "/tools/plugins" });

    await openRowMenu("Extensions");
    // Give the installed list the same chance to land that a plugin row gets.
    await waitFor(() => {
      expect(screen.getByTestId("plugin-nav-sidebar-items")).toBeTruthy();
    });
    expect(openMenuItemLabels()).toEqual(["Hide from sidebar"]);
  });

  it("saves no Extensions key while the row is absent", async () => {
    registerPanel("docs", "Docs");

    // Extensions is off, so nothing should reserve a slot for a row that never
    // renders here.
    renderSidebarItems({ storedOrder: ["docs/main"] });

    await waitFor(() => {
      expect(panelRowNames()).toEqual(["Docs"]);
    });
    expect(
      window.localStorage.getItem("bb.sidebar.pluginPanelOrder") ?? "",
    ).not.toContain("__builtin__/tools");
  });
});

// @vitest-environment jsdom

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import {
  MemoryRouter,
  Route,
  Routes,
  useLocation,
  useSearchParams,
} from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { focusManager } from "@tanstack/react-query";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";
import { makeSystemConfig } from "@/test/fixtures/system-config";
import { SidebarHistoryNavigationControls } from "@/components/sidebar/SidebarHistoryNavigationControls";
import { resetAppRouteHistoryForTest } from "@/lib/app-route-history";
import { PluginsOverview } from "./PluginsOverview";

vi.mock("@/components/plugin/PluginNewThreadComposer", () => ({
  PluginNewThreadComposer: ({ initialPrompt }: { initialPrompt?: string }) => (
    <div data-testid="inline-composer">{initialPrompt}</div>
  ),
}));

function SwitchViewButton({ view }: { view: "browse" | "installed" }) {
  const [, setSearchParams] = useSearchParams();
  return (
    <button
      type="button"
      onClick={() => setSearchParams(view === "browse" ? {} : { view })}
    >
      {`switch-to-${view}`}
    </button>
  );
}

function responseJson(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
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
  name: "Automations",
  icon: "Clock",
  iconUrl: null,
  logoUrl: null,
  logoDarkUrl: null,
  hasSettings: false,
  provenance: "builtin",
  publisherKey: "builtin",
  publisherLabel: "BB Official",
  isOrphanedBuiltin: false,
  sourceDisplay: "builtin · automations",
  updateState: {},
  handlerStats: { count: 0, totalMs: 0, maxMs: 0, errorCount: 0 },
  services: [],
  schedules: [],
  cliCommand: null,
  app: { hasApp: true, bundle: null },
};

const GITHUB_CATALOG_ENTRY = {
  entryId: "github",
  pluginId: "github",
  displayName: "GitHub",
  description: "Browse GitHub issues and pull requests in BB.",
  icon: "Github",
  iconUrl: null,
  categoryId: "code-and-reviews",
  category: "Developer tools",
  source: "github-release:ymichael/bb/bb-plugin-github-{version}.tgz@^0.1.0",
  marketplace: "bb-community",
  marketplaceDisplayName: "BB Official",
  publisherKey: "builtin",
  publisherLabel: "BB Official",
  official: true,
  author: null,
  installed: false,
  compatible: true,
  incompatibleReason: null,
};

const AUTOMATIONS_CATALOG_ENTRY = {
  ...GITHUB_CATALOG_ENTRY,
  entryId: "automations",
  pluginId: "automations",
  displayName: "Automations",
  description: AUTOMATIONS_PLUGIN.description,
  icon: AUTOMATIONS_PLUGIN.icon,
  categoryId: "tasks-workflows",
  category: "Tasks & Workflows",
  source: AUTOMATIONS_PLUGIN.source,
  installed: true,
};

const DOCS_CATALOG_ENTRY = {
  ...GITHUB_CATALOG_ENTRY,
  entryId: "docs",
  pluginId: "simple-notes",
  displayName: "Docs",
  description: "Create and edit Markdown documents.",
  icon: "NotebookText",
  categoryId: "files-and-viewers",
  category: "File Viewers & Editors",
  source: "builtin:docs",
  installed: true,
};

function installFetch(plugins: readonly unknown[] = [AUTOMATIONS_PLUGIN]) {
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
        return responseJson(makeSystemConfig());
      }
      if (url.pathname === "/api/v1/plugins") {
        return responseJson({ plugins });
      }
      if (url.pathname === "/api/v1/plugin-catalog") {
        return responseJson({
          catalog: {
            pluginCount: 13,
            includedPluginCount: 8,
            optionalPluginCount: 5,
          },
        });
      }
      if (url.pathname === "/api/v1/plugin-catalog/search") {
        return responseJson({
          results: [
            AUTOMATIONS_CATALOG_ENTRY,
            DOCS_CATALOG_ENTRY,
            GITHUB_CATALOG_ENTRY,
          ],
        });
      }
      if (url.pathname === "/api/v1/plugin-catalog/install") {
        return responseJson({
          ok: true,
          plugin: {
            ...AUTOMATIONS_PLUGIN,
            id: "github",
            source: GITHUB_CATALOG_ENTRY.source,
            rootDir: "/plugins/github",
            name: GITHUB_CATALOG_ENTRY.displayName,
            description: GITHUB_CATALOG_ENTRY.description,
            icon: GITHUB_CATALOG_ENTRY.icon,
            provenance: "catalog",
            publisherKey: "bb-community",
            publisherLabel: "BB Community",
            catalogEntryId: GITHUB_CATALOG_ENTRY.entryId,
            sourceDisplay: "BB Official · GitHub",
          },
        });
      }
      if (url.pathname === "/api/v1/plugin-listings") {
        return responseJson({ records: [], notices: [] });
      }
      return responseJson({ error: "not found" }, 404);
    }),
  );
}

function LocationPath() {
  return <span data-testid="location-path">{useLocation().pathname}</span>;
}

function LocationSearch() {
  return <span data-testid="location-search">{useLocation().search}</span>;
}

afterEach(() => {
  focusManager.setFocused(undefined);
  cleanup();
  resetAppRouteHistoryForTest();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("PluginsOverview", () => {
  it("redirects an empty Installed collection to Browse", async () => {
    installFetch([]);
    const { wrapper: QueryClientWrapper } = createQueryClientTestHarness();
    render(
      <MemoryRouter initialEntries={["/extensions/plugins?view=installed"]}>
        <QueryClientWrapper>
          <PluginsOverview />
          <LocationSearch />
        </QueryClientWrapper>
      </MemoryRouter>,
    );

    expect((await screen.findAllByText("GitHub")).length).toBeGreaterThan(0);
    expect(screen.getByTestId("location-search").textContent).toBe("");
    expect(screen.queryByTestId("inline-composer")).toBeNull();
    expect(
      screen.queryByRole("textbox", { name: "Search installed plugins" }),
    ).toBeNull();
  });

  it("uses the creation surface when My plugins has no authored plugins", async () => {
    installFetch([AUTOMATIONS_PLUGIN]);
    const { wrapper: QueryClientWrapper } = createQueryClientTestHarness();
    render(
      <MemoryRouter initialEntries={["/extensions/plugins?view=my"]}>
        <QueryClientWrapper>
          <PluginsOverview />
        </QueryClientWrapper>
      </MemoryRouter>,
    );

    expect(await screen.findByTestId("inline-composer")).toBeTruthy();
    expect(screen.getByText("Start from an example")).toBeTruthy();
    expect(screen.getByText("Explore plugin capabilities")).toBeTruthy();
    expect(
      screen.queryByText(
        "Plugins authored from local paths, grouped by their marketplace listing category.",
      ),
    ).toBeNull();
  });

  it("opens on Browse and renders it before Installed", async () => {
    installFetch();
    const { wrapper: QueryClientWrapper } = createQueryClientTestHarness();
    render(
      <MemoryRouter initialEntries={["/extensions/plugins"]}>
        <QueryClientWrapper>
          <PluginsOverview />
        </QueryClientWrapper>
      </MemoryRouter>,
    );

    expect((await screen.findAllByText("GitHub")).length).toBeGreaterThan(0);
    expect(screen.queryByRole("tab", { name: "Browse" })).toBeNull();
    expect(screen.queryByRole("tab", { name: /Installed/ })).toBeNull();
    expect(
      screen.getByRole("button", { name: "Create a plugin" }),
    ).toBeTruthy();
    const comboTrigger = screen.getByRole("button", {
      name: "Create a plugin options",
    });
    fireEvent.pointerDown(comboTrigger);
    expect(
      screen.getByRole("menuitem", { name: "Install from source" }),
    ).toBeTruthy();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("button", { name: "New plugin" })).toBeNull();

    const catalogRequests = () =>
      vi.mocked(fetch).mock.calls.filter(([input]) => {
        const rawUrl =
          typeof input === "string"
            ? input
            : input instanceof URL
              ? input.href
              : input.url;
        return (
          new URL(rawUrl, "http://localhost").pathname ===
          "/api/v1/plugin-catalog/search"
        );
      });
    expect(catalogRequests()).toHaveLength(1);

    act(() => focusManager.setFocused(false));
    act(() => focusManager.setFocused(true));
    await waitFor(() => expect(catalogRequests()).toHaveLength(1));
  });

  it("uses the existing sidebar history control to return from creation", async () => {
    installFetch();
    const { wrapper: QueryClientWrapper } = createQueryClientTestHarness();
    render(
      <MemoryRouter initialEntries={["/extensions/plugins"]}>
        <QueryClientWrapper>
          <SidebarHistoryNavigationControls />
          <PluginsOverview />
        </QueryClientWrapper>
      </MemoryRouter>,
    );

    await screen.findAllByText("GitHub");
    const createPlugin = screen.getByRole("button", {
      name: "Create a plugin",
    });

    fireEvent.click(createPlugin);
    expect(await screen.findByTestId("inline-composer")).toBeTruthy();
    expect(screen.queryByText("Back to browse plugins")).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Close the composer" }),
    ).toBeNull();

    fireEvent.click(createPlugin);
    expect(screen.getByTestId("inline-composer")).toBeTruthy();

    const goBack = screen.getByRole("button", { name: "Go back" });
    await waitFor(() =>
      expect((goBack as HTMLButtonElement).disabled).toBe(false),
    );
    fireEvent.click(goBack);
    await waitFor(() =>
      expect(screen.queryByTestId("inline-composer")).toBeNull(),
    );
  });

  it("shows category filters only in Browse", async () => {
    installFetch([
      AUTOMATIONS_PLUGIN,
      {
        ...AUTOMATIONS_PLUGIN,
        id: "simple-notes",
        source: "builtin:docs",
        name: "Docs",
        description: DOCS_CATALOG_ENTRY.description,
        icon: DOCS_CATALOG_ENTRY.icon,
        provenance: "catalog",
        publisherKey: "bb-community",
        publisherLabel: "BB Community",
        catalogEntryId: "docs",
      },
    ]);
    const { wrapper: QueryClientWrapper } = createQueryClientTestHarness();
    render(
      <MemoryRouter initialEntries={["/extensions/plugins"]}>
        <QueryClientWrapper>
          <PluginsOverview />
        </QueryClientWrapper>
      </MemoryRouter>,
    );

    expect((await screen.findAllByText("GitHub")).length).toBeGreaterThan(0);
    const categoryTrigger = screen.getByRole("button", {
      name: "Filter plugins by category: All categories",
    });
    expect(screen.queryByRole("button", { name: "Type" })).toBeNull();
    fireEvent.click(categoryTrigger);
    fireEvent.click(
      screen.getByRole("option", { name: /Memory & Context/u }),
    );
    expect(screen.getByText("Docs")).toBeTruthy();
    expect(screen.queryByText("GitHub")).toBeNull();
  });

  it("sends Installed's New plugin to the new-thread page with the seed", async () => {
    installFetch([AUTOMATIONS_PLUGIN]);
    const { wrapper: QueryClientWrapper } = createQueryClientTestHarness();
    render(
      <MemoryRouter initialEntries={["/extensions/plugins?view=installed"]}>
        <QueryClientWrapper>
          <PluginsOverview />
          <LocationPath />
        </QueryClientWrapper>
      </MemoryRouter>,
    );

    expect(await screen.findByText("Automations")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "New plugin" }));

    expect(screen.getByTestId("location-path").textContent).toBe("/");
  });

  it("uses one Installed Source filter with the shared provenance labels", async () => {
    installFetch([AUTOMATIONS_PLUGIN]);
    const { wrapper: QueryClientWrapper } = createQueryClientTestHarness();
    render(
      <MemoryRouter initialEntries={["/extensions/plugins?view=installed"]}>
        <QueryClientWrapper>
          <PluginsOverview />
          <SwitchViewButton view="browse" />
          <SwitchViewButton view="installed" />
        </QueryClientWrapper>
      </MemoryRouter>,
    );

    expect(await screen.findByText("Automations")).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Source: All sources" }),
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Type" })).toBeNull();
    expect(screen.getByRole("button", { name: "New plugin" })).toBeTruthy();
  });

  it("keeps Browse filters in the toolbar rather than a separate pill band", async () => {
    installFetch();
    const { wrapper: QueryClientWrapper } = createQueryClientTestHarness();
    const { container } = render(
      <MemoryRouter initialEntries={["/extensions/plugins?view=browse"]}>
        <QueryClientWrapper>
          <PluginsOverview />
        </QueryClientWrapper>
      </MemoryRouter>,
    );

    await screen.findAllByText("GitHub");
    expect(
      screen.queryByRole("radiogroup", {
        name: "Filter plugins by category",
      }),
    ).toBeNull();
    expect(
      container.querySelector(
        "[data-resource-collection-viewport] > .shrink-0",
      ),
    ).toBeNull();
    const search = screen.getByRole("textbox", { name: "Search plugins" });
    const toolbar = search.parentElement?.parentElement as HTMLElement;
    const category = screen.getByRole("button", {
      name: "Filter plugins by category: All categories",
    });
    const sort = screen.getByRole("button", { name: "Sort plugins" });
    expect(toolbar.contains(category)).toBe(true);
    expect(toolbar.contains(sort)).toBe(true);
    const heroHeading = screen.getByRole("heading", {
      level: 2,
      name: /^Turn bb into/u,
    });
    expect(
      heroHeading.compareDocumentPosition(toolbar) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("opens installed resources on the canonical Tools detail route", async () => {
    installFetch();
    const { wrapper: QueryClientWrapper } = createQueryClientTestHarness();
    render(
      <MemoryRouter initialEntries={["/extensions/plugins?view=installed"]}>
        <QueryClientWrapper>
          <Routes>
            <Route path="/extensions/plugins" element={<PluginsOverview />} />
            <Route path="*" element={<LocationPath />} />
          </Routes>
        </QueryClientWrapper>
      </MemoryRouter>,
    );

    fireEvent.click(
      await screen.findByRole("button", {
        name: "Automations plugin details",
      }),
    );
    expect(screen.getByTestId("location-path").textContent).toBe(
      "/extensions/plugins/automations",
    );
  });

  it("opens the canonical detail returned by a Browse install", async () => {
    installFetch();
    const { wrapper: QueryClientWrapper } = createQueryClientTestHarness();
    render(
      <MemoryRouter initialEntries={["/extensions/plugins?view=browse"]}>
        <QueryClientWrapper>
          <Routes>
            <Route path="/extensions/plugins" element={<PluginsOverview />} />
            <Route path="*" element={<LocationPath />} />
          </Routes>
        </QueryClientWrapper>
      </MemoryRouter>,
    );

    fireEvent.click(
      (await screen.findAllByRole("button", { name: "Install GitHub" }))[0]!,
    );
    expect(
      await screen.findByRole("heading", { name: "Install GitHub?" }),
    ).toBeTruthy();
    const installButtons = screen.getAllByRole("button", {
      name: "Install GitHub",
    });
    fireEvent.click(installButtons[installButtons.length - 1]!);

    expect((await screen.findByTestId("location-path")).textContent).toBe(
      "/extensions/plugins/github",
    );
  });

  it("loads more installed plugins as the scroll sentinel is reached", async () => {
    const plugins = Array.from({ length: 12 }, (_, index) => {
      const ordinal = String(index + 1).padStart(2, "0");
      return {
        ...AUTOMATIONS_PLUGIN,
        id: `plugin-${ordinal}`,
        source: `builtin:plugin-${ordinal}`,
        name: `Plugin ${ordinal}`,
      };
    });
    const intersectionCallbacks = new Set<IntersectionObserverCallback>();
    vi.stubGlobal(
      "IntersectionObserver",
      class IntersectionObserverMock {
        constructor(private readonly callback: IntersectionObserverCallback) {
          intersectionCallbacks.add(this.callback);
        }
        observe() {}
        unobserve() {}
        disconnect() {
          intersectionCallbacks.delete(this.callback);
        }
      },
    );
    const reachSentinel = () =>
      act(() => {
        for (const callback of intersectionCallbacks) {
          callback(
            [{ isIntersecting: true } as IntersectionObserverEntry],
            {} as IntersectionObserver,
          );
        }
      });
    installFetch(plugins);
    const { wrapper: QueryClientWrapper } = createQueryClientTestHarness();
    render(
      <MemoryRouter initialEntries={["/extensions/plugins?view=installed"]}>
        <QueryClientWrapper>
          <PluginsOverview />
        </QueryClientWrapper>
      </MemoryRouter>,
    );

    expect(await screen.findByText("Plugin 01")).toBeTruthy();
    expect(screen.getByText("Plugin 10")).toBeTruthy();
    expect(screen.queryByText("Plugin 11")).toBeNull();
    expect(
      document.querySelector("[data-resource-infinite-sentinel]"),
    ).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Next" })).toBeNull();

    reachSentinel();
    expect(screen.getByText("Plugin 01")).toBeTruthy();
    expect(screen.getByText("Plugin 12")).toBeTruthy();
    expect(
      document.querySelector("[data-resource-infinite-sentinel]"),
    ).toBeNull();

    fireEvent.change(
      screen.getByRole("textbox", { name: "Search installed plugins" }),
      { target: { value: "Plugin 01" } },
    );
    expect(screen.getByText("Plugin 01")).toBeTruthy();
    expect(screen.queryByText("Plugin 12")).toBeNull();
  });

  it("fits the first chunk to the viewport and keeps the list panel unstretched", async () => {
    const plugins = Array.from({ length: 30 }, (_, index) => {
      const ordinal = String(index + 1).padStart(2, "0");
      return {
        ...AUTOMATIONS_PLUGIN,
        id: `plugin-${ordinal}`,
        source: `builtin:plugin-${ordinal}`,
        name: `Plugin ${ordinal}`,
      };
    });
    const viewportHeight = 760;
    const clientHeightDescriptor = Object.getOwnPropertyDescriptor(
      HTMLElement.prototype,
      "clientHeight",
    );

    Object.defineProperty(HTMLElement.prototype, "clientHeight", {
      configurable: true,
      get() {
        return this.id === "plugins-installed-results" ? viewportHeight : 0;
      },
    });
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
      function getBoundingClientRect(this: HTMLElement) {
        const height = this.hasAttribute("data-resource-list-panel")
          ? viewportHeight
          : this.hasAttribute("data-resource-row")
            ? 50
            : 0;
        return new DOMRect(0, 0, 800, height);
      },
    );
    vi.stubGlobal(
      "ResizeObserver",
      class ResizeObserverMock {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );

    try {
      installFetch(plugins);
      const { wrapper: QueryClientWrapper } = createQueryClientTestHarness();
      render(
        <MemoryRouter initialEntries={["/extensions/plugins?view=installed"]}>
          <QueryClientWrapper>
            <PluginsOverview />
          </QueryClientWrapper>
        </MemoryRouter>,
      );

      await waitFor(() => {
        expect(screen.getByText("Plugin 15")).toBeTruthy();
      });
      expect(screen.queryByText("Plugin 16")).toBeNull();
      expect(
        document.querySelector("[data-resource-infinite-sentinel]"),
      ).not.toBeNull();
      const listPanel = document.querySelector("[data-resource-list-panel]");
      expect(
        document.querySelector("[data-resource-collection-content]"),
      ).toBeNull();
      expect(listPanel?.classList.contains("flex-1")).toBe(false);
    } finally {
      if (clientHeightDescriptor === undefined) {
        Reflect.deleteProperty(HTMLElement.prototype, "clientHeight");
      } else {
        Object.defineProperty(
          HTMLElement.prototype,
          "clientHeight",
          clientHeightDescriptor,
        );
      }
    }
  });

  it("sorts enabled plugins before inactive plugins and published plugins first within enabled", async () => {
    installFetch([
      {
        ...AUTOMATIONS_PLUGIN,
        id: "inactive-official",
        name: "Inactive Official",
        enabled: false,
        status: "disabled",
        provenance: "catalog",
        publisherKey: "bb-community",
        publisherLabel: "BB Community",
        catalogEntryId: "inactive-official",
      },
      {
        ...AUTOMATIONS_PLUGIN,
        id: "enabled-local-alpha",
        name: "Enabled Local",
        provenance: "direct",
        publisherLabel: null,
      },
      {
        ...AUTOMATIONS_PLUGIN,
        id: "enabled-official-zulu",
        name: "Enabled Official Zulu",
      },
      {
        ...AUTOMATIONS_PLUGIN,
        id: "enabled-official-alpha",
        name: "Enabled Official Alpha",
      },
      {
        ...AUTOMATIONS_PLUGIN,
        id: "inactive-local",
        name: "Inactive Local",
        enabled: false,
        status: "disabled",
        provenance: "direct",
        publisherLabel: null,
      },
    ]);
    const { wrapper: QueryClientWrapper } = createQueryClientTestHarness();
    render(
      <MemoryRouter initialEntries={["/extensions/plugins?view=installed"]}>
        <QueryClientWrapper>
          <PluginsOverview />
          <SwitchViewButton view="browse" />
          <SwitchViewButton view="installed" />
        </QueryClientWrapper>
      </MemoryRouter>,
    );

    await screen.findByText("Enabled Official Alpha");
    const rows = [...document.querySelectorAll('[data-testid^="plugin-row-"]')];
    expect(rows.map((row) => row.getAttribute("data-testid"))).toEqual([
      "plugin-row-enabled-official-alpha",
      "plugin-row-enabled-official-zulu",
      "plugin-row-enabled-local-alpha",
      "plugin-row-inactive-local",
      "plugin-row-inactive-official",
    ]);
    for (const row of rows) {
      expect(row.textContent).not.toContain("BB Official");
      expect(row.textContent).not.toContain("BB Community");
      expect(row.textContent).not.toContain("Direct install");
    }

    const sortTrigger = screen.getByRole("button", {
      name: "Sort: Plugin name, ascending",
    });
    expect(sortTrigger.querySelector('[data-icon="ArrowUpDown"]')).toBeTruthy();
    fireEvent.pointerDown(sortTrigger);
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Plugin name" }));
    expect(
      [...document.querySelectorAll('[data-testid^="plugin-row-"]')].map(
        (row) => row.getAttribute("data-testid"),
      ),
    ).toEqual([
      "plugin-row-enabled-official-zulu",
      "plugin-row-enabled-official-alpha",
      "plugin-row-enabled-local-alpha",
      "plugin-row-inactive-official",
      "plugin-row-inactive-local",
    ]);

    fireEvent.keyDown(
      screen.getByRole("menu", {
        name: "Sort: Plugin name, descending",
      }),
      { key: "Escape" },
    );
    fireEvent.click(screen.getByText("switch-to-browse"));
    await screen.findAllByText("GitHub");
    fireEvent.click(screen.getByText("switch-to-installed"));
    expect(
      [...document.querySelectorAll('[data-testid^="plugin-row-"]')].map(
        (row) => row.getAttribute("data-testid"),
      ),
    ).toEqual([
      "plugin-row-enabled-official-zulu",
      "plugin-row-enabled-official-alpha",
      "plugin-row-enabled-local-alpha",
      "plugin-row-inactive-official",
      "plugin-row-inactive-local",
    ]);
  });

  it("filters Installed by one provenance-backed Source selection", async () => {
    installFetch([
      { ...AUTOMATIONS_PLUGIN, id: "builtin-one", name: "Builtin One" },
      {
        ...AUTOMATIONS_PLUGIN,
        id: "catalog-one",
        name: "Catalog One",
        provenance: "catalog",
        publisherKey: "bb-community",
        publisherLabel: "BB Community",
        catalogEntryId: "catalog-one",
      },
      {
        ...AUTOMATIONS_PLUGIN,
        id: "direct-one",
        name: "Direct One",
        provenance: "direct",
        publisherLabel: null,
      },
    ]);
    const { wrapper: QueryClientWrapper } = createQueryClientTestHarness();
    render(
      <MemoryRouter initialEntries={["/extensions/plugins?view=installed"]}>
        <QueryClientWrapper>
          <PluginsOverview />
          <SwitchViewButton view="browse" />
          <SwitchViewButton view="installed" />
        </QueryClientWrapper>
      </MemoryRouter>,
    );

    await screen.findByText("Direct One");
    const rowIds = () =>
      [...document.querySelectorAll('[data-testid^="plugin-row-"]')].map(
        (row) => row.getAttribute("data-testid"),
      );

    let sourceTrigger = screen.getByRole("button", {
      name: "Source: All sources",
    });
    expect(rowIds()).toEqual([
      "plugin-row-builtin-one",
      "plugin-row-catalog-one",
      "plugin-row-direct-one",
    ]);
    fireEvent.pointerDown(sourceTrigger);
    for (const label of [
      "All sources",
      "BB Official",
      "BB Community",
      "Direct install",
    ]) {
      expect(screen.getByRole("menuitem", { name: label })).toBeTruthy();
    }
    expect(
      screen
        .getByRole("menuitem", { name: "All sources" })
        .querySelector('[data-icon="Check"]')
        ?.classList.contains("opacity-100"),
    ).toBe(true);
    fireEvent.click(screen.getByRole("menuitem", { name: "Direct install" }));
    await waitFor(() => {
      expect(rowIds()).toEqual(["plugin-row-direct-one"]);
    });
    sourceTrigger = screen.getByRole("button", {
      name: "Source: Direct install",
    });
    expect(sourceTrigger.textContent).toContain("Direct install");

    fireEvent.pointerDown(sourceTrigger);
    expect(
      screen
        .getByRole("menuitem", { name: "Direct install" })
        .querySelector('[data-icon="Check"]')
        ?.classList.contains("opacity-100"),
    ).toBe(true);
    fireEvent.click(screen.getByRole("menuitem", { name: "All sources" }));
    await waitFor(() => {
      expect(rowIds()).toEqual([
        "plugin-row-builtin-one",
        "plugin-row-catalog-one",
        "plugin-row-direct-one",
      ]);
    });
    expect(screen.queryByText("No plugins match these filters.")).toBeNull();
  });

  it("filters by declared categories while categoryless installs stay only under All", async () => {
    installFetch([
      {
        ...AUTOMATIONS_PLUGIN,
        id: "builtin-one",
        name: "Builtin One",
        categoryId: "tasks-workflows",
        category: "Tasks & Workflows",
      },
      {
        ...AUTOMATIONS_PLUGIN,
        id: "catalog-one",
        name: "Catalog One",
        provenance: "catalog",
        publisherKey: "bb-community",
        publisherLabel: "BB Community",
        catalogEntryId: "catalog-one",
        categoryId: "security",
        category: "Security",
      },
      {
        ...AUTOMATIONS_PLUGIN,
        id: "direct-one",
        name: "Direct One",
        provenance: "direct",
        publisherKey: null,
        publisherLabel: null,
        categoryId: undefined,
        category: undefined,
      },
    ]);
    const { wrapper: QueryClientWrapper } = createQueryClientTestHarness();
    render(
      <MemoryRouter initialEntries={["/extensions/plugins?view=installed"]}>
        <QueryClientWrapper>
          <PluginsOverview />
        </QueryClientWrapper>
      </MemoryRouter>,
    );

    await screen.findByText("Direct One");
    const rowIds = () =>
      [...document.querySelectorAll('[data-testid^="plugin-row-"]')].map(
        (row) => row.getAttribute("data-testid"),
      );
    expect(rowIds()).toEqual([
      "plugin-row-builtin-one",
      "plugin-row-catalog-one",
      "plugin-row-direct-one",
    ]);
    expect(screen.getByRole("radio", { name: "All · 3" })).toBeTruthy();
    expect(
      screen.getByRole("radio", { name: "Tasks & Workflows" }),
    ).toBeTruthy();
    expect(screen.getByRole("radio", { name: "Security" })).toBeTruthy();
    const categoryRow = screen.getByRole("radiogroup", {
      name: "Filter installed plugins by category",
    });
    expect(categoryRow.classList.contains("overflow-hidden")).toBe(true);
    expect(categoryRow.classList.contains("overflow-x-auto")).toBe(false);
    expect(screen.queryByText("Other")).toBeNull();

    fireEvent.click(
      screen.getByRole("radio", { name: "Tasks & Workflows" }),
    );
    await waitFor(() => {
      expect(rowIds()).toEqual(["plugin-row-builtin-one"]);
    });
    expect(screen.queryByText("Direct One")).toBeNull();
    expect(
      screen.getByTestId("plugin-row-builtin-one").textContent,
    ).not.toContain("Tasks & Workflows");

    fireEvent.click(screen.getByRole("radio", { name: "All · 3" }));
    await waitFor(() => {
      expect(rowIds()).toEqual([
        "plugin-row-builtin-one",
        "plugin-row-catalog-one",
        "plugin-row-direct-one",
      ]);
    });
  });

  it("keeps disabled plugins installed regardless of provenance", async () => {
    installFetch([
      AUTOMATIONS_PLUGIN,
      {
        ...AUTOMATIONS_PLUGIN,
        id: "inactive-builtin",
        name: "Inactive Builtin",
        enabled: false,
        status: "disabled",
      },
      {
        ...AUTOMATIONS_PLUGIN,
        id: "inactive-catalog",
        name: "Inactive Catalog Plugin",
        enabled: false,
        status: "disabled",
        provenance: "catalog",
        publisherKey: "bb-community",
        publisherLabel: "BB Community",
        catalogEntryId: "inactive-catalog",
      },
      {
        ...AUTOMATIONS_PLUGIN,
        id: "inactive-local",
        name: "Inactive Local Plugin",
        enabled: false,
        status: "disabled",
        provenance: "direct",
        publisherLabel: null,
      },
    ]);
    const { wrapper: QueryClientWrapper } = createQueryClientTestHarness();
    render(
      <MemoryRouter initialEntries={["/extensions/plugins?view=installed"]}>
        <QueryClientWrapper>
          <PluginsOverview />
          <SwitchViewButton view="browse" />
          <SwitchViewButton view="installed" />
        </QueryClientWrapper>
      </MemoryRouter>,
    );

    expect(await screen.findByText("Automations")).toBeTruthy();
    expect(
      document.querySelectorAll(
        '[data-testid^="plugin-row-"], [data-plugin-row]',
      ).length,
    ).toBeGreaterThanOrEqual(0);
    expect(screen.getByText("Inactive Builtin")).toBeTruthy();
    expect(
      screen.getByRole("switch", { name: "Enable inactive-builtin" }),
    ).toBeTruthy();
    expect(screen.getByText("Inactive Catalog Plugin")).toBeTruthy();
    expect(screen.getByText("Inactive Local Plugin")).toBeTruthy();
  });

  it("does not repeat source provenance as Installed row badges", async () => {
    installFetch([
      AUTOMATIONS_PLUGIN,
      {
        ...AUTOMATIONS_PLUGIN,
        id: "github",
        name: "GitHub",
        source: GITHUB_CATALOG_ENTRY.source,
        provenance: "catalog",
        publisherKey: "bb-community",
        publisherLabel: "BB Community",
        catalogEntryId: GITHUB_CATALOG_ENTRY.entryId,
        sourceDisplay: "BB Official · GitHub",
      },
    ]);
    const { wrapper: QueryClientWrapper } = createQueryClientTestHarness();
    render(
      <MemoryRouter initialEntries={["/extensions/plugins?view=installed"]}>
        <QueryClientWrapper>
          <PluginsOverview />
          <SwitchViewButton view="browse" />
          <SwitchViewButton view="installed" />
        </QueryClientWrapper>
      </MemoryRouter>,
    );

    await screen.findByText("GitHub");
    expect(
      screen.getByTestId("plugin-row-automations").textContent,
    ).not.toContain("BB Official");
    expect(screen.getByTestId("plugin-row-github").textContent).not.toContain(
      "BB Community",
    );
  });
});

// @vitest-environment jsdom

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
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
import { pluginListQueryKey } from "@/hooks/queries/query-keys";
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

function installFetch(
  plugins: readonly unknown[] = [AUTOMATIONS_PLUGIN],
  catalogEntries: readonly unknown[] = [
    AUTOMATIONS_CATALOG_ENTRY,
    DOCS_CATALOG_ENTRY,
    GITHUB_CATALOG_ENTRY,
  ],
  listingRecords: readonly unknown[] = [],
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
          results: catalogEntries,
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
        return responseJson({ records: listingRecords, notices: [] });
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
          <LocationPath />
          <LocationSearch />
        </QueryClientWrapper>
      </MemoryRouter>,
    );

    expect(await screen.findByText("New & notable")).toBeTruthy();
    expect(screen.getByTestId("location-path").textContent).toBe(
      "/extensions/plugins",
    );
    expect(screen.getByTestId("location-search").textContent).toBe("");
    expect(screen.queryByText("No plugins are installed yet.")).toBeNull();
  });

  it("keeps a detail route open while showing Browse behind an empty inventory", async () => {
    installFetch([]);
    const { wrapper: QueryClientWrapper } = createQueryClientTestHarness();
    render(
      <MemoryRouter
        initialEntries={[
          "/extensions/plugins/content-script-example?view=installed",
        ]}
      >
        <QueryClientWrapper>
          <PluginsOverview />
          <LocationPath />
          <LocationSearch />
        </QueryClientWrapper>
      </MemoryRouter>,
    );

    expect(await screen.findByText("New & notable")).toBeTruthy();
    expect(screen.getByTestId("location-path").textContent).toBe(
      "/extensions/plugins/content-script-example",
    );
    expect(screen.getByTestId("location-search").textContent).toBe(
      "?view=installed",
    );
    expect(screen.queryByText("No plugins are installed yet.")).toBeNull();
  });

  it("uses the collection header with one flat Installed card grid", async () => {
    installFetch([
      AUTOMATIONS_PLUGIN,
      {
        ...AUTOMATIONS_PLUGIN,
        id: "simple-notes",
        source: "builtin:docs",
        name: "Docs",
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

    expect(
      await screen.findByRole("heading", {
        level: 1,
        name: "Installed plugins 2 plugins",
      }),
    ).toBeTruthy();
    expect(
      document.querySelector("[data-installed-plugin-count]")?.textContent,
    ).toContain("2 plugins");
    expect(
      document.querySelectorAll("[data-resource-list-panel]"),
    ).toHaveLength(0);
    expect(
      document.querySelector("[data-installed-plugin-shelves]"),
    ).toBeNull();
    expect(
      document.querySelector("[data-installed-plugin-category-header]"),
    ).toBeNull();
    expect(screen.queryByText(/github\.com/u)).toBeNull();
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
    const pluginGuideButton = screen.getByRole("button", {
      name: "Open Plugin Guide in main app",
    });
    expect(pluginGuideButton.querySelector('[data-icon="Puzzle"]')).toBeNull();
    expect(
      pluginGuideButton.querySelector('[data-icon="ExternalLink"]'),
    ).not.toBeNull();
    const [mapIcon, pinIcon] = pluginGuideButton.querySelectorAll(
      "span.relative > svg",
    );
    expect(mapIcon?.getAttribute("class")).not.toContain(
      "group-hover:opacity-0",
    );
    expect(pinIcon?.querySelectorAll("path")).toHaveLength(2);
    expect(screen.getByText("Start from an example")).toBeTruthy();
    expect(screen.getByText("Explore plugin capabilities")).toBeTruthy();
    expect(
      screen.queryByText(
        "Plugins authored from local paths, grouped by their marketplace listing category.",
      ),
    ).toBeNull();
  });

  it("enriches published My plugin cards from the existing catalog search", async () => {
    installFetch(
      [AUTOMATIONS_PLUGIN],
      [
        {
          ...AUTOMATIONS_CATALOG_ENTRY,
          iconTinted: false,
          screenshots: [],
          newAndNotableRank: null,
          repositoryUrl: null,
          author: null,
          installs: 1_250,
          incompatibleReason: null,
        },
      ],
      [
        {
          pluginId: "automations",
          authorship: "path",
          lifecycle: {
            status: "published",
            entryId: "automations",
            publishedAt: 1,
          },
        },
      ],
    );
    const { wrapper: QueryClientWrapper } = createQueryClientTestHarness();
    render(
      <MemoryRouter initialEntries={["/extensions/plugins?view=my"]}>
        <QueryClientWrapper>
          <PluginsOverview />
        </QueryClientWrapper>
      </MemoryRouter>,
    );

    const card = await screen.findByTestId("my-plugin-card-automations");
    expect(
      within(card).getByLabelText("Automations installed — 1,250 installs")
        .textContent,
    ).toBe("1.3K");
    expect(card.querySelector(".row-start-3")?.textContent).toBe(
      "Tasks & Workflows",
    );
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

  it("keeps Browse's category filter in its toolbar", async () => {
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
      screen.getByRole("option", { name: /File Viewers & Editors/u }),
    );
    expect(screen.getByText("Docs")).toBeTruthy();
    expect(screen.queryByText("GitHub")).toBeNull();
  });

  it("uses the shared focused creation flow from Installed", async () => {
    installFetch([AUTOMATIONS_PLUGIN]);
    const { wrapper: QueryClientWrapper } = createQueryClientTestHarness();
    render(
      <MemoryRouter initialEntries={["/extensions/plugins?view=installed"]}>
        <QueryClientWrapper>
          <PluginsOverview />
          <LocationPath />
          <LocationSearch />
        </QueryClientWrapper>
      </MemoryRouter>,
    );

    expect(await screen.findByText("Automations")).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: "Check for updates" }),
    ).toBeNull();
    fireEvent.pointerDown(
      screen.getByRole("button", { name: "Create a plugin options" }),
    );
    expect(
      screen.getByRole("menuitem", { name: "Install from source" }),
    ).toBeTruthy();
    expect(screen.queryByText("Examples")).toBeNull();
    expect(screen.queryByText("Capabilities")).toBeNull();
    fireEvent.keyDown(document, { key: "Escape" });
    fireEvent.click(screen.getByRole("button", { name: "Create a plugin" }));

    expect(screen.getByTestId("location-path").textContent).toBe(
      "/extensions/plugins",
    );
    expect(screen.getByTestId("location-search").textContent).toBe(
      "?view=create",
    );
    expect(await screen.findByTestId("inline-composer")).toBeTruthy();
  });

  it("uses category as Installed's only filter", async () => {
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
      screen.getByRole("button", { name: "Create a plugin" }),
    ).toBeTruthy();
    const categoryTrigger = screen.getByRole("button", {
      name: "Filter plugins by category: All categories",
    });
    fireEvent.click(categoryTrigger);
    expect(screen.getByRole("option", { name: /Uncategorized/u })).toBeTruthy();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("button", { name: "Filters" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Type" })).toBeNull();
  });

  it("uses Browse's sort control and sorting semantics on Installed", async () => {
    const automations = {
      ...AUTOMATIONS_PLUGIN,
      categoryId: "tasks-workflows",
      category: "Tasks & Workflows",
      catalogEntryId: "automations",
    };
    const docs = {
      ...AUTOMATIONS_PLUGIN,
      id: "simple-notes",
      name: "Docs",
      description: DOCS_CATALOG_ENTRY.description,
      icon: DOCS_CATALOG_ENTRY.icon,
      source: "builtin:docs",
      categoryId: "files-and-viewers",
      category: "File Viewers & Editors",
      catalogEntryId: "docs",
    };
    installFetch(
      [automations, docs],
      [
        {
          ...AUTOMATIONS_CATALOG_ENTRY,
          installs: 100,
          publishedAt: "2026-08-01T00:00:00.000Z",
        },
        {
          ...DOCS_CATALOG_ENTRY,
          installs: 10,
          publishedAt: "2026-08-30T00:00:00.000Z",
        },
      ],
    );
    const { wrapper: QueryClientWrapper } = createQueryClientTestHarness();
    render(
      <MemoryRouter initialEntries={["/extensions/plugins"]}>
        <QueryClientWrapper>
          <PluginsOverview />
          <SwitchViewButton view="browse" />
          <SwitchViewButton view="installed" />
        </QueryClientWrapper>
      </MemoryRouter>,
    );

    await screen.findAllByText("Automations");
    fireEvent.pointerDown(screen.getByRole("button", { name: "Sort plugins" }));
    const browseLabels = screen
      .getAllByRole("menuitemradio")
      .map((item) => item.textContent?.trim());
    expect(browseLabels).toEqual(["Recently added", "Most installed", "Name"]);
    fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });

    fireEvent.click(screen.getByText("switch-to-installed"));
    await screen.findByText("Docs");
    fireEvent.pointerDown(screen.getByRole("button", { name: "Sort plugins" }));
    expect(
      screen
        .getAllByRole("menuitemradio")
        .map((item) => item.textContent?.trim()),
    ).toEqual(browseLabels);
    expect(
      screen
        .getByRole("menuitemradio", { name: "Recently added" })
        .querySelector('[data-icon="Clock"]'),
    ).not.toBeNull();
    expect(
      screen
        .getByRole("menuitemradio", { name: "Most installed" })
        .querySelector('[data-icon="Download"]'),
    ).not.toBeNull();
    expect(
      screen
        .getByRole("menuitemradio", { name: "Name" })
        .querySelector('[data-icon="Sort"]'),
    ).not.toBeNull();

    const rowIds = () =>
      [...document.querySelectorAll('[data-testid^="plugin-card-"]')].map(
        (row) => row.getAttribute("data-testid"),
      );
    fireEvent.click(
      screen.getByRole("menuitemradio", { name: "Recently added" }),
    );
    expect(rowIds()).toEqual([
      "plugin-card-simple-notes",
      "plugin-card-automations",
    ]);
    fireEvent.click(
      screen.getByRole("menuitemradio", { name: "Most installed" }),
    );
    expect(rowIds()).toEqual([
      "plugin-card-automations",
      "plugin-card-simple-notes",
    ]);
  });

  it("clears Installed search without moving keyboard focus", async () => {
    installFetch([AUTOMATIONS_PLUGIN]);
    const { wrapper: QueryClientWrapper } = createQueryClientTestHarness();
    render(
      <MemoryRouter initialEntries={["/extensions/plugins?view=installed"]}>
        <QueryClientWrapper>
          <PluginsOverview />
        </QueryClientWrapper>
      </MemoryRouter>,
    );

    await screen.findByText("Automations");
    const search = screen.getByRole("textbox", {
      name: "Search installed plugins",
    }) as HTMLInputElement;
    fireEvent.change(search, { target: { value: "missing" } });
    const clear = screen.getByRole("button", {
      name: "Clear installed plugin search",
    });
    fireEvent.click(clear);
    expect(search.value).toBe("");
    expect(document.activeElement).toBe(search);

    fireEvent.change(search, { target: { value: "missing" } });
    fireEvent.keyDown(search, { key: "Escape" });
    expect(search.value).toBe("");
    expect(document.activeElement).toBe(search);
  });

  it("keeps the installed list usable when an automatic refresh fails", async () => {
    installFetch([AUTOMATIONS_PLUGIN]);
    const { queryClient, wrapper: QueryClientWrapper } =
      createQueryClientTestHarness();
    render(
      <MemoryRouter initialEntries={["/extensions/plugins?view=installed"]}>
        <QueryClientWrapper>
          <PluginsOverview />
        </QueryClientWrapper>
      </MemoryRouter>,
    );

    expect(await screen.findByText("Automations")).toBeTruthy();
    vi.mocked(fetch).mockImplementationOnce(async () =>
      responseJson({ error: "refresh failed" }, 503),
    );
    await act(async () => {
      await queryClient.invalidateQueries({
        queryKey: pluginListQueryKey(true),
      });
    });

    expect(
      await screen.findByText(
        "Showing installed plugins from the last successful refresh.",
      ),
    ).toBeTruthy();
    expect(screen.getByText("Automations")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() =>
      expect(
        screen.queryByText(
          "Showing installed plugins from the last successful refresh.",
        ),
      ).toBeNull(),
    );
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
    fireEvent.click(screen.getByRole("button", { name: "Install" }));

    expect((await screen.findByTestId("location-path")).textContent).toBe(
      "/extensions/plugins/github",
    );
  });

  it("loads more installed plugins as the scroll sentinel is reached", async () => {
    const plugins = Array.from({ length: 13 }, (_, index) => {
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

    fireEvent.pointerDown(
      await screen.findByRole("button", { name: "Sort plugins" }),
    );
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Name" }));
    expect(await screen.findByText("Plugin 01")).toBeTruthy();
    expect(screen.getByText("Plugin 10")).toBeTruthy();
    expect(screen.getByText("Plugin 12")).toBeTruthy();
    expect(screen.queryByText("Plugin 13")).toBeNull();
    expect(
      document.querySelector("[data-resource-infinite-sentinel]"),
    ).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Next" })).toBeNull();

    reachSentinel();
    expect(screen.getByText("Plugin 01")).toBeTruthy();
    expect(screen.getByText("Plugin 13")).toBeTruthy();
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
    const rows = [
      ...document.querySelectorAll('[data-testid^="plugin-card-"]'),
    ];
    expect(rows.map((row) => row.getAttribute("data-testid"))).toEqual([
      "plugin-card-enabled-official-alpha",
      "plugin-card-enabled-official-zulu",
      "plugin-card-enabled-local-alpha",
      "plugin-card-inactive-local",
      "plugin-card-inactive-official",
    ]);
    const sortTrigger = screen.getByRole("button", {
      name: "Sort plugins",
    });
    expect(sortTrigger.querySelector('[data-icon="ArrowUpDown"]')).toBeTruthy();
    fireEvent.pointerDown(sortTrigger);
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Name" }));
    expect(
      screen.getByRole("button", {
        name: "Sort: Name, ascending",
        hidden: true,
      }),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Name" }));
    expect(
      [...document.querySelectorAll('[data-testid^="plugin-card-"]')].map(
        (row) => row.getAttribute("data-testid"),
      ),
    ).toEqual([
      "plugin-card-enabled-official-zulu",
      "plugin-card-enabled-official-alpha",
      "plugin-card-enabled-local-alpha",
      "plugin-card-inactive-official",
      "plugin-card-inactive-local",
    ]);

    fireEvent.keyDown(
      screen.getByRole("menu", {
        name: "Sort: Name, descending",
      }),
      { key: "Escape" },
    );
    fireEvent.click(screen.getByText("switch-to-browse"));
    await screen.findAllByText("GitHub");
    fireEvent.click(screen.getByText("switch-to-installed"));
    expect(
      [...document.querySelectorAll('[data-testid^="plugin-card-"]')].map(
        (row) => row.getAttribute("data-testid"),
      ),
    ).toEqual([
      "plugin-card-enabled-official-zulu",
      "plugin-card-enabled-official-alpha",
      "plugin-card-enabled-local-alpha",
      "plugin-card-inactive-official",
      "plugin-card-inactive-local",
    ]);
  });

  it("filters by category and keeps categoryless installs reachable", async () => {
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
      [...document.querySelectorAll('[data-testid^="plugin-card-"]')].map(
        (row) => row.getAttribute("data-testid"),
      );
    expect(rowIds()).toEqual([
      "plugin-card-catalog-one",
      "plugin-card-builtin-one",
      "plugin-card-direct-one",
    ]);
    fireEvent.click(
      screen.getByRole("button", {
        name: "Filter plugins by category: All categories",
      }),
    );
    for (const label of ["Security", "Tasks & Workflows", "Uncategorized"]) {
      expect(
        screen.getByRole("option", { name: new RegExp(label, "u") }),
      ).toBeTruthy();
    }

    fireEvent.click(screen.getByRole("option", { name: /Tasks & Workflows/u }));
    await waitFor(() => {
      expect(rowIds()).toEqual(["plugin-card-builtin-one"]);
    });
    expect(
      document.querySelector("[data-installed-plugin-count]")?.textContent,
    ).toContain("3 plugins");
    expect(
      document.querySelectorAll("[data-resource-list-panel]"),
    ).toHaveLength(0);
    expect(
      document.querySelector("[data-installed-plugin-shelves]"),
    ).toBeNull();
    expect(
      document.querySelector("[data-installed-plugin-category-header]"),
    ).toBeNull();
    expect(screen.queryByText("Direct One")).toBeNull();
    expect(screen.getByTestId("plugin-card-builtin-one").textContent).toContain(
      "Tasks & Workflows",
    );

    fireEvent.click(screen.getByRole("option", { name: /Tasks & Workflows/u }));
    fireEvent.click(screen.getByRole("option", { name: /Uncategorized/u }));
    await waitFor(() => {
      expect(rowIds()).toEqual(["plugin-card-direct-one"]);
    });

    fireEvent.click(screen.getByRole("option", { name: /Uncategorized/u }));
    await waitFor(() => {
      expect(rowIds()).toEqual([
        "plugin-card-builtin-one",
        "plugin-card-catalog-one",
        "plugin-card-direct-one",
      ]);
    });
  });

  it("composes Installed category filtering with search and resets both", async () => {
    installFetch([
      {
        ...AUTOMATIONS_PLUGIN,
        id: "builtin-enabled",
        name: "Builtin Enabled",
        categoryId: "tasks-workflows",
        category: "Tasks & Workflows",
      },
      {
        ...AUTOMATIONS_PLUGIN,
        id: "catalog-disabled",
        name: "Catalog Disabled",
        enabled: false,
        status: "disabled",
        provenance: "catalog",
        publisherKey: "bb-community",
        publisherLabel: "BB Community",
        catalogEntryId: "catalog-disabled",
        categoryId: "security",
        category: "Security",
      },
      {
        ...AUTOMATIONS_PLUGIN,
        id: "local-security",
        name: "Local Security",
        source: "path:/tmp/local-security",
        sourceDisplay: "/tmp/local-security",
        enabled: false,
        status: "disabled",
        provenance: "direct",
        publisherKey: null,
        publisherLabel: null,
        categoryId: "security",
        category: "Security",
      },
      {
        ...AUTOMATIONS_PLUGIN,
        id: "local-uncategorized",
        name: "Local Uncategorized",
        source: "path:/tmp/local-uncategorized",
        sourceDisplay: "/tmp/local-uncategorized",
        enabled: false,
        status: "disabled",
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

    await screen.findByText("Local Uncategorized");
    const rowIds = () =>
      [...document.querySelectorAll('[data-testid^="plugin-card-"]')].map(
        (row) => row.getAttribute("data-testid"),
      );

    fireEvent.click(
      screen.getByRole("button", {
        name: "Filter plugins by category: All categories",
      }),
    );
    fireEvent.click(screen.getByRole("option", { name: /Security/u }));
    await waitFor(() =>
      expect(rowIds()).toEqual([
        "plugin-card-catalog-disabled",
        "plugin-card-local-security",
      ]),
    );
    fireEvent.keyDown(document, { key: "Escape" });

    fireEvent.change(
      screen.getByRole("textbox", { name: "Search installed plugins" }),
      { target: { value: "Local" } },
    );
    await waitFor(() =>
      expect(rowIds()).toEqual(["plugin-card-local-security"]),
    );
    fireEvent.change(
      screen.getByRole("textbox", { name: "Search installed plugins" }),
      { target: { value: "Builtin" } },
    );
    expect(
      await screen.findByText('No plugins match "Builtin" with these filters.'),
    ).toBeTruthy();
    fireEvent.change(
      screen.getByRole("textbox", { name: "Search installed plugins" }),
      { target: { value: "" } },
    );

    fireEvent.click(
      screen.getByRole("button", {
        name: "Filter plugins by category: Security",
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Clear filter" }));
    await waitFor(() =>
      expect(rowIds()).toEqual([
        "plugin-card-catalog-disabled",
        "plugin-card-local-security",
        "plugin-card-builtin-enabled",
        "plugin-card-local-uncategorized",
      ]),
    );
  });

  it("switches from management priority to an explicit name sort", async () => {
    installFetch([
      {
        ...AUTOMATIONS_PLUGIN,
        id: "z-enabled",
        name: "Z Enabled",
      },
      {
        ...AUTOMATIONS_PLUGIN,
        id: "a-disabled",
        name: "A Disabled",
        enabled: false,
        status: "disabled",
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

    await screen.findByText("A Disabled");
    const rowIds = () =>
      [...document.querySelectorAll('[data-testid^="plugin-card-"]')].map(
        (row) => row.getAttribute("data-testid"),
      );
    expect(rowIds()).toEqual([
      "plugin-card-z-enabled",
      "plugin-card-a-disabled",
    ]);

    fireEvent.pointerDown(screen.getByRole("button", { name: "Sort plugins" }));
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Name" }));
    expect(rowIds()).toEqual([
      "plugin-card-a-disabled",
      "plugin-card-z-enabled",
    ]);

    fireEvent.click(screen.getByRole("menuitemradio", { name: "Name" }));
    expect(rowIds()).toEqual([
      "plugin-card-z-enabled",
      "plugin-card-a-disabled",
    ]);
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
        '[data-testid^="plugin-card-"], [data-plugin-row]',
      ).length,
    ).toBeGreaterThanOrEqual(0);
    expect(screen.getByText("Inactive Builtin")).toBeTruthy();
    expect(
      screen.getByRole("switch", { name: "Enable inactive-builtin" }),
    ).toBeTruthy();
    expect(screen.getByText("Inactive Catalog Plugin")).toBeTruthy();
    expect(screen.getByText("Inactive Local Plugin")).toBeTruthy();
  });

  it("does not repeat source provenance on Installed cards", async () => {
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
      screen.getByTestId("plugin-card-automations").textContent,
    ).not.toContain("BB Official");
    expect(screen.getByTestId("plugin-card-github").textContent).not.toContain(
      "BB Community",
    );
  });
});

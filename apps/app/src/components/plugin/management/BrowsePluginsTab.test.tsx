// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, useLocation } from "react-router-dom";
import type { PluginCatalogSearchEntry } from "@/hooks/queries/plugin-catalog-queries";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";
import { BrowsePluginsTab } from "./BrowsePluginsTab";

// The hero mounts bb's real new-thread composer on demand; it needs live
// project/host/provider queries this suite doesn't provide, and the tab's own
// contract is only that create affordances open it.
vi.mock("@/components/plugin/PluginNewThreadComposer", () => ({
  PluginNewThreadComposer: ({ initialPrompt }: { initialPrompt?: string }) => (
    <div data-testid="inline-composer">{initialPrompt}</div>
  ),
}));

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const MEMORY_ENTRY: PluginCatalogSearchEntry = {
  entryId: "memory",
  marketplace: "bb-community",
  pluginId: "memory",
  displayName: "Memory",
  description: "Provider-independent durable memory for agents.",
  icon: "Brain",
  iconUrl: null,
  iconTinted: false,
  categoryId: "memory-and-context",
  category: "Memory & Context",
  screenshots: [],
  newAndNotableRank: null,
  source: "builtin:memory",
  repositoryUrl: null,
  marketplaceDisplayName: "BB Community",
  publisherKey: "builtin",
  publisherLabel: "BB Official",
  official: true,
  author: null,
  installed: false,
  compatible: true,
  incompatibleReason: null,
};

const CATALOG_STATUS = {
  pluginCount: 13,
  includedPluginCount: 8,
  optionalPluginCount: 5,
};

const INCOMPATIBLE_ENTRY: PluginCatalogSearchEntry = {
  ...MEMORY_ENTRY,
  entryId: "future-memory",
  marketplace: "bb-community",
  pluginId: "future-memory",
  displayName: "Future Memory",
  compatible: false,
  incompatibleReason: "Requires a newer BB version",
};

const GITHUB_ENTRY: PluginCatalogSearchEntry = {
  ...MEMORY_ENTRY,
  entryId: "github",
  marketplace: "bb-community",
  pluginId: "github",
  displayName: "GitHub",
  description: "Browse GitHub issues and pull requests in BB.",
  icon: "Github",
  iconUrl: null,
  iconTinted: false,
  categoryId: "code-and-reviews",
  category: "Code & Reviews",
  source: "builtin:github",
};

function withoutCategory(
  entry: PluginCatalogSearchEntry,
): PluginCatalogSearchEntry {
  const {
    categoryId: _categoryId,
    category: _category,
    ...categoryless
  } = entry;
  return categoryless;
}

const INSTALLED_MEMORY_PLUGIN = {
  id: "memory",
  source: "builtin:memory",
  rootDir: "/plugins/memory",
  version: "0.1.0",
  provenance: "catalog",
  isOrphanedBuiltin: false,
  catalogEntryId: "memory",
  publisherKey: "bb-community",
  publisherLabel: "BB Community",
  sourceDisplay: "BB Official · Memory",
  updateState: {},
  enabled: true,
  description: MEMORY_ENTRY.description,
  name: MEMORY_ENTRY.displayName,
  icon: MEMORY_ENTRY.icon,
  status: "running",
  statusDetail: null,
  handlerStats: { count: 0, totalMs: 0, maxMs: 0, errorCount: 0 },
  services: [],
  schedules: [],
  cliCommand: null,
  hasSettings: false,
  app: { hasApp: false, bundle: null },
  logoUrl: null,
  logoDarkUrl: null,
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("BrowsePluginsTab", () => {
  it("restores publisher grouping with no category UI for an all-v1 catalog", async () => {
    const entries = [
      withoutCategory({ ...MEMORY_ENTRY, displayName: "Zulu Memory" }),
      withoutCategory({
        ...MEMORY_ENTRY,
        entryId: "alpha-memory",
        pluginId: "alpha-memory",
        displayName: "Alpha Memory",
      }),
      withoutCategory({
        ...GITHUB_ENTRY,
        marketplace: "acme-plugins",
        marketplaceDisplayName: "Acme Plugins",
        publisherKey: "acme-plugins",
        publisherLabel: "Acme Plugins",
        official: false,
      }),
    ];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url === "/api/v1/plugin-catalog") {
          return jsonResponse({ catalog: CATALOG_STATUS });
        }
        if (url === "/api/v1/plugin-catalog/search?q=") {
          return jsonResponse({ results: entries });
        }
        if (url === "/api/v1/plugins") {
          return jsonResponse({ enabled: true, plugins: [] });
        }
        return jsonResponse({ error: "not found" }, 404);
      }),
    );

    const { wrapper } = createQueryClientTestHarness();
    render(
      <MemoryRouter initialEntries={["/?category=memory-and-context"]}>
        <BrowsePluginsTab
          onInstall={() => {}}
          onOpenPlugin={() => {}}
          onInstallFromSource={() => {}}
        />
      </MemoryRouter>,
      { wrapper },
    );

    await screen.findByRole("button", { name: "Open Alpha Memory details" });
    const officialHeading = screen.getByText("BB Official");
    const officialGroup = officialHeading.closest("section");
    if (officialGroup === null) throw new Error("Official group missing");
    expect(
      within(officialGroup)
        .getAllByRole("button", { name: /^Open .* details$/u })
        .map((button) => button.getAttribute("aria-label")),
    ).toEqual(["Open Alpha Memory details", "Open Zulu Memory details"]);
    expect(screen.getAllByText("Acme Plugins").length).toBeGreaterThan(0);
    expect(screen.getByText("third-party marketplace")).toBeTruthy();
    expect(screen.queryByText("New & notable")).toBeNull();
    expect(screen.queryByText("Memory & Context")).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Filter plugins by category" }),
    ).toBeNull();
    expect(screen.queryByRole("radiogroup")).toBeNull();
    expect(document.body.textContent).not.toContain("Other");
  });

  it("keeps v1 publishers visible beside v2 shelves and excludes them from a category page", async () => {
    const legacy = withoutCategory({
      ...GITHUB_ENTRY,
      entryId: "legacy-reviewer",
      pluginId: "legacy-reviewer",
      displayName: "Legacy Reviewer",
      marketplace: "acme-plugins",
      marketplaceDisplayName: "Acme Plugins",
      publisherKey: "acme-plugins",
      publisherLabel: "Acme Plugins",
      official: false,
    });
    const entries = [
      { ...MEMORY_ENTRY, newAndNotableRank: 0 },
      GITHUB_ENTRY,
      legacy,
    ];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url === "/api/v1/plugin-catalog") {
          return jsonResponse({ catalog: CATALOG_STATUS });
        }
        if (url === "/api/v1/plugin-catalog/search?q=") {
          return jsonResponse({ results: entries });
        }
        if (url === "/api/v1/plugins") {
          return jsonResponse({ enabled: true, plugins: [] });
        }
        return jsonResponse({ error: "not found" }, 404);
      }),
    );

    const { wrapper } = createQueryClientTestHarness();
    render(
      <MemoryRouter>
        <BrowsePluginsTab
          onInstall={() => {}}
          onOpenPlugin={() => {}}
          onInstallFromSource={() => {}}
        />
      </MemoryRouter>,
      { wrapper },
    );

    await screen.findByRole("button", { name: "Open Legacy Reviewer details" });
    expect(screen.getByText("New & notable")).toBeTruthy();
    expect(screen.getAllByText("Acme Plugins").length).toBeGreaterThan(0);
    const memoryShelf = screen.getByText("Memory & Context").closest("section");
    if (memoryShelf === null) throw new Error("Memory shelf missing");
    fireEvent.click(
      within(memoryShelf).getByRole("button", { name: /View all/u }),
    );
    expect(
      screen.getByRole("button", { name: "Open Memory details" }),
    ).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: "Open Legacy Reviewer details" }),
    ).toBeNull();
    expect(document.body.textContent).not.toContain("Other");
  });

  it("flattens shelves for a sort and clearing the pill restores them", async () => {
    const entries = [
      { ...MEMORY_ENTRY, displayName: "Zulu" },
      { ...GITHUB_ENTRY, displayName: "Alpha" },
      { ...INCOMPATIBLE_ENTRY, displayName: "Middle" },
    ];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url === "/api/v1/plugin-catalog") {
          return jsonResponse({ catalog: CATALOG_STATUS });
        }
        if (url === "/api/v1/plugin-catalog/search?q=") {
          return jsonResponse({ results: entries });
        }
        if (url === "/api/v1/plugins") {
          return jsonResponse({ enabled: true, plugins: [] });
        }
        return jsonResponse({ error: "not found" }, 404);
      }),
    );

    const { wrapper } = createQueryClientTestHarness();
    render(
      <MemoryRouter>
        <BrowsePluginsTab
          onInstall={() => {}}
          onOpenPlugin={() => {}}
          onInstallFromSource={() => {}}
        />
      </MemoryRouter>,
      {
        wrapper,
      },
    );

    expect((await screen.findAllByText("Alpha")).length).toBeGreaterThan(0);
    const cardOrder = () =>
      [
        ...document.querySelectorAll<HTMLButtonElement>(
          'button[aria-label^="Open "][aria-label$=" details"]',
        ),
      ].map((button) => button.getAttribute("aria-label"));
    const sortTrigger = screen.getByRole("button", { name: "Sort plugins" });
    expect(sortTrigger.querySelector('[data-icon="ArrowUpDown"]')).toBeTruthy();
    fireEvent.pointerDown(sortTrigger);
    fireEvent.click(screen.getByRole("menuitem", { name: "Name" }));

    // The flat result contains each compatible plugin exactly once, in name
    // order. The incompatible result remains hidden as before.
    expect(cardOrder()).toEqual(["Open Alpha details", "Open Zulu details"]);
    expect(
      screen.getByRole("radiogroup", {
        name: "Filter plugins by category",
      }),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Clear Name sort" }));
    expect(screen.getByText("New & notable")).toBeTruthy();
    expect(screen.getByText("Memory & Context")).toBeTruthy();
    expect(screen.queryByRole("radiogroup")).toBeNull();
  });

  it("keeps third-party origin, author, and repository facts on shelf cards", async () => {
    const entries = [
      { ...MEMORY_ENTRY, displayName: "Memory" },
      {
        ...MEMORY_ENTRY,
        entryId: "notes",
        pluginId: "notes",
        displayName: "Acme Notes",
        categoryId: "code-and-reviews" as const,
        category: "Code & Reviews",
        marketplace: "acme-plugins",
        marketplaceDisplayName: "Acme Plugins",
        publisherKey: "acme-plugins",
        publisherLabel: "Acme Plugins",
        official: false,
        author: { name: "Acme", url: "https://github.com/acme" },
        repositoryUrl: "https://github.com/acme/notes",
      },
    ];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url === "/api/v1/plugin-catalog") {
          return jsonResponse({ catalog: CATALOG_STATUS });
        }
        if (url === "/api/v1/plugin-catalog/search?q=") {
          return jsonResponse({ results: entries });
        }
        if (url === "/api/v1/plugins") {
          return jsonResponse({ enabled: true, plugins: [] });
        }
        return jsonResponse({ error: "not found" }, 404);
      }),
    );

    const { wrapper } = createQueryClientTestHarness();
    render(
      <MemoryRouter>
        <BrowsePluginsTab
          onInstall={() => {}}
          onOpenPlugin={() => {}}
          onInstallFromSource={() => {}}
        />
      </MemoryRouter>,
      { wrapper },
    );

    await screen.findAllByText("Acme Notes");
    expect(screen.getAllByText(/Acme Plugins/u).length).toBeGreaterThan(0);
    const authorLink = screen.getAllByRole("link", { name: "By: Acme" })[0];
    expect(authorLink?.getAttribute("href")).toBe(
      "/extensions/plugins/authors/12%3Aacme-plugins%3Agithub%3Aacme",
    );
    // The card links the repository; a bundled entry has none to link.
    const repositoryLink = screen.getAllByRole("link", {
      name: "Open Acme Notes repository",
    })[0]!;
    expect(repositoryLink.getAttribute("href")).toBe(
      "https://github.com/acme/notes",
    );
    expect(
      screen.queryByRole("link", { name: "Open Memory repository" }),
    ).toBeNull();
  });

  it("orders shelves by count, shows real counts, and View all owns a URL", async () => {
    const entries = Array.from(
      { length: CATALOG_STATUS.pluginCount },
      (_, index) => ({
        ...MEMORY_ENTRY,
        entryId: `official-${index + 1}`,
        pluginId: `official-${index + 1}`,
        displayName: `Official ${index + 1}`,
        categoryId:
          index < 8
            ? ("memory-and-context" as const)
            : ("code-and-reviews" as const),
        category: index < 8 ? "Memory & Context" : "Code & Reviews",
      }),
    );
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url === "/api/v1/plugin-catalog") {
          return jsonResponse({ catalog: CATALOG_STATUS });
        }
        if (url === "/api/v1/plugin-catalog/search?q=") {
          return jsonResponse({ results: entries });
        }
        if (url === "/api/v1/plugins") {
          return jsonResponse({ enabled: true, plugins: [] });
        }
        return jsonResponse({ error: "not found" }, 404);
      }),
    );

    const { wrapper } = createQueryClientTestHarness();
    function LocationProbe() {
      return <span data-testid="location">{useLocation().search}</span>;
    }
    render(
      <MemoryRouter>
        <LocationProbe />
        <BrowsePluginsTab
          onInstall={() => {}}
          onOpenPlugin={() => {}}
          onInstallFromSource={() => {}}
        />
      </MemoryRouter>,
      { wrapper },
    );

    await screen.findAllByText("Official 1");
    const memoryHeading = screen.getByText("Memory & Context");
    const codeHeading = screen.getByText("Code & Reviews");
    expect(
      memoryHeading.compareDocumentPosition(codeHeading) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(screen.getByText("· 8")).toBeTruthy();
    expect(screen.getByText("· 5")).toBeTruthy();

    const memoryShelf = memoryHeading.closest("section");
    if (memoryShelf === null) throw new Error("Memory shelf missing");
    fireEvent.click(
      within(memoryShelf).getByRole("button", { name: /View all/ }),
    );
    expect(screen.getByTestId("location").textContent).toBe(
      "?category=memory-and-context",
    );
    expect(screen.getByText("· 8 plugins")).toBeTruthy();
    expect(
      screen.getAllByRole("button", { name: /^Open Official .* details$/u }),
    ).toHaveLength(8);
  });

  it("sorts and filters the flat grid while hiding absent card statistics", async () => {
    const entries = [
      {
        ...MEMORY_ENTRY,
        entryId: "unknown",
        pluginId: "unknown",
        displayName: "Unknown metrics",
      },
      {
        ...MEMORY_ENTRY,
        entryId: "popular",
        pluginId: "popular",
        displayName: "Popular",
        installCount: 1_204,
        publishedAt: "2026-08-20T09:30:00Z",
        updatedAt: "2026-08-24T09:30:00Z",
      },
      {
        ...GITHUB_ENTRY,
        entryId: "reviewer",
        pluginId: "reviewer",
        displayName: "Reviewer",
        installCount: 40,
        publishedAt: "2026-08-24T09:30:00Z",
      },
    ];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url === "/api/v1/plugin-catalog") {
          return jsonResponse({ catalog: CATALOG_STATUS });
        }
        if (url === "/api/v1/plugin-catalog/search?q=") {
          return jsonResponse({ results: entries });
        }
        if (url === "/api/v1/plugins") {
          return jsonResponse({ enabled: true, plugins: [] });
        }
        return jsonResponse({ error: "not found" }, 404);
      }),
    );

    const { wrapper } = createQueryClientTestHarness();
    const { container } = render(
      <MemoryRouter initialEntries={["/?sort=most-installed"]}>
        <BrowsePluginsTab
          onInstall={() => {}}
          onOpenPlugin={() => {}}
          onInstallFromSource={() => {}}
        />
      </MemoryRouter>,
      { wrapper },
    );

    await screen.findByText("Popular");
    const cardOrder = () =>
      [
        ...container.querySelectorAll<HTMLButtonElement>(
          'button[aria-label^="Open "][aria-label$=" details"]',
        ),
      ].map((button) => button.getAttribute("aria-label"));
    expect(cardOrder()).toEqual([
      "Open Popular details",
      "Open Reviewer details",
      "Open Unknown metrics details",
    ]);
    expect(screen.getByLabelText("1,204 installs")).toBeTruthy();
    expect(container.querySelector('[aria-label^="Updated "]')).not.toBeNull();
    const unknownCard = screen
      .getByRole("button", { name: "Open Unknown metrics details" })
      .closest("div");
    expect(unknownCard?.querySelector('[aria-label$=" installs"]')).toBeNull();
    expect(unknownCard?.querySelector('[aria-label^="Updated "]')).toBeNull();

    fireEvent.click(screen.getByRole("radio", { name: "Code & Reviews" }));
    expect(cardOrder()).toEqual(["Open Reviewer details"]);
    fireEvent.click(screen.getByRole("radio", { name: "All" }));
    expect(cardOrder()).toHaveLength(3);
  });

  it("only offers Most installed when the catalog supplies a count", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url === "/api/v1/plugin-catalog") {
          return jsonResponse({ catalog: CATALOG_STATUS });
        }
        if (url === "/api/v1/plugin-catalog/search?q=") {
          return jsonResponse({ results: [MEMORY_ENTRY] });
        }
        if (url === "/api/v1/plugins") {
          return jsonResponse({ enabled: true, plugins: [] });
        }
        return jsonResponse({ error: "not found" }, 404);
      }),
    );
    const { wrapper } = createQueryClientTestHarness();
    render(
      <MemoryRouter>
        <BrowsePluginsTab
          onInstall={() => {}}
          onOpenPlugin={() => {}}
          onInstallFromSource={() => {}}
        />
      </MemoryRouter>,
      { wrapper },
    );

    await screen.findAllByText("Memory");
    fireEvent.pointerDown(screen.getByRole("button", { name: "Sort plugins" }));
    expect(
      screen.getByRole("menuitem", { name: "Recently added" }),
    ).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: "Name" })).toBeTruthy();
    expect(
      screen.queryByRole("menuitem", { name: "Most installed" }),
    ).toBeNull();
  });

  it("keeps Most installed available when filtered results omit counts", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url === "/api/v1/plugin-catalog") {
          return jsonResponse({ catalog: CATALOG_STATUS });
        }
        if (url === "/api/v1/plugin-catalog/search?q=") {
          return jsonResponse({
            results: [{ ...MEMORY_ENTRY, installCount: 12 }],
          });
        }
        if (url === "/api/v1/plugin-catalog/search?q=unknown") {
          return jsonResponse({
            results: [
              withoutCategory({
                ...GITHUB_ENTRY,
                entryId: "unknown-count",
                pluginId: "unknown-count",
                displayName: "Unknown search result",
              }),
            ],
          });
        }
        if (url === "/api/v1/plugins") {
          return jsonResponse({ enabled: true, plugins: [] });
        }
        return jsonResponse({ error: "not found" }, 404);
      }),
    );
    const { wrapper } = createQueryClientTestHarness();
    render(
      <MemoryRouter>
        <BrowsePluginsTab
          onInstall={() => {}}
          onOpenPlugin={() => {}}
          onInstallFromSource={() => {}}
        />
      </MemoryRouter>,
      { wrapper },
    );

    await screen.findAllByText("Memory");
    fireEvent.change(screen.getByRole("textbox", { name: "Search plugins" }), {
      target: { value: "unknown" },
    });
    await screen.findAllByText("Unknown search result");
    expect(
      screen.getByRole("button", { name: "Filter plugins by category" }),
    ).toBeTruthy();
    fireEvent.pointerDown(screen.getByRole("button", { name: "Sort plugins" }));
    expect(
      screen.getByRole("menuitem", { name: "Most installed" }),
    ).toBeTruthy();
  });

  it("shows the official plugins and entries", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url === "/api/v1/plugin-catalog") {
          return jsonResponse({ catalog: CATALOG_STATUS });
        }
        if (url === "/api/v1/plugin-catalog/search?q=") {
          return jsonResponse({
            results: [MEMORY_ENTRY, INCOMPATIBLE_ENTRY, GITHUB_ENTRY],
          });
        }
        if (url === "/api/v1/plugins") {
          return jsonResponse({ enabled: true, plugins: [] });
        }
        return jsonResponse({ error: "not found" }, 404);
      }),
    );

    const onInstall = vi.fn();
    const onOpenPlugin = vi.fn();
    const { wrapper } = createQueryClientTestHarness();
    render(
      <MemoryRouter>
        <BrowsePluginsTab
          onInstall={onInstall}
          onOpenPlugin={onOpenPlugin}
          onInstallFromSource={() => {}}
        />
      </MemoryRouter>,
      { wrapper },
    );

    expect((await screen.findAllByText("Memory")).length).toBeGreaterThan(0);
    const memoryCard = (await screen.findAllByText("Memory"))[0]!.closest(
      "div",
    );
    expect(memoryCard).not.toBeNull();
    // Scoped to the card on purpose: INCOMPATIBLE_ENTRY spreads MEMORY_ENTRY
    // and inherits its Brain icon, so a document-wide lookup passes even when
    // the Memory card renders no leading icon at all.
    expect(
      (memoryCard as HTMLElement).querySelector('[data-icon="Brain"]'),
    ).not.toBeNull();
    expect(
      screen.getByRole("textbox", { name: "Search plugins" }),
    ).toBeTruthy();
    expect(
      screen.getAllByText(MEMORY_ENTRY.description).length,
    ).toBeGreaterThan(0);
    expect(
      screen.getAllByText(GITHUB_ENTRY.description).length,
    ).toBeGreaterThan(0);
    expect(
      screen.getByRole("button", { name: "Filter plugins by category" }),
    ).toBeTruthy();
    expect(
      screen.queryByRole("heading", { name: /BB Official plugins/i }),
    ).toBeNull();
    expect(screen.getByRole("heading", { name: /Turn bb into/u })).toBeTruthy();
    expect(
      screen.getAllByRole("button", { name: "Install Memory" }).length,
    ).toBeGreaterThan(0);
    expect(screen.queryByText("BB Official plugins")).toBeNull();

    expect(screen.queryByText(MEMORY_ENTRY.source)).toBeNull();
    // Incompatible entries never render on Browse: an entry this BB cannot
    // install is noise. The CLI search still reports them with reasons.
    expect(screen.queryByText("Future Memory")).toBeNull();
    expect(screen.queryByText("Requires a newer BB version")).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Install Future Memory" }),
    ).toBeNull();

    // The remote-catalog Refresh action is gone: plugins ship with the app.
    expect(screen.queryByRole("button", { name: "Refresh" })).toBeNull();

    const install = screen.getAllByRole("button", {
      name: "Install Memory",
    })[0]!;
    expect(install.querySelector('[data-icon="Download"]')).not.toBeNull();
    fireEvent.pointerMove(install);
    expect((await screen.findByRole("tooltip")).textContent).toBe(
      "Install Memory",
    );
    fireEvent.click(install);
    expect(onInstall).toHaveBeenCalledWith({
      entryId: "memory",
      marketplace: "bb-community",
      publisherLabel: "BB Official",
      displayName: "Memory",
      icon: "Brain",
      iconUrl: null,
      iconTinted: false,
      source: "builtin:memory",
    });
    fireEvent.click(
      screen.getAllByRole("button", { name: "Open Memory details" })[0]!,
    );
    expect(onOpenPlugin).toHaveBeenCalledWith("memory");
  });

  it("uses the shared error state and retries catalog searches", async () => {
    let searchAttempts = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url === "/api/v1/plugin-catalog") {
          return jsonResponse({ catalog: CATALOG_STATUS });
        }
        if (url === "/api/v1/plugin-catalog/search?q=") {
          searchAttempts += 1;
          return searchAttempts === 1
            ? jsonResponse({ error: "unavailable" }, 503)
            : jsonResponse({ results: [MEMORY_ENTRY] });
        }
        if (url === "/api/v1/plugins") {
          return jsonResponse({ enabled: true, plugins: [] });
        }
        return jsonResponse({ error: "not found" }, 404);
      }),
    );

    const { wrapper } = createQueryClientTestHarness();
    render(
      <MemoryRouter>
        <BrowsePluginsTab
          onInstall={() => {}}
          onOpenPlugin={() => {}}
          onInstallFromSource={() => {}}
        />
      </MemoryRouter>,
      {
        wrapper,
      },
    );

    expect((await screen.findByRole("alert")).textContent).toContain(
      "BB's official plugins are unavailable.",
    );
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));

    expect((await screen.findAllByText("Memory")).length).toBeGreaterThan(0);
    expect(searchAttempts).toBe(2);
  });

  it("marks installed entries instead of offering install", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url === "/api/v1/plugin-catalog") {
          return jsonResponse({ catalog: CATALOG_STATUS });
        }
        if (url === "/api/v1/plugin-catalog/search?q=") {
          return jsonResponse({
            results: [{ ...MEMORY_ENTRY, installed: true }],
          });
        }
        if (url === "/api/v1/plugins") {
          return jsonResponse({
            enabled: true,
            plugins: [INSTALLED_MEMORY_PLUGIN],
          });
        }
        return jsonResponse({ error: "not found" }, 404);
      }),
    );

    const { wrapper } = createQueryClientTestHarness();
    const onOpenPlugin = vi.fn();
    render(
      <MemoryRouter>
        <BrowsePluginsTab
          onInstall={() => {}}
          onOpenPlugin={onOpenPlugin}
          onInstallFromSource={() => {}}
        />
      </MemoryRouter>,
      { wrapper },
    );

    const installed = (
      await screen.findAllByRole("button", { name: "Uninstall Memory" })
    )[0]!;
    fireEvent.pointerMove(installed);
    expect((await screen.findByRole("tooltip")).textContent).toBe(
      "Installed — uninstall Memory",
    );
    // A check, not a download arrow: the corner glyph must read as state
    // ("installed"), never as an available install action.
    expect(installed.querySelector('[data-icon="Check"]')).not.toBeNull();
    expect(installed.querySelector('[data-icon="Download"]')).toBeNull();
    // The installed state reads as a plain success-tinted glyph: no outline,
    // no fill, at rest or on hover/focus.
    // Tokenize: `toContain` also matches inside the hover:/focus-visible:
    // twins, which would leave the resting state unverified.
    const installedClasses = new Set(installed.className.split(/\s+/));
    for (const restingClass of ["border-transparent", "bg-transparent"]) {
      expect(installedClasses.has(restingClass)).toBe(true);
    }
    for (const variantClass of [
      "hover:border-transparent",
      "hover:bg-transparent",
      "focus-visible:border-transparent",
      "focus-visible:bg-transparent",
    ]) {
      expect(installedClasses.has(variantClass)).toBe(true);
    }
    // Tokenized for the same reason as the border/bg checks above: the resting
    // tint IS the feature here, and `toContain` would be satisfied by the
    // hover:/focus-visible: twins alone, leaving it unverified.
    const successTint =
      "text-[color:color-mix(in_oklab,var(--success)_72%,var(--ink))]";
    expect(installedClasses.has(successTint)).toBe(true);
    expect(installedClasses.has(`hover:${successTint}`)).toBe(true);
    expect(installedClasses.has(`focus-visible:${successTint}`)).toBe(true);
    expect(installedClasses.has("text-success-foreground")).toBe(false);
    expect(installedClasses.has("hover:text-foreground")).toBe(false);
    expect(screen.queryByRole("button", { name: "Install" })).toBeNull();
    fireEvent.click(installed);
    expect(
      screen.getByRole("heading", { name: "Uninstall Memory?" }),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    fireEvent.click(
      screen.getAllByRole("button", { name: "Open Memory details" })[0]!,
    );
    expect(onOpenPlugin).toHaveBeenCalledWith("memory");
  });

  it("uses the catalog's canonical plugin id for uninstall", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url === "/api/v1/plugin-catalog") {
          return jsonResponse({ catalog: CATALOG_STATUS });
        }
        if (url === "/api/v1/plugin-catalog/search?q=") {
          return jsonResponse({
            results: [
              {
                ...MEMORY_ENTRY,
                entryId: "docs",
                marketplace: "bb-community",
                pluginId: "simple-notes",
                displayName: "Docs",
                source: "builtin:docs",
                installed: true,
              },
            ],
          });
        }
        if (url === "/api/v1/plugins") {
          return jsonResponse({
            enabled: true,
            plugins: [
              {
                ...INSTALLED_MEMORY_PLUGIN,
                id: "simple-notes",
                source: "npm:bb-plugin-simple-notes@^0.1.0",
                catalogEntryId: "simple-notes",
              },
            ],
          });
        }
        return jsonResponse({ error: "not found" }, 404);
      }),
    );

    const { wrapper } = createQueryClientTestHarness();
    const onOpenPlugin = vi.fn();
    render(
      <MemoryRouter>
        <BrowsePluginsTab
          onInstall={() => {}}
          onOpenPlugin={onOpenPlugin}
          onInstallFromSource={() => {}}
        />
      </MemoryRouter>,
      { wrapper },
    );

    expect(
      (await screen.findAllByRole("button", { name: "Uninstall Docs" })).length,
    ).toBeGreaterThan(0);

    fireEvent.click(
      screen.getAllByRole("button", { name: "Open Docs details" })[0]!,
    );
    expect(onOpenPlugin).toHaveBeenCalledWith("simple-notes");
  });

  it("swaps the browse body for examples while composing", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url === "/api/v1/plugin-catalog") {
          return jsonResponse({ catalog: CATALOG_STATUS });
        }
        if (url.startsWith("/api/v1/plugin-catalog/search")) {
          return jsonResponse({ results: [MEMORY_ENTRY, GITHUB_ENTRY] });
        }
        if (url === "/api/v1/plugins") {
          return jsonResponse({ enabled: true, plugins: [] });
        }
        return jsonResponse({ error: "not found" }, 404);
      }),
    );

    const { wrapper } = createQueryClientTestHarness();
    render(
      <MemoryRouter>
        <BrowsePluginsTab
          onInstallFromSource={() => {}}
          onInstall={() => {}}
          onOpenPlugin={() => {}}
        />
      </MemoryRouter>,
      { wrapper },
    );

    // Default state: search + catalog, no example cards anywhere.
    expect(
      (await screen.findAllByRole("button", { name: "Open Memory details" }))
        .length,
    ).toBeGreaterThan(0);
    expect(
      screen.getByRole("textbox", { name: "Search plugins" }),
    ).toBeTruthy();
    expect(screen.queryByText("Start from an example")).toBeNull();

    // Composing: examples replace the search + catalog wholesale.
    fireEvent.click(screen.getByRole("button", { name: "Create a plugin" }));
    expect(await screen.findByText("Start from an example")).toBeTruthy();
    expect(screen.getByText("Explore plugin capabilities")).toBeTruthy();
    expect(
      screen.queryByRole("textbox", { name: "Search plugins" }),
    ).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Open Memory details" }),
    ).toBeNull();

    // Create is enter-only: repeated activation keeps the creation body open.
    fireEvent.click(screen.getByRole("button", { name: "Create a plugin" }));
    expect(await screen.findByText("Start from an example")).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: "Open Memory details" }),
    ).toBeNull();
  });

  it("routes every create affordance into the inline composer", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url === "/api/v1/plugin-catalog") {
          return jsonResponse({ catalog: CATALOG_STATUS });
        }
        if (url.startsWith("/api/v1/plugin-catalog/search")) {
          return jsonResponse({ results: [MEMORY_ENTRY] });
        }
        if (url === "/api/v1/plugins") {
          return jsonResponse({ enabled: true, plugins: [] });
        }
        return jsonResponse({ error: "not found" }, 404);
      }),
    );

    const { wrapper } = createQueryClientTestHarness();
    render(
      <MemoryRouter>
        <BrowsePluginsTab
          onInstallFromSource={() => {}}
          onInstall={() => {}}
          onOpenPlugin={() => {}}
        />
      </MemoryRouter>,
      { wrapper },
    );

    // The CTA opens the composer blank, which also reveals the example cards.
    fireEvent.click(
      await screen.findByRole("button", { name: "Create a plugin" }),
    );
    const blank = await screen.findByTestId("inline-composer");
    expect(blank.textContent).toBe("Create a new bb plugin that ");

    // A use-case card re-seeds the open composer with its brief.
    // (The hook is the unique handle; the title also appears on a hero chip.)
    fireEvent.click(
      screen.getByText(
        "Ship a board your agents move cards across while they work.",
      ),
    );
    const seeded = await screen.findByTestId("inline-composer");
    expect(seeded.textContent).toContain("kanban board panel");

    // A capability-tier card seeds its own brief the same way.
    fireEvent.click(screen.getByText("CLI command"));
    expect(
      (await screen.findByTestId("inline-composer")).textContent,
    ).toContain("deploys the current branch to staging");
  });
});

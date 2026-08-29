// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PluginCatalogSearchEntry } from "@/hooks/queries/plugin-catalog-queries";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";
import { ToolsView } from "./ToolsView";

// The package's Node export creates an imperative Panel handle without its
// browser-only group registration. The resize hook has its own transition
// contract test; this route suite exercises panel identity and rendered state.
vi.mock("@/components/secondary-panel/useSecondaryPanelResize", async () => {
  const { createRef } = await import("react");
  return {
    useSecondaryPanelResize: () => ({
      handleSecondaryPanelDragging: () => {},
      handleSecondaryPanelResize: () => {},
      persistedWidthPercent: 38,
      secondaryPanelRef: createRef<HTMLElement>(),
      secondaryResizablePanelRef: createRef(),
    }),
  };
});

function catalogEntry(
  pluginId: string,
  displayName: string,
): PluginCatalogSearchEntry {
  return {
    entryId: pluginId,
    pluginId,
    displayName,
    description: `${displayName} description`,
    icon: "Zap",
    iconUrl: null,
    iconTinted: false,
    categoryId: "thread-content",
    category: "Thread Content",
    screenshots: [],
    newAndNotableRank: null,
    source: `npm:${pluginId}`,
    repositoryUrl: `https://github.com/patlee/${pluginId}`,
    marketplace: "bb-community",
    marketplaceDisplayName: "BB Community",
    publisherKey: "bb-community",
    publisherLabel: "BB Community",
    official: true,
    author: { name: "Pat Lee", url: "https://github.com/patlee" },
    installed: false,
    installs: null,
    compatible: true,
    incompatibleReason: null,
  };
}

function LocationProbe() {
  const location = useLocation();
  return (
    <output data-testid="location">
      {location.pathname}
      {location.search}
    </output>
  );
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("plugin discovery detail panel", () => {
  it("keeps Browse mounted while several URL-addressed details stay open", async () => {
    const entries = [
      catalogEntry("github", "GitHub"),
      catalogEntry("memory", "Memory"),
    ];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url === "/api/v1/plugins") {
          return new Response(JSON.stringify({ enabled: true, plugins: [] }), {
            headers: { "content-type": "application/json" },
          });
        }
        if (url === "/api/v1/plugin-catalog") {
          return new Response(
            JSON.stringify({
              catalog: {
                pluginCount: entries.length,
                includedPluginCount: entries.length,
                optionalPluginCount: 0,
              },
            }),
            { headers: { "content-type": "application/json" } },
          );
        }
        if (url.startsWith("/api/v1/plugin-catalog/search?q=")) {
          const query =
            new URL(url, "https://bb.test").searchParams.get("q") ?? "";
          return new Response(
            JSON.stringify({
              results:
                query.length === 0
                  ? entries
                  : entries.filter((entry) =>
                      entry.pluginId.includes(query.toLowerCase()),
                    ),
            }),
            { headers: { "content-type": "application/json" } },
          );
        }
        return new Response(JSON.stringify({ error: "not found" }), {
          status: 404,
          headers: { "content-type": "application/json" },
        });
      }),
    );
    const { wrapper } = createQueryClientTestHarness();
    render(
      <MemoryRouter initialEntries={["/extensions/plugins?sort=name"]}>
        <Routes>
          <Route path="/extensions/plugins/*" element={<ToolsView />} />
        </Routes>
        <LocationProbe />
      </MemoryRouter>,
      { wrapper },
    );

    const browseViewport = await waitFor(() => {
      const element = document.getElementById("plugins-browse-results");
      expect(element).not.toBeNull();
      return element as HTMLElement;
    });
    // The detail is the page's docked right panel, so nothing is mounted for
    // it until a plugin is opened — there is no offscreen overlay parked here.
    expect(
      document.querySelector("[data-persistent-drawer-content]"),
    ).toBeNull();
    browseViewport.scrollTop = 240;
    const githubOpen = await screen.findByRole("button", {
      name: "Open GitHub details",
    });
    githubOpen.focus();
    fireEvent.click(githubOpen);

    expect(await screen.findByRole("heading", { name: "GitHub" })).toBeTruthy();
    const closeFlyout = screen.getByRole("button", {
      name: /Close plugin details/u,
    });
    expect(closeFlyout.querySelector('[data-icon="X"]')).toBeTruthy();
    expect(screen.getByTestId("location").textContent).toBe(
      "/extensions/plugins/github?sort=name",
    );
    expect(document.getElementById("plugins-browse-results")).toBe(
      browseViewport,
    );
    expect(browseViewport.scrollTop).toBe(240);

    fireEvent.click(closeFlyout);
    await waitFor(() => {
      expect(screen.getByTestId("location").textContent).toBe(
        "/extensions/plugins?sort=name",
      );
      expect(document.activeElement).toBe(githubOpen);
    });
    fireEvent.click(githubOpen);
    expect(await screen.findByRole("heading", { name: "GitHub" })).toBeTruthy();

    fireEvent.click(
      within(browseViewport).getByRole("button", {
        name: "Open Memory details",
      }),
    );
    expect(await screen.findByRole("heading", { name: "Memory" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "GitHub" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Memory" })).toBeTruthy();
    expect(screen.getByTestId("location").textContent).toBe(
      "/extensions/plugins/memory?sort=name",
    );

    fireEvent.click(screen.getByRole("button", { name: "GitHub" }));
    await waitFor(() => {
      expect(screen.getByTestId("location").textContent).toBe(
        "/extensions/plugins/github?sort=name",
      );
    });
    fireEvent.click(screen.getByRole("button", { name: "Close GitHub" }));
    await waitFor(() => {
      expect(screen.getByTestId("location").textContent).toBe(
        "/extensions/plugins/memory?sort=name",
      );
    });
    expect(screen.queryByRole("button", { name: "GitHub" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Close Memory" }));
    await waitFor(() => {
      expect(screen.getByTestId("location").textContent).toBe(
        "/extensions/plugins?sort=name",
      );
    });
    expect(screen.queryByText("This panel view is unavailable.")).toBeNull();
  });

  it("restores a copied detail URL over Browse", async () => {
    const entry = catalogEntry("github", "GitHub");
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url === "/api/v1/plugins") {
          return new Response(JSON.stringify({ enabled: true, plugins: [] }), {
            headers: { "content-type": "application/json" },
          });
        }
        if (url.startsWith("/api/v1/plugin-catalog/search?q=")) {
          return new Response(JSON.stringify({ results: [entry] }), {
            headers: { "content-type": "application/json" },
          });
        }
        return new Response(JSON.stringify({ error: "not found" }), {
          status: 404,
          headers: { "content-type": "application/json" },
        });
      }),
    );
    const { wrapper } = createQueryClientTestHarness();
    render(
      <MemoryRouter initialEntries={["/extensions/plugins/github"]}>
        <Routes>
          <Route path="/extensions/plugins/*" element={<ToolsView />} />
        </Routes>
      </MemoryRouter>,
      { wrapper },
    );

    expect(await screen.findByPlaceholderText("Search plugins")).toBeTruthy();
    expect(await screen.findByRole("heading", { name: "GitHub" })).toBeTruthy();
    expect(
      screen
        .getByRole("button", { name: "GitHub" })
        .getAttribute("aria-pressed"),
    ).toBe("true");
  });

  it("decodes an author deep link before matching catalog identity", async () => {
    const entries = [
      catalogEntry("github", "GitHub"),
      catalogEntry("memory", "Memory"),
    ];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url === "/api/v1/plugins") {
          return new Response(JSON.stringify({ enabled: true, plugins: [] }), {
            headers: { "content-type": "application/json" },
          });
        }
        if (url.startsWith("/api/v1/plugin-catalog/search?q=")) {
          return new Response(JSON.stringify({ results: entries }), {
            headers: { "content-type": "application/json" },
          });
        }
        return new Response(JSON.stringify({ error: "not found" }), {
          status: 404,
          headers: { "content-type": "application/json" },
        });
      }),
    );
    const { wrapper } = createQueryClientTestHarness();
    render(
      <MemoryRouter
        initialEntries={[
          "/extensions/plugins/authors/12%3Abb-community%3Agithub%3Apatlee",
        ]}
      >
        <Routes>
          <Route path="/extensions/plugins/*" element={<ToolsView />} />
        </Routes>
      </MemoryRouter>,
      { wrapper },
    );

    expect(
      await screen.findByRole("heading", { name: "Pat Lee" }),
    ).toBeTruthy();
    expect(screen.getByText(/2 plugins/u)).toBeTruthy();
    expect(screen.queryByText("Author not found.")).toBeNull();
  });
});

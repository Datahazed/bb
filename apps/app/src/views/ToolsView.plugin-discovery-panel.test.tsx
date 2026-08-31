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
    author: {
      name: "Pat Lee",
      github: "patlee",
      url: "https://github.com/patlee",
    },
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
          if (query.length > 0) {
            return new Response(JSON.stringify({ error: "unavailable" }), {
              status: 503,
              headers: { "content-type": "application/json" },
            });
          }
          return new Response(
            JSON.stringify({
              results: entries,
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
    expect(
      document.querySelector("[data-persistent-drawer-content]"),
    ).toBeNull();
    browseViewport.scrollTop = 240;
    const githubOpen = await screen.findByRole("button", {
      name: "Open GitHub details",
    });
    githubOpen.focus();
    fireEvent.click(githubOpen);

    const githubHeading = await screen.findByRole("heading", {
      name: "GitHub",
    });
    await waitFor(() => {
      expect(document.activeElement).toBe(githubHeading);
    });
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

    fireEvent.click(screen.getByRole("button", { name: "Full Screen" }));
    await waitFor(() => {
      expect(
        browseViewport
          .closest("[data-conversation-collapsed]")
          ?.getAttribute("data-conversation-collapsed"),
      ).toBe("true");
    });
    fireEvent.click(screen.getByRole("button", { name: "Exit Full Screen" }));
    await waitFor(() => {
      expect(
        browseViewport
          .closest("[data-conversation-collapsed]")
          ?.getAttribute("data-conversation-collapsed"),
      ).toBe("false");
    });

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

    const splitLayout = document.querySelector("[data-split-resize-grid-root]");
    const githubTab = screen.getByRole("button", { name: "GitHub" });
    const memoryTab = screen.getByRole("button", { name: "Memory" });
    const memoryDetailHeading = screen.getByRole("heading", {
      name: "Memory",
    });
    expect(memoryTab.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(screen.getByRole("link", { name: "Pat Lee" }));
    await waitFor(() => {
      expect(screen.getByTestId("location").textContent).toBe(
        "/extensions/plugins/memory?sort=name&author=12%3Abb-community%3Agithub%3Apatlee",
      );
    });
    expect(
      await screen.findByRole("heading", { name: /^Pat Lee/u }),
    ).toBeTruthy();
    expect(document.querySelector("[data-split-resize-grid-root]")).toBe(
      splitLayout,
    );
    expect(screen.getByRole("button", { name: "GitHub" })).toBe(githubTab);
    expect(screen.getByRole("button", { name: "Memory" })).toBe(memoryTab);
    expect(screen.getByRole("heading", { name: "Memory" })).toBe(
      memoryDetailHeading,
    );
    expect(memoryTab.getAttribute("aria-pressed")).toBe("true");

    fireEvent.click(screen.getByRole("button", { name: "GitHub" }));
    await waitFor(() => {
      expect(screen.getByTestId("location").textContent).toBe(
        "/extensions/plugins/github?sort=name&author=12%3Abb-community%3Agithub%3Apatlee",
      );
    });
    fireEvent.click(screen.getByRole("button", { name: "Close GitHub" }));
    await waitFor(() => {
      expect(screen.getByTestId("location").textContent).toBe(
        "/extensions/plugins/memory?sort=name&author=12%3Abb-community%3Agithub%3Apatlee",
      );
    });
    expect(screen.queryByRole("button", { name: "GitHub" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Close Memory" }));
    await waitFor(() => {
      expect(screen.getByTestId("location").textContent).toBe(
        "/extensions/plugins/authors/12%3Abb-community%3Agithub%3Apatlee?sort=name",
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
      await screen.findByRole("heading", { name: /^Pat Lee/u }),
    ).toBeTruthy();
    expect(screen.getByText(/2 plugins/u)).toBeTruthy();
    expect(screen.queryByText("Author not found.")).toBeNull();
  });
});

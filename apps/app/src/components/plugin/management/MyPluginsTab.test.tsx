// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  EMPTY_PLUGIN_UPDATE_STATE,
  type PluginListItem,
  usePluginListings,
} from "@/hooks/queries/plugin-settings-queries";
import { usePluginCatalogSearch } from "@/hooks/queries/plugin-catalog-queries";
import { MyPluginsTab, PluginListingStatusPill } from "./MyPluginsTab";

vi.mock("@/hooks/queries/plugin-settings-queries", async (importOriginal) => {
  const original =
    await importOriginal<
      typeof import("@/hooks/queries/plugin-settings-queries")
    >();
  return { ...original, usePluginListings: vi.fn() };
});
vi.mock("@/hooks/queries/plugin-catalog-queries", async (importOriginal) => {
  const original =
    await importOriginal<
      typeof import("@/hooks/queries/plugin-catalog-queries")
    >();
  return { ...original, usePluginCatalogSearch: vi.fn() };
});

function plugin(id: string, name: string): PluginListItem {
  return {
    id,
    source: `path:/plugins/${id}`,
    rootDir: `/plugins/${id}`,
    version: "1.0.0",
    enabled: true,
    status: "running",
    statusDetail: null,
    lastProblem: null,
    categoryId: null,
    category: null,
    description: `${name} description`,
    name,
    icon: null,
    compactIconUrl: null,
    logoUrl: null,
    logoDarkUrl: null,
    hasSettings: false,
    provenance: "direct",
    isOrphanedBuiltin: false,
    catalogEntryId: null,
    publisherLabel: null,
    sourceDisplay: `path · /plugins/${id}`,
    updateState: EMPTY_PLUGIN_UPDATE_STATE,
    handlerStats: { count: 0, totalMs: 0, maxMs: 0, errorCount: 0 },
    services: [],
    schedules: [],
    cliCommand: null,
    capabilities: [],
    app: { hasApp: false, bundle: null },
  };
}

const draftEntry = {
  id: "usage",
  displayName: "Usage",
  description: "Usage description",
  icon: "Chart",
  author: { name: "Author" },
  source: {
    git: {
      url: "https://github.com/author/usage.git",
      range: "^1.0.0",
    },
  },
  category: "token-usage-and-cost",
  screenshots: [],
} as const;

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("MyPluginsTab", () => {
  it("groups authored records by real category and only pills exceptional rows", () => {
    vi.mocked(usePluginListings).mockReturnValue({
      data: {
        records: [
          {
            pluginId: "usage",
            authorship: "path",
            lifecycle: { status: "draft", entry: draftEntry },
          },
          {
            pluginId: "review",
            authorship: "path",
            lifecycle: {
              status: "in-review",
              entry: {
                ...draftEntry,
                id: "review",
                displayName: "Review",
                category: "notifications-and-attention",
              },
              pullRequest: {
                url: "https://github.com/get-bb/marketplace/pull/42",
                openedAt: 1,
              },
            },
          },
          {
            pluginId: "published",
            authorship: "path",
            lifecycle: {
              status: "published",
              entryId: "published",
              publishedAt: 1,
            },
          },
        ],
        notices: [],
      },
      isError: false,
      isFetching: false,
    } as never);
    vi.mocked(usePluginCatalogSearch).mockReturnValue({
      data: [
        {
          entryId: "published",
          category: "Code & Reviews",
        },
      ],
    } as never);
    const onOpenPlugin = vi.fn();

    render(
      <MemoryRouter>
        <MyPluginsTab
          plugins={[
            plugin("usage", "Usage"),
            plugin("review", "Review"),
            plugin("published", "Published plugin"),
          ]}
          onOpenPlugin={onOpenPlugin}
        />
      </MemoryRouter>,
    );

    expect(screen.getByText("Token Usage & Cost · 1")).toBeTruthy();
    expect(screen.getByText("Notifications & Attention · 1")).toBeTruthy();
    expect(screen.getByText("Code & Reviews · 1")).toBeTruthy();
    expect(screen.getByText("Not published")).toBeTruthy();
    expect(screen.getByText("In review")).toBeTruthy();
    expect(screen.queryByText("Other")).toBeNull();
    expect(screen.queryByText("Published")).toBeNull();

    fireEvent.click(
      screen.getByRole("button", { name: "Published plugin listing details" }),
    );
    expect(onOpenPlugin).toHaveBeenCalledWith("published");
  });

  it("uses the exact status token treatments", () => {
    const { rerender } = render(
      <PluginListingStatusPill lifecycle={{ status: "not-published" }} />,
    );
    const notPublishedPill = screen.getByText("Not published").parentElement;
    expect(notPublishedPill?.className).toContain("border-border/40");
    expect(notPublishedPill?.className).toContain("bg-surface-recessed/45");

    rerender(
      <PluginListingStatusPill
        lifecycle={{
          status: "published",
          entryId: "usage",
          publishedAt: 1,
        }}
        includePublished
      />,
    );
    expect(screen.getByText("Published").parentElement?.className).toContain(
      "bg-success/15",
    );
  });
});

// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  EMPTY_PLUGIN_UPDATE_STATE,
  type PluginListItem,
  usePluginListings,
} from "@/hooks/queries/plugin-settings-queries";
import { MyPluginsTab, PluginListingStatusPill } from "./MyPluginsTab";

vi.mock("@/hooks/queries/plugin-settings-queries", async (importOriginal) => {
  const original =
    await importOriginal<
      typeof import("@/hooks/queries/plugin-settings-queries")
    >();
  return { ...original, usePluginListings: vi.fn() };
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
  it("groups authored records by listing lifecycle without repeating row status", () => {
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
    const onOpenPlugin = vi.fn();

    render(
      <MemoryRouter>
        <MyPluginsTab
          plugins={[
            plugin("usage", "Usage"),
            plugin("review", "Review"),
            plugin("published", "Release Notes"),
          ]}
          onOpenPlugin={onOpenPlugin}
          onCreatePlugin={vi.fn()}
        />
      </MemoryRouter>,
    );

    const headings = screen.getAllByRole("heading", { level: 2 });
    expect(headings.map((heading) => heading.textContent)).toEqual([
      "Not published · 1",
      "In review · 1",
      "Published · 1",
      "Create another plugin",
    ]);
    expect(
      screen.getByRole("button", { name: "Usage listing details" }).textContent,
    ).not.toContain("Not published");
    expect(
      screen.getByRole("button", { name: "Review listing details" })
        .textContent,
    ).not.toContain("In review");
    expect(
      screen.getByRole("button", {
        name: "Release Notes listing details",
      }).textContent,
    ).not.toContain("Published");

    fireEvent.click(
      screen.getByRole("button", { name: "Release Notes listing details" }),
    );
    expect(onOpenPlugin).toHaveBeenCalledWith("published");
  });

  it("keeps the full creation examples alongside one to four authored plugins", () => {
    vi.mocked(usePluginListings).mockReturnValue({
      data: {
        records: [
          {
            pluginId: "usage",
            authorship: "path",
            lifecycle: { status: "draft", entry: draftEntry },
          },
        ],
        notices: [],
      },
      isError: false,
      isFetching: false,
    } as never);
    const onCreatePlugin = vi.fn();

    render(
      <MemoryRouter>
        <MyPluginsTab
          plugins={[plugin("usage", "Usage")]}
          onOpenPlugin={vi.fn()}
          onCreatePlugin={onCreatePlugin}
        />
      </MemoryRouter>,
    );

    expect(screen.getByText("Create another plugin")).toBeTruthy();
    expect(screen.getByText("Video editor")).toBeTruthy();
    expect(screen.getByText("Explore plugin capabilities")).toBeTruthy();
    fireEvent.click(screen.getByText("Kanban board"));
    expect(onCreatePlugin).toHaveBeenCalledOnce();
  });

  it("collapses creation examples after five authored plugins and expands them on request", () => {
    const ids = ["one", "two", "three", "four", "five"];
    vi.mocked(usePluginListings).mockReturnValue({
      data: {
        records: ids.map((id) => ({
          pluginId: id,
          authorship: "path" as const,
          lifecycle: {
            status: "draft" as const,
            entry: { ...draftEntry, id, displayName: id },
          },
        })),
        notices: [],
      },
      isError: false,
      isFetching: false,
    } as never);

    render(
      <MemoryRouter>
        <MyPluginsTab
          plugins={ids.map((id) => plugin(id, id))}
          onOpenPlugin={vi.fn()}
          onCreatePlugin={vi.fn()}
        />
      </MemoryRouter>,
    );

    expect(screen.getByText("Kanban board")).toBeTruthy();
    expect(screen.queryByText("Video editor")).toBeNull();
    expect(screen.queryByText("Explore plugin capabilities")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "View all examples" }));
    expect(screen.getByText("Video editor")).toBeTruthy();
    expect(screen.getByText("Explore plugin capabilities")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Show fewer" })).toBeTruthy();
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

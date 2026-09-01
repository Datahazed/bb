// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PluginCatalogSearchEntry } from "@/hooks/queries/plugin-catalog-queries";
import {
  EMPTY_PLUGIN_UPDATE_STATE,
  type PluginListItem,
  usePluginListings,
} from "@/hooks/queries/plugin-settings-queries";
import { MyPluginsTab } from "./MyPluginsTab";
import { PluginListingStatusPill } from "./PluginListingStatusPill";

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

function catalogEntry(
  overrides: Partial<PluginCatalogSearchEntry> = {},
): PluginCatalogSearchEntry {
  return {
    entryId: "published",
    pluginId: "published",
    displayName: "Release Notes",
    description: "Release Notes description",
    icon: "FileText",
    iconUrl: null,
    iconTinted: false,
    categoryId: "code-and-reviews",
    category: "Code & Reviews",
    screenshots: [],
    newAndNotableRank: null,
    source: "builtin:published",
    repositoryUrl: null,
    marketplace: "bb-community",
    marketplaceDisplayName: "BB Community",
    publisherKey: "bb-community",
    publisherLabel: "BB Community",
    official: false,
    author: { name: "Author" },
    installed: true,
    installs: 1_250,
    compatible: true,
    incompatibleReason: null,
    ...overrides,
  };
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("MyPluginsTab", () => {
  it("uses one Browse card grid with marketplace metadata or lifecycle status", () => {
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
          catalogEntriesByEntryId={new Map([["published", catalogEntry()]])}
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

    const notPublishedCard = screen.getByTestId("my-plugin-card-usage");
    const inReviewCard = screen.getByTestId("my-plugin-card-review");
    const publishedCard = screen.getByTestId("my-plugin-card-published");
    const cards = [notPublishedCard, inReviewCard, publishedCard];
    expect(
      Array.from(document.querySelectorAll('[data-testid^="my-plugin-card-"]')),
    ).toEqual(cards);
    expect(
      document.querySelectorAll("[data-resource-list-panel]"),
    ).toHaveLength(0);
    expect(
      screen.getByRole("heading", { level: 1, name: "My plugins 3 plugins" }),
    ).toBeTruthy();
    expect(
      document.querySelector("[data-authored-plugin-count]")?.textContent,
    ).toBe("3 plugins");
    expect(screen.queryByText("Create another plugin")).toBeNull();
    expect(notPublishedCard.querySelector(".row-start-3")?.textContent).toBe(
      "Not published",
    );
    expect(inReviewCard.querySelector(".row-start-3")?.textContent).toBe(
      "In review",
    );
    expect(within(notPublishedCard).queryByLabelText(/installed/u)).toBeNull();
    expect(within(inReviewCard).queryByLabelText(/installed/u)).toBeNull();

    const published = within(publishedCard);
    expect(
      published.getByLabelText("Release Notes installed — 1,250 installs")
        .textContent,
    ).toBe("1.3K");
    expect(publishedCard.querySelector(".row-start-3")?.textContent).toBe(
      "Code & Reviews",
    );
    expect(published.queryByText("Published")).toBeNull();

    fireEvent.click(
      screen.getByRole("button", { name: "Release Notes listing details" }),
    );
    expect(onOpenPlugin).toHaveBeenCalledWith("published");
  });

  it("keeps a published category visible while catalog data is unavailable", () => {
    vi.mocked(usePluginListings).mockReturnValue({
      data: {
        records: [
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

    render(
      <MemoryRouter>
        <MyPluginsTab
          plugins={[
            {
              ...plugin("published", "Release Notes"),
              categoryId: "code-and-reviews",
              category: "Code & Reviews",
            },
          ]}
          onOpenPlugin={vi.fn()}
          onCreatePlugin={vi.fn()}
        />
      </MemoryRouter>,
    );

    const card = screen.getByTestId("my-plugin-card-published");
    expect(card.querySelector(".row-start-3")?.textContent).toBe(
      "Code & Reviews",
    );
    expect(within(card).queryByLabelText(/installed/u)).toBeNull();
  });

  it("keeps the full creation examples alongside two authored plugins", () => {
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
            lifecycle: { status: "not-published" },
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
          plugins={[plugin("usage", "Usage"), plugin("review", "Review")]}
          onOpenPlugin={vi.fn()}
          onCreatePlugin={onCreatePlugin}
        />
      </MemoryRouter>,
    );

    expect(screen.getByText("Create another plugin")).toBeTruthy();
    expect(screen.getByText("Video editor")).toBeTruthy();
    expect(screen.getByText("Explore plugin capabilities")).toBeTruthy();
    expect(
      screen.getByRole("heading", { level: 1, name: "My plugins 2 plugins" }),
    ).toBeTruthy();
    fireEvent.click(screen.getByText("Kanban board"));
    expect(onCreatePlugin).toHaveBeenCalledOnce();
  });

  it("removes creation onboarding at three authored plugins", () => {
    const ids = ["three", "one", "two"];
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

    expect(screen.queryByText("Create another plugin")).toBeNull();
    expect(screen.queryByText("Kanban board")).toBeNull();
    expect(screen.queryByText("Video editor")).toBeNull();
    expect(screen.queryByText("Explore plugin capabilities")).toBeNull();
    expect(
      Array.from(
        document.querySelectorAll('[data-testid^="my-plugin-card-"]'),
      ).map((card) => card.getAttribute("data-testid")),
    ).toEqual([
      "my-plugin-card-one",
      "my-plugin-card-three",
      "my-plugin-card-two",
    ]);
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

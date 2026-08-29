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
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";
import { PluginAuthorPage } from "./PluginAuthorPage";

function catalogEntry(
  pluginId: string,
  categoryId: PluginCatalogSearchEntry["categoryId"],
  category: string,
): PluginCatalogSearchEntry {
  return {
    entryId: pluginId,
    pluginId,
    displayName: pluginId.replace(
      /(^|-)([a-z])/gu,
      (_match, _dash, letter: string) => letter.toUpperCase(),
    ),
    description: `${pluginId} description`,
    icon: "Zap",
    iconUrl: null,
    iconTinted: false,
    categoryId,
    category,
    screenshots: [],
    newAndNotableRank: null,
    source: `npm:${pluginId}`,
    repositoryUrl: null,
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

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("PluginAuthorPage", () => {
  it("restores an author URL and groups every published plugin by category", async () => {
    const entries = [
      catalogEntry(
        "emoji-react",
        "thread-content",
        "Thread Content",
      ),
      catalogEntry(
        "checklists",
        "thread-content",
        "Thread Content",
      ),
      catalogEntry("council", "agents-and-providers", "Agents & Providers"),
      withoutCategory(
        catalogEntry(
          "legacy-notes",
          "agents-and-providers",
          "Agents & Providers",
        ),
      ),
      {
        ...catalogEntry(
          "rival-author",
          "agents-and-providers",
          "Agents & Providers",
        ),
        author: { name: "Someone Else", url: "https://github.com/else" },
      },
    ];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url === "/api/v1/plugin-catalog/search?q=") {
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
    const onOpenPlugin = vi.fn();
    const { wrapper } = createQueryClientTestHarness();
    render(
      <MemoryRouter>
        <PluginAuthorPage
          authorId="12:bb-community:github:patlee"
          onOpenPlugin={onOpenPlugin}
        />
      </MemoryRouter>,
      { wrapper },
    );

    expect(
      await screen.findByRole("heading", { name: "Pat Lee" }),
    ).toBeTruthy();
    expect(
      screen.getByText(
        (_content, element) =>
          element?.tagName === "P" &&
          element.textContent?.startsWith("4 plugins ") === true,
      ),
    ).toBeTruthy();
    const messages = screen.getByRole("heading", {
      name: /Thread Content/,
    }).parentElement;
    expect(messages).not.toBeNull();
    expect(
      within(messages as HTMLElement).getByRole("button", {
        name: "Open EmojiReact details",
      }),
    ).toBeTruthy();
    expect(
      within(messages as HTMLElement).getByRole("button", {
        name: "Open Checklists details",
      }),
    ).toBeTruthy();
    expect(screen.queryByText("RivalAuthor")).toBeNull();
    expect(
      screen.getByRole("button", { name: "Open LegacyNotes details" }),
    ).toBeTruthy();
    expect(screen.getByRole("heading", { name: /BB Community/u })).toBeTruthy();
    expect(document.body.textContent).not.toContain("Other");

    const bylines = screen.getAllByRole("link", { name: "By: Pat Lee" });
    expect(bylines).toHaveLength(4);
    expect(bylines[0]?.getAttribute("href")).toBe(
      "/extensions/plugins/authors/12%3Abb-community%3Agithub%3Apatlee",
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Open Council details" }),
    );
    expect(onOpenPlugin).toHaveBeenCalledWith("council");
  });
});

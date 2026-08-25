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
    compatible: true,
    incompatibleReason: null,
  };
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
        "thread-messages-and-timelines",
        "Thread Messages & Timelines",
      ),
      catalogEntry(
        "checklists",
        "thread-messages-and-timelines",
        "Thread Messages & Timelines",
      ),
      catalogEntry("council", "agent-tools", "Agent Tools"),
      {
        ...catalogEntry("other-author", "agent-tools", "Agent Tools"),
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
          element.textContent?.startsWith("3 plugins ") === true,
      ),
    ).toBeTruthy();
    const messages = screen.getByRole("heading", {
      name: /Thread Messages & Timelines/,
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
    expect(screen.queryByText("OtherAuthor")).toBeNull();

    const bylines = screen.getAllByRole("link", { name: "By: Pat Lee" });
    expect(bylines).toHaveLength(3);
    expect(bylines[0]?.getAttribute("href")).toBe(
      "/extensions/plugins/authors/12%3Abb-community%3Agithub%3Apatlee",
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Open Council details" }),
    );
    expect(onOpenPlugin).toHaveBeenCalledWith("council");
  });
});

// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
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
    author: {
      name: "Pat Lee",
      github: "patlee",
      url: "https://patlee.dev",
    },
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
  it("shows every published plugin in one flat categorized author collection", async () => {
    const entries = [
      catalogEntry("emoji-react", "thread-content", "Thread Content"),
      catalogEntry("checklists", "thread-content", "Thread Content"),
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
        author: {
          name: "Someone Else",
          github: "else",
          url: "https://else.test",
        },
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
    const { container } = render(
      <MemoryRouter>
        <PluginAuthorPage
          authorId="12:bb-community:github:patlee"
          onOpenPlugin={onOpenPlugin}
        />
      </MemoryRouter>,
      { wrapper },
    );

    expect(
      await screen.findByRole("heading", { name: /^Pat Lee/u }),
    ).toBeTruthy();
    expect(
      screen
        .getByRole("img", { name: "Pat Lee's GitHub avatar" })
        .classList.contains("size-10"),
    ).toBe(true);
    expect(screen.getByText("4 plugins")).toBeTruthy();
    const githubLink = screen.getByRole("link", {
      name: "github.com/patlee",
    });
    expect(githubLink.getAttribute("href")).toBe("https://github.com/patlee");
    expect(screen.queryByText("patlee.dev")).toBeNull();
    expect(
      screen.getByRole("button", { name: "Open EmojiReact details" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Open Checklists details" }),
    ).toBeTruthy();
    expect(screen.queryByText("RivalAuthor")).toBeNull();
    expect(
      screen.getByRole("button", { name: "Open LegacyNotes details" }),
    ).toBeTruthy();
    expect(
      screen.queryByRole("heading", { name: /Thread Content/u }),
    ).toBeNull();
    expect(screen.queryByRole("heading", { name: /BB Community/u })).toBeNull();
    expect(document.body.textContent).not.toContain("Other");

    const authorBylines = screen.getAllByRole("link", {
      name: "By: Pat Lee",
    });
    expect(authorBylines).toHaveLength(4);
    expect(authorBylines[0]?.getAttribute("href")).toBe(
      "/extensions/plugins/authors/12%3Abb-community%3Agithub%3Apatlee",
    );
    expect(screen.getAllByText("Thread Content")).toHaveLength(2);
    expect(screen.getByText("Agents & Providers")).toBeTruthy();

    const cardOrder = () =>
      [
        ...container.querySelectorAll<HTMLButtonElement>(
          'button[aria-label^="Open "][aria-label$=" details"]',
        ),
      ].map((button) => button.getAttribute("aria-label"));
    expect(cardOrder()).toEqual([
      "Open Checklists details",
      "Open Council details",
      "Open EmojiReact details",
      "Open LegacyNotes details",
    ]);

    const search = screen.getByRole("textbox", { name: "Search plugins" });
    fireEvent.change(search, { target: { value: "emoji" } });
    expect(cardOrder()).toEqual(["Open EmojiReact details"]);
    fireEvent.change(search, { target: { value: "" } });

    fireEvent.click(
      screen.getByRole("button", {
        name: "Filter plugins by category: All categories",
      }),
    );
    expect(
      screen
        .getByRole("listbox", { name: "Plugin categories" })
        .getAttribute("aria-multiselectable"),
    ).toBe("true");
    fireEvent.click(screen.getByRole("option", { name: /Thread Content/u }));
    expect(cardOrder()).toEqual([
      "Open Checklists details",
      "Open EmojiReact details",
    ]);
    fireEvent.click(
      screen.getByRole("option", { name: /Agents & Providers/u }),
    );
    expect(cardOrder()).toEqual([
      "Open Checklists details",
      "Open Council details",
      "Open EmojiReact details",
    ]);
    expect(
      screen.getByRole("button", {
        name: "Filter plugins by category: Thread Content, Agents & Providers",
      }).textContent,
    ).toContain("2 categories");
    fireEvent.click(screen.getByRole("button", { name: "Clear filter" }));
    expect(cardOrder()).toEqual([
      "Open Checklists details",
      "Open Council details",
      "Open EmojiReact details",
      "Open LegacyNotes details",
    ]);

    fireEvent.pointerDown(screen.getByRole("button", { name: "Sort plugins" }));
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Name" }));
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Name" }));
    expect(cardOrder()).toEqual([
      "Open LegacyNotes details",
      "Open EmojiReact details",
      "Open Council details",
      "Open Checklists details",
    ]);

    fireEvent.click(
      screen.getByRole("button", { name: "Open Council details" }),
    );
    expect(onOpenPlugin).toHaveBeenCalledWith("council");
  });

  it("does not surface an arbitrary author URL without a GitHub identity", async () => {
    const entry = {
      ...catalogEntry("acme-tools", "plugin-development", "Plugin Development"),
      author: {
        name: "Acme",
        github: null,
        url: "https://acme.example",
      },
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ results: [entry] }), {
            headers: { "content-type": "application/json" },
          }),
      ),
    );
    const { wrapper } = createQueryClientTestHarness();
    render(
      <MemoryRouter>
        <PluginAuthorPage
          authorId="12:bb-community:name:acme"
          onOpenPlugin={() => {}}
        />
      </MemoryRouter>,
      { wrapper },
    );

    expect(await screen.findByRole("heading", { name: /^Acme/u })).toBeTruthy();
    expect(
      screen
        .getByRole("img", { name: "Acme's avatar" })
        .classList.contains("size-10"),
    ).toBe(true);
    expect(screen.getByText("A")).toBeTruthy();
    expect(screen.queryByRole("link", { name: /acme\.example/u })).toBeNull();
    expect(
      screen.getByRole("textbox", { name: "Search plugins" }),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "Sort plugins" })).toBeTruthy();
    expect(
      screen.getByRole("button", {
        name: "Filter plugins by category: All categories",
      }),
    ).toBeTruthy();
  });
});

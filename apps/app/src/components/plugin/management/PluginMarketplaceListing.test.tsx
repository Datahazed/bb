// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CatalogPluginDetail } from "@/components/tools/PluginDetail";
import type { PluginCatalogSearchEntry } from "@/hooks/queries/plugin-catalog-queries";

function catalogEntry(pluginId: string): PluginCatalogSearchEntry {
  return {
    entryId: pluginId,
    pluginId,
    displayName: pluginId === "usage" ? "Usage" : "Headroom",
    description: `${pluginId} description`,
    icon: "ChartColumn",
    iconUrl: null,
    iconTinted: false,
    categoryId: "token-usage-and-cost",
    category: "Token Usage & Limits",
    screenshots: [],
    newAndNotableRank: null,
    source: `npm:${pluginId}`,
    repositoryUrl: "https://github.com/patlee/usage",
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
  vi.useRealTimers();
});

describe("PluginMarketplaceListing", () => {
  it("renders zero and supplied listing evidence while hiding absent values", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-25T12:00:00.000Z"));
    const usage = {
      ...catalogEntry("usage"),
      screenshots: ["/screenshots/usage-one.png", "/screenshots/usage-two.png"],
      installs: 0,
      updatedAt: "2026-08-24T12:00:00.000Z",
    };
    const headroom = catalogEntry("headroom");
    const { rerender } = render(
      <MemoryRouter>
        <CatalogPluginDetail
          entry={usage}
          catalogEntries={[usage, headroom]}
          onInstall={() => {}}
          onOpenPlugin={() => {}}
        />
      </MemoryRouter>,
    );

    const installCount = screen.getByLabelText("0 installs");
    expect(installCount.textContent).toBe("0");
    const installButton = screen.getByRole("button", {
      name: "Install Usage",
    });
    expect(installButton.getAttribute("aria-describedby")).toBe(
      installCount.id,
    );
    expect(installCount.closest("button")).toBe(installButton);
    expect(
      installButton.classList.contains("border-border/50"),
    ).toBe(true);
    const authorAvatar = screen.getByRole("img", {
      name: "Pat Lee's GitHub avatar",
    });
    expect(authorAvatar.classList.contains("size-5")).toBe(true);
    expect(screen.getAllByRole("img", { name: /GitHub avatar/u })).toHaveLength(
      1,
    );
    const titleRow = screen.getByRole("heading", {
      name: "Usage",
    }).parentElement;
    expect(titleRow?.textContent).toContain("Token Usage & Limits");
    expect(titleRow?.nextElementSibling?.textContent).not.toContain(
      "Token Usage & Limits",
    );
    const updated = screen.getByLabelText(/^Updated /u);
    expect(updated.tagName).toBe("TIME");
    expect(updated.getAttribute("datetime")).toBe("2026-08-24T12:00:00.000Z");
    expect(
      screen.getByRole("img", { name: "Usage screenshot 1" }),
    ).toBeTruthy();
    const screenshot = screen.getByRole("img", {
      name: "Usage screenshot 1",
    });
    const aboutHeading = screen.getByRole("heading", { name: "About" });
    expect(
      screenshot.compareDocumentPosition(aboutHeading) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Screenshots" })).toBeNull();
    expect(screenshot.closest("[data-plugin-marketplace-overview]")).toBe(
      aboutHeading.closest("[data-plugin-marketplace-overview]"),
    );
    expect(screen.getByText("More from this author")).toBeTruthy();
    expect(screen.getByText("Headroom")).toBeTruthy();
    const sectionOrder = [...document.querySelectorAll("h2, h3")]
      .map((heading) => heading.textContent?.trim())
      .filter(
        (label): label is string =>
          label === "About" ||
          label === "Source" ||
          label === "Details" ||
          label === "More from this author",
      );
    expect(sectionOrder.at(-1)).toBe("More from this author");
    expect(sectionOrder).toEqual([
      "About",
      "Source",
      "Details",
      "More from this author",
    ]);
    expect(screen.getByText("Last updated")).toBeTruthy();
    expect(screen.getByText("Source")).toBeTruthy();
    expect(screen.getByText("Marketplace")).toBeTruthy();
    expect(screen.getByText("BB Community")).toBeTruthy();
    expect(screen.queryByText("Category")).toBeNull();
    expect(
      screen
        .getAllByText("Token Usage & Limits")
        .some(
          (label) => label.closest("[data-resource-detail-section]") === null,
        ),
    ).toBe(true);
    const sourceLink = screen.getByRole("link", {
      name: /github\.com\/patlee\/usage/u,
    });
    const sourceIcon = sourceLink.querySelector('[data-icon="GithubFilled"]');
    expect(sourceIcon).not.toBeNull();
    expect(sourceIcon?.classList.contains("fill-current")).toBe(true);
    expect(sourceIcon?.getAttribute("class")).toContain("[&_*]:stroke-0");
    const viewAllCaret = screen
      .getByRole("link", { name: /View all/u })
      .querySelector('[data-icon="ChevronRight"]');
    expect(viewAllCaret).not.toBeNull();
    expect(viewAllCaret?.className).not.toContain("group-hover:translate-x-1");
    expect(screen.queryByText("By: Pat Lee")).toBeNull();
    expect(screen.getAllByText("Token Usage & Limits")).toHaveLength(2);
    const recommendationAction = screen.getByRole("button", {
      name: "Open Headroom details",
    });
    const recommendationCard = recommendationAction.closest("div");
    expect(
      recommendationCard?.classList.contains("hover:border-foreground/30"),
    ).toBe(true);
    expect(
      recommendationCard?.classList.contains(
        "hover:bg-[color-mix(in_oklab,var(--ink)_2.5%,transparent)]",
      ),
    ).toBe(true);
    expect(recommendationCard?.classList.contains("hover:shadow-sm")).toBe(
      true,
    );
    expect(recommendationCard?.className).not.toContain(
      "plugin-recommendation",
    );
    expect(
      recommendationCard?.style.getPropertyValue(
        "--plugin-recommendation-hover",
      ),
    ).toBe("");
    expect(
      screen
        .getAllByRole("link", { name: /Pat Lee/u })[0]
        ?.getAttribute("href"),
    ).toBe("/extensions/plugins/authors/12%3Abb-community%3Agithub%3Apatlee");

    const withoutEvidence = withoutCategory({
      ...catalogEntry("usage"),
      repositoryUrl: null,
    });
    rerender(
      <MemoryRouter>
        <CatalogPluginDetail entry={withoutEvidence} onInstall={() => {}} />
      </MemoryRouter>,
    );
    expect(screen.queryByText(/installs/u)).toBeNull();
    expect(screen.queryByText("Last updated")).toBeNull();
    expect(screen.queryByText("Source")).toBeNull();
    expect(screen.queryByRole("img", { name: /screenshot/u })).toBeNull();
    expect(screen.queryByText("More from this author")).toBeNull();
    expect(screen.getByText("Pat Lee")).toBeTruthy();
    expect(screen.queryByText("Token Usage & Limits")).toBeNull();
    expect(document.body.textContent).not.toContain("Other");
  });

  it("uses the initials fallback and only labels GitHub repository sources", () => {
    const entry = {
      ...catalogEntry("usage"),
      author: {
        name: "Pat Lee",
        github: null,
        url: null,
      },
      repositoryUrl: "https://gitlab.com/patlee/usage",
    };
    render(
      <MemoryRouter>
        <CatalogPluginDetail entry={entry} onInstall={() => {}} />
      </MemoryRouter>,
    );

    const avatar = screen.getByRole("img", { name: "Pat Lee's avatar" });
    expect(avatar.classList.contains("size-5")).toBe(true);
    expect(screen.getByText("PL")).toBeTruthy();
    expect(
      screen
        .getByRole("link", { name: /gitlab\.com\/patlee\/usage/u })
        .querySelector('[data-icon="GithubFilled"]'),
    ).toBeNull();
  });
});

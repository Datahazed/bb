// @vitest-environment jsdom

import { cleanup, render } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { PLUGIN_CATALOG_CATEGORIES } from "@bb/domain";
import {
  CatalogEntryIcon,
  PluginCategoryLabel,
  pluginCatalogCategoryAccentStyle,
  pluginCatalogCategoryMutedAccentStyle,
  pluginCatalogCategoryPillStyle,
} from "./plugin-ui";

afterEach(cleanup);

it("renders author artwork as supplied even when catalog metadata marks it tinted", () => {
  const iconUrl = "/api/v1/plugin-catalog/icons/bb-community/agent-proxy?h=ab";
  const view = render(
    <CatalogEntryIcon
      entry={{
        displayName: "Agent Proxy",
        icon: null,
        iconUrl,
        iconTinted: true,
      }}
      className="size-6"
    />,
  );

  expect(view.container.querySelector("img")?.getAttribute("src")).toBe(
    iconUrl,
  );
  expect(view.container.querySelector("[data-plugin-icon-asset]")).toBeNull();
});

it("embeds a marketplace listing's logo as an image", () => {
  const iconUrl = "/api/v1/plugin-catalog/icons/acme/widgets?h=cd";
  const view = render(
    <CatalogEntryIcon
      entry={{ displayName: "Widgets", icon: null, iconUrl, iconTinted: false }}
      className="size-6"
    />,
  );

  expect(view.container.querySelector("img")?.getAttribute("src")).toBe(
    iconUrl,
  );
});

it("uses semantic category ink without changing the stronger pill fill", () => {
  const view = render(
    <PluginCategoryLabel
      categoryId="memory-and-context"
      label="Memory & Context"
    />,
  );

  const pill = view.getByText("Memory & Context");
  expect(pill.style.background).toBe(
    "color-mix(in oklab, var(--success) 16%, var(--canvas))",
  );
  expect(pill.style.color).toBe(
    "color-mix(in oklab, var(--success) 52%, var(--ink))",
  );
});

it("derives every category treatment from the canonical category token", () => {
  for (const category of PLUGIN_CATALOG_CATEGORIES) {
    expect(pluginCatalogCategoryPillStyle(category.id)).toEqual({
      background: `color-mix(in oklab, var(${category.accentToken}) 16%, var(--canvas))`,
      color: `color-mix(in oklab, var(${category.accentToken}) 52%, var(--ink))`,
    });
    expect(pluginCatalogCategoryMutedAccentStyle(category.id)).toEqual({
      background: `color-mix(in oklab, var(${category.accentToken}) 55%, var(--canvas))`,
    });
    expect(pluginCatalogCategoryAccentStyle(category.id)).toEqual({
      background: `var(${category.accentToken})`,
    });
  }
});

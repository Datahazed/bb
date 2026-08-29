// @vitest-environment jsdom

import { cleanup, render } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { CatalogEntryIcon } from "./plugin-ui";

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
  // Masking would repaint the asset with bb's currentColor. A catalog hint
  // cannot safely distinguish a UI glyph from a monochrome brand mark.
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

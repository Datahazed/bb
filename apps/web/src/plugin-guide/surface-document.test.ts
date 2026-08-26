import { createElement, Fragment } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  createPluginSurfaceAgentReference,
  renderSurfaceCopy,
  SURFACE_GROUPS,
} from "@bb/plugin-api-map";

import { PluginSurfaceDocument } from "./surface-document";

function renderText(value: string): string {
  return renderToStaticMarkup(createElement(Fragment, null, value));
}

function cardMarkup(documentMarkup: string, surfaceId: string): string {
  const marker = `data-plugin-surface-id="${surfaceId}"`;
  const markerIndex = documentMarkup.indexOf(marker);
  expect(markerIndex).toBeGreaterThanOrEqual(0);

  const articleStart = documentMarkup.lastIndexOf("<article", markerIndex);
  const articleEnd = documentMarkup.indexOf("</article>", markerIndex);
  expect(articleStart).toBeGreaterThanOrEqual(0);
  expect(articleEnd).toBeGreaterThan(markerIndex);
  return documentMarkup.slice(articleStart, articleEnd + "</article>".length);
}

describe("PluginSurfaceDocument", () => {
  it("ships every surface's essential documentation in static HTML", () => {
    const html = renderToStaticMarkup(createElement(PluginSurfaceDocument));

    for (const group of SURFACE_GROUPS) {
      for (const surface of group.surfaces) {
        const card = cardMarkup(html, surface.id);
        const reference =
          createPluginSurfaceAgentReference(surface).clipboard.text;
        const renderedSummary = renderToStaticMarkup(
          createElement(Fragment, null, renderSurfaceCopy(surface.summary)),
        );

        expect(card).toContain(`<h4>${renderText(surface.title)}</h4>`);
        expect(card).toContain(renderedSummary);
        expect(card).toContain(
          `data-plugin-surface-reference="true">${renderText(reference)}</code>`,
        );
        for (const symbol of surface.apiSymbols) {
          expect(card).toContain(`>${renderText(symbol)}</code>`);
        }
      }
    }
  });
});

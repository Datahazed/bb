import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  MARKETPLACE_STATS_FIXTURE,
  MARKETPLACE_V2_FIXTURE,
} from "./marketplace-v2.fixture.js";
import {
  PublicMarketplacePage,
  PublicMarketplaceUnavailablePage,
} from "./public-marketplace.js";

describe("public marketplace rendering", () => {
  it("renders author artwork as an image without a recoloring mask", () => {
    const html = renderToStaticMarkup(
      <PublicMarketplacePage
        manifest={MARKETPLACE_V2_FIXTURE}
        stats={MARKETPLACE_STATS_FIXTURE}
        state={{}}
        onStateChange={() => {}}
      />,
    );
    expect(html).toContain("/marketplace/v2/icons/review-companion.svg");
    expect(html).toContain("<img");
    expect(html).not.toContain("mask-image");
    expect(html).not.toContain("Aug 24, 2026");
  });

  it("renders a stated unavailable page instead of throwing", () => {
    const html = renderToStaticMarkup(<PublicMarketplaceUnavailablePage />);
    expect(html).toContain("The Marketplace is temporarily unavailable");
    expect(html).toContain("Try again in a little while");
  });
});

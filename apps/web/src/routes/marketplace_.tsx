import interWoff2 from "@fontsource-variable/inter/files/inter-latin-wght-normal.woff2?url";
import {
  createFileRoute,
  Outlet,
  useRouterState,
} from "@tanstack/react-router";

import landingCss from "../landing/landing.css?url";
import { unfurlMeta } from "../landing/site.js";
import marketplaceCss from "../marketplace/marketplace.css?url";
import {
  isMarketplaceCategoryId,
  isMarketplaceSort,
  PublicMarketplacePage,
  type MarketplaceIndexState,
} from "../marketplace/public-marketplace.js";
import { getPublicMarketplace } from "../marketplace/marketplace-server.js";

const PAGE_TITLE = "Plugin marketplace — bb";
const PAGE_DESCRIPTION =
  "Discover community plugins for bb, from agent tools and themes to automation, code review, and task tracking.";

// The trailing filename underscore keeps the v1/v2 object routes root-owned.

export const Route = createFileRoute("/marketplace_")({
  validateSearch: (search: Record<string, unknown>): MarketplaceIndexState => ({
    ...(isMarketplaceCategoryId(search.category)
      ? { category: search.category }
      : {}),
    ...(isMarketplaceSort(search.sort) ? { sort: search.sort } : {}),
  }),
  loader: () => getPublicMarketplace(),
  head: () => ({
    meta: [
      { title: PAGE_TITLE },
      { name: "description", content: PAGE_DESCRIPTION },
      { name: "robots", content: "index, follow" },
      ...unfurlMeta(PAGE_TITLE, PAGE_DESCRIPTION, "/marketplace"),
    ],
    links: [
      {
        rel: "preload",
        href: interWoff2,
        as: "font",
        type: "font/woff2",
        crossOrigin: "anonymous",
      },
      { rel: "canonical", href: "https://getbb.app/marketplace" },
      { rel: "stylesheet", href: landingCss },
      { rel: "stylesheet", href: marketplaceCss },
    ],
  }),
  component: MarketplaceRoute,
});

function MarketplaceRoute() {
  const path = useRouterState({ select: (state) => state.location.pathname });
  const { manifest, stats } = Route.useLoaderData();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  if (path !== "/marketplace" && path !== "/marketplace/") return <Outlet />;
  return (
    <PublicMarketplacePage
      manifest={manifest}
      stats={stats}
      state={search}
      onStateChange={(next) => void navigate({ search: next })}
    />
  );
}

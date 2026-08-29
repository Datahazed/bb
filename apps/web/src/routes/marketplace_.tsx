import interWoff2 from "@fontsource-variable/inter/files/inter-latin-wght-normal.woff2?url";
import {
  createFileRoute,
  Outlet,
  useRouterState,
} from "@tanstack/react-router";

import landingCss from "../landing/landing.css?url";
import { unfurlMeta } from "../landing/site.js";
import marketplaceCss from "../marketplace/marketplace.css?url";
import { getPublicMarketplace } from "../marketplace/marketplace-server.js";
import {
  isMarketplaceCategoryId,
  isMarketplaceSort,
  PublicMarketplacePage,
  PublicMarketplaceUnavailablePage,
  type MarketplaceIndexState,
} from "../marketplace/public-marketplace.js";

const PAGE_TITLE = "Plugin Marketplace — bb";
const PAGE_DESCRIPTION =
  "Discover community plugins that add new capabilities to bb.";

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
  const marketplace = Route.useLoaderData();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  if (path !== "/marketplace" && path !== "/marketplace/") return <Outlet />;
  if (marketplace.status === "unavailable") {
    return <PublicMarketplaceUnavailablePage />;
  }
  return (
    <PublicMarketplacePage
      manifest={marketplace.manifest}
      stats={marketplace.stats}
      state={search}
      onStateChange={(next) => void navigate({ search: next })}
    />
  );
}

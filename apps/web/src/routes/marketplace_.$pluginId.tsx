import interWoff2 from "@fontsource-variable/inter/files/inter-latin-wght-normal.woff2?url";
import { createFileRoute, notFound } from "@tanstack/react-router";

import landingCss from "../landing/landing.css?url";
import { unfurlMeta } from "../landing/site.js";
import marketplaceCss from "../marketplace/marketplace.css?url";
import { getPublicMarketplace } from "../marketplace/marketplace-server.js";
import {
  PublicMarketplaceDetailPage,
  PublicMarketplaceUnavailablePage,
} from "../marketplace/public-marketplace.js";

export const Route = createFileRoute("/marketplace_/$pluginId")({
  loader: async ({ params }) => {
    const marketplace = await getPublicMarketplace();
    if (marketplace.status === "unavailable") return marketplace;
    const entry = marketplace.manifest.plugins.find(
      (candidate) => candidate.id === params.pluginId,
    );
    if (entry === undefined) throw notFound();
    return { ...marketplace, entry };
  },
  head: ({ loaderData, params }) => {
    const entry = loaderData?.status === "available" ? loaderData.entry : null;
    const title = entry
      ? `${entry.displayName} — bb Plugin Marketplace`
      : "Plugin Marketplace — bb";
    const description =
      entry?.description ?? "Discover community plugins for bb.";
    const path = `/marketplace/${encodeURIComponent(params.pluginId)}`;
    return {
      meta: [
        { title },
        { name: "description", content: description },
        { name: "robots", content: entry ? "index, follow" : "noindex" },
        ...unfurlMeta(title, description, path),
      ],
      links: [
        {
          rel: "preload",
          href: interWoff2,
          as: "font",
          type: "font/woff2",
          crossOrigin: "anonymous",
        },
        { rel: "canonical", href: `https://getbb.app${path}` },
        { rel: "stylesheet", href: landingCss },
        { rel: "stylesheet", href: marketplaceCss },
      ],
    };
  },
  component: MarketplaceDetailRoute,
});

function MarketplaceDetailRoute() {
  const marketplace = Route.useLoaderData();
  if (marketplace.status === "unavailable") {
    return <PublicMarketplaceUnavailablePage />;
  }
  return (
    <PublicMarketplaceDetailPage
      manifest={marketplace.manifest}
      entry={marketplace.entry}
      stats={marketplace.stats}
    />
  );
}

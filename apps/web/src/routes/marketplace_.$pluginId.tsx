import interWoff2 from "@fontsource-variable/inter/files/inter-latin-wght-normal.woff2?url";
import { createFileRoute, notFound } from "@tanstack/react-router";

import landingCss from "../landing/landing.css?url";
import { unfurlMeta } from "../landing/site.js";
import marketplaceCss from "../marketplace/marketplace.css?url";
import { getPublicMarketplace } from "../marketplace/marketplace-server.js";
import { PublicMarketplaceDetailPage } from "../marketplace/public-marketplace.js";

export const Route = createFileRoute("/marketplace_/$pluginId")({
  loader: async ({ params }) => {
    const marketplace = await getPublicMarketplace();
    const entry = marketplace.manifest.plugins.find(
      (candidate) => candidate.id === params.pluginId,
    );
    if (entry === undefined) throw notFound();
    return { ...marketplace, entry };
  },
  head: ({ loaderData, params }) => {
    const title = loaderData
      ? `${loaderData.entry.displayName} — bb plugin marketplace`
      : "Plugin not found — bb";
    const description =
      loaderData?.entry.description ??
      "This bb marketplace plugin was not found.";
    const path = `/marketplace/${encodeURIComponent(params.pluginId)}`;
    return {
      meta: [
        { title },
        { name: "description", content: description },
        { name: "robots", content: loaderData ? "index, follow" : "noindex" },
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
  const { manifest, entry, stats } = Route.useLoaderData();
  return (
    <PublicMarketplaceDetailPage
      manifest={manifest}
      entry={entry}
      stats={stats}
    />
  );
}

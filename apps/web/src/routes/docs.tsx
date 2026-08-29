import interWoff2 from "@fontsource-variable/inter/files/inter-latin-wght-normal.woff2?url";
import { createFileRoute } from "@tanstack/react-router";

import landingCss from "../landing/landing.css?url";
import { unfurlMeta } from "../landing/site.js";
import { PluginGuidePage } from "../plugin-guide/plugin-guide-page.js";
import pluginGuideCss from "../plugin-guide/plugin-guide.css?url";

const PAGE_TITLE = "Plugin Guide — bb";
const PAGE_DESCRIPTION =
  "Build bb plugins with a complete reference to every app surface, command, service, setting, and agent capability you can extend.";

export const Route = createFileRoute("/docs")({
  head: () => ({
    meta: [
      { title: PAGE_TITLE },
      { name: "description", content: PAGE_DESCRIPTION },
      { name: "robots", content: "index, follow" },
      ...unfurlMeta(PAGE_TITLE, PAGE_DESCRIPTION, "/docs"),
    ],
    links: [
      {
        rel: "preload",
        href: interWoff2,
        as: "font",
        type: "font/woff2",
        crossOrigin: "anonymous",
      },
      { rel: "canonical", href: "https://getbb.app/docs" },
      { rel: "stylesheet", href: pluginGuideCss },
      { rel: "stylesheet", href: landingCss },
    ],
  }),
  component: PluginGuidePage,
});

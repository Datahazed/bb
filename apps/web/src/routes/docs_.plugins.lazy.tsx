import { createLazyFileRoute } from "@tanstack/react-router";

import { PluginGuidePage } from "../plugin-guide/plugin-guide-page.js";

export const Route = createLazyFileRoute("/docs_/plugins")({
  component: PluginGuidePage,
});

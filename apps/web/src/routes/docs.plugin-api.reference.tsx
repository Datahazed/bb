import { createFileRoute } from "@tanstack/react-router";

import { ReferenceOverview } from "../docs-plugin-api/reference-overview";

export const Route = createFileRoute("/docs/plugin-api/reference")({
  head: () => ({
    meta: [
      { title: "API reference — bb Plugin API" },
      {
        name: "description",
        content:
          "The generated reference for the bb plugin SDK: every entry point and exported API, organized by task.",
      },
    ],
  }),
  component: ReferenceOverview,
});

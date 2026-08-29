import {
  MARKETPLACE_V2_SCHEMA_URL,
  type MarketplaceV2Manifest,
} from "./marketplace-v2.js";
import type { MarketplaceStats } from "./marketplace-stats.js";

export const MARKETPLACE_V2_FIXTURE: MarketplaceV2Manifest = {
  $schema: MARKETPLACE_V2_SCHEMA_URL,
  schemaVersion: 2,
  name: "bb-community",
  displayName: "BB Community",
  description: "Plugins published by the bb community.",
  newAndNotable: ["review-companion", "prompt-library"],
  plugins: [
    {
      id: "prompt-library",
      displayName: "Prompt Library",
      description: "Save and reuse project prompts from the composer.",
      icon: "FileText",
      category: "thread-content",
      screenshots: ["screenshots/prompt-library.png"],
      publishedAt: "2026-07-14T09:30:00Z",
      updatedAt: "2026-08-24T16:45:00+02:00",
      tags: ["prompts", "templates"],
      author: { name: "BB Labs", github: "get-bb" },
      source: {
        npm: {
          package: "@get-bb/plugin-prompt-library",
          range: "^1.2.0",
        },
      },
    },
    {
      id: "review-companion",
      displayName: "Review Companion",
      description: "Keep pull request checks and review context together.",
      icon: { url: "icons/review-companion.svg" },
      category: "code-and-reviews",
      tags: ["github", "code-review"],
      author: { name: "Acme", github: "acme-tools" },
      source: {
        git: {
          url: "https://github.com/acme/bb-plugins.git",
          subdir: "plugins/review-companion",
          range: ">=1.0.0 <2.0.0",
          tagPrefix: "review-companion/",
        },
      },
    },
  ],
};

export const MARKETPLACE_STATS_FIXTURE: MarketplaceStats = {
  schemaVersion: 1,
  generatedAt: "2026-08-25T06:17:00.000Z",
  plugins: { "prompt-library": { installs: 1_204 } },
};

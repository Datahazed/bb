import type {
  MarketplaceEntryV1,
  MarketplaceEntryV2,
  MarketplaceManifestV1,
  MarketplaceManifestV2,
} from "./marketplace-manifest.js";
import {
  CURATED_MARKETPLACE_NAME,
  MARKETPLACE_V1_SCHEMA_URL,
  MARKETPLACE_V2_SCHEMA_URL,
} from "./marketplace-manifest.js";

interface CuratedMarketplaceSource {
  name: string;
  displayName: string;
  description: string;
  newAndNotable: string[];
  plugins: MarketplaceEntryV2[];
}

export const BUNDLED_CURATED_MARKETPLACE_SOURCE: CuratedMarketplaceSource = {
  name: CURATED_MARKETPLACE_NAME,
  displayName: "BB Community",
  description:
    "Plugins published to the BB registry and reviewed by the BB team.",
  newAndNotable: ["prompt-shaper", "thread-hover-cards"],
  plugins: [
    {
      id: "thread-hover-cards",
      displayName: "Thread Hover Cards",
      description:
        "Preview thread status, the latest agent update, and repository or PR context from the sidebar.",
      icon: "ZoomIn",
      category: "thread-lists-and-navigation",
      screenshots: [],
      tags: ["interface", "threads", "sidebar"],
      author: { name: "Bersabel Tadesse", github: "brsbl" },
      source: {
        git: {
          url: "https://github.com/brsbl/bb-plugins.git",
          ref: "30f91fd977ba1ce60532af27a68534464fb62516",
        },
      },
    },
    {
      id: "prompt-shaper",
      displayName: "Prompt Improver",
      description:
        "Adds an Improve prompt action to the composer that sends your rough draft to a hidden helper agent, which applies the prompt-shaper skill to rewrite it into a clear, complete prompt and returns it in place for review before you send.",
      icon: "AiContentGenerator01",
      category: "thread-content",
      screenshots: [],
      tags: ["agent-interaction", "prompts"],
      author: { name: "Bersabel Tadesse", github: "brsbl" },
      source: {
        git: {
          url: "https://github.com/brsbl/bb-plugins.git",
          ref: "1c6bb2e8ad3551466981e7eb027cc4b1f3428cac",
        },
      },
    },
  ],
};

function marketplaceEntryV1(entry: MarketplaceEntryV2): MarketplaceEntryV1 {
  const {
    category: _category,
    screenshots: _screenshots,
    publishedAt: _publishedAt,
    updatedAt: _updatedAt,
    ...v1Entry
  } = entry;
  return v1Entry;
}

export function projectCuratedMarketplaceV1(
  source: CuratedMarketplaceSource,
): MarketplaceManifestV1 {
  return {
    $schema: MARKETPLACE_V1_SCHEMA_URL,
    schemaVersion: 1,
    name: source.name,
    displayName: source.displayName,
    description: source.description,
    plugins: source.plugins.map(marketplaceEntryV1),
  };
}

export function projectCuratedMarketplaceV2(
  source: CuratedMarketplaceSource,
): MarketplaceManifestV2 {
  return {
    $schema: MARKETPLACE_V2_SCHEMA_URL,
    schemaVersion: 2,
    name: source.name,
    displayName: source.displayName,
    description: source.description,
    newAndNotable: [...source.newAndNotable],
    plugins: source.plugins.map((entry) => ({ ...entry })),
  };
}

export const BUNDLED_CURATED_MARKETPLACE_V1 = projectCuratedMarketplaceV1(
  BUNDLED_CURATED_MARKETPLACE_SOURCE,
);
export const BUNDLED_CURATED_MARKETPLACE_V2 = projectCuratedMarketplaceV2(
  BUNDLED_CURATED_MARKETPLACE_SOURCE,
);

export const BUNDLED_CURATED_MARKETPLACE = BUNDLED_CURATED_MARKETPLACE_V2;

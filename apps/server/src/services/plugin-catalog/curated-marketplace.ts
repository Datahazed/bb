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

/**
 * Seed snapshot of the official marketplace, bundled with the app. It is the
 * first-run catalog and the offline fallback when a refresh has never
 * succeeded. Entry ids are plugin ids: an install aborts when the fetched
 * manifest declares another id.
 *
 * github.com/brsbl/bb-plugins is the source of truth for these plugins; the
 * published manifest replaces this snapshot on the first successful refresh.
 */
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
          // Pinned to a reviewed commit of bb-plugins plugin/thread-hover-cards.
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
      category: "composer-and-prompts",
      screenshots: [],
      tags: ["agent-interaction", "prompts"],
      author: { name: "Bersabel Tadesse", github: "brsbl" },
      source: {
        git: {
          url: "https://github.com/brsbl/bb-plugins.git",
          // Pinned to a reviewed commit of bb-plugins plugin/improve-prompt.
          ref: "1c6bb2e8ad3551466981e7eb027cc4b1f3428cac",
        },
      },
    },
  ],
};

function marketplaceEntryV1(entry: MarketplaceEntryV2): MarketplaceEntryV1 {
  const { category: _category, screenshots: _screenshots, ...v1Entry } = entry;
  return v1Entry;
}

/** Immutable compatibility projection consumed by released v1 clients. */
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

/** Discovery projection consumed by current clients. */
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

/** New clients seed from v2; v1 remains available only as a compatibility projection. */
export const BUNDLED_CURATED_MARKETPLACE = BUNDLED_CURATED_MARKETPLACE_V2;

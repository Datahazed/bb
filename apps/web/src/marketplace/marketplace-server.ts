import { createServerFn } from "@tanstack/react-start";

import { getEnv } from "../server/env.js";
import { serveMarketplaceObject } from "../server/marketplace.js";
import {
  parseMarketplaceV2Manifest,
  type MarketplaceV2Manifest,
} from "./marketplace-v2.js";
import {
  parseMarketplaceStats,
  type MarketplaceStats,
} from "./marketplace-stats.js";

export const MARKETPLACE_V2_MANIFEST_PATH = "/marketplace/v2/marketplace.json";
export const MARKETPLACE_STATS_PATH = "/marketplace/v1/stats.json";

export interface PublicMarketplaceData {
  manifest: MarketplaceV2Manifest;
  stats: MarketplaceStats | null;
}

/**
 * SSR and client navigation read the same public object the desktop client
 * consumes. The existing R2 proxy remains the only storage boundary; this
 * server function only makes the parsed result available to route loaders.
 */
export const getPublicMarketplace = createServerFn({ method: "GET" }).handler(
  async (): Promise<PublicMarketplaceData> => {
    const response = await serveMarketplaceObject({
      bucket: getEnv().MARKETPLACE,
      request: new Request(`https://getbb.app${MARKETPLACE_V2_MANIFEST_PATH}`),
    });
    if (!response.ok) {
      throw new Error(
        `Marketplace catalog is unavailable (${response.status} ${response.statusText})`,
      );
    }
    let json: unknown;
    try {
      json = await response.json();
    } catch (error) {
      throw new Error(
        `Marketplace catalog is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    const manifest = parseMarketplaceV2Manifest(json);

    const statsResponse = await serveMarketplaceObject({
      bucket: getEnv().MARKETPLACE,
      request: new Request(`https://getbb.app${MARKETPLACE_STATS_PATH}`),
    });
    if (!statsResponse.ok) return { manifest, stats: null };
    try {
      return {
        manifest,
        stats: parseMarketplaceStats(await statsResponse.json()),
      };
    } catch {
      // Counts are cosmetic. A missing or malformed sidecar must not hide the
      // otherwise-valid marketplace, matching the desktop server behavior.
      return { manifest, stats: null };
    }
  },
);

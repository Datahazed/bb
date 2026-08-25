import { createServerFn } from "@tanstack/react-start";

import { getEnv } from "../server/env.js";
import { serveMarketplaceObject } from "../server/marketplace.js";
import {
  parseMarketplaceV2Manifest,
  type MarketplaceV2Manifest,
} from "./marketplace-v2.js";

export const MARKETPLACE_V2_MANIFEST_PATH = "/marketplace/v2/marketplace.json";

/**
 * SSR and client navigation read the same public object the desktop client
 * consumes. The existing R2 proxy remains the only storage boundary; this
 * server function only makes the parsed result available to route loaders.
 */
export const getPublicMarketplace = createServerFn({ method: "GET" }).handler(
  async (): Promise<MarketplaceV2Manifest> => {
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
    return parseMarketplaceV2Manifest(json);
  },
);

/**
 * Provider registry.
 *
 * Exposes built-in provider metadata and rejects legacy adapter construction
 * for providers that now run through canonical drivers.
 */

import {
  isAcpProviderId,
  isAgentProviderId,
  listBuiltInAgentProviderInfos,
} from "@bb/agent-providers";
import type { ProviderInfo } from "@bb/domain";
import type {
  ProviderAdapter,
  ProviderAdapterFactoryOptions,
} from "./provider-adapter.js";

// ---------------------------------------------------------------------------
// Lookup
// ---------------------------------------------------------------------------

/**
 * Create a provider adapter by ID.
 *
 * Looks up built-in providers. Throws if the ID is not found.
 */
export function createProviderForId(
  providerId: string,
  options?: ProviderAdapterFactoryOptions,
): ProviderAdapter {
  if (options?.acpLaunchSpec && !isAcpProviderId(providerId)) {
    throw new Error(
      `ACP launch spec supplied for non-ACP provider "${providerId}".`,
    );
  }

  if (isAgentProviderId(providerId) || isAcpProviderId(providerId)) {
    throw new Error(
      `Provider "${providerId}" uses the canonical driver and has no legacy adapter.`,
    );
  }

  const allIds = listBuiltInAgentProviderInfos().map((provider) => provider.id);
  throw new Error(
    `Unsupported provider "${providerId}". Available providers: ${allIds.join(", ")}.`,
  );
}

/**
 * List info for all available built-in providers.
 */
export function listAvailableProviderInfos(): ProviderInfo[] {
  return listBuiltInAgentProviderInfos();
}

/**
 * Provider registry.
 *
 * Exposes built-in provider metadata. Provider implementations are launched
 * through canonical drivers rather than an in-process implementation registry.
 */

import { listBuiltInAgentProviderInfos } from "@bb/agent-providers";
import type { ProviderInfo } from "@bb/domain";

/**
 * List info for all available built-in providers.
 */
export function listAvailableProviderInfos(): ProviderInfo[] {
  return listBuiltInAgentProviderInfos();
}

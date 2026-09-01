import type { NormalizedPluginEnvironmentTarget } from "@get-bb/plugin-sdk/internal/host-policy";
import type { PluginHookInvocation } from "./plugin-hook-registry.js";

/** One plugin's registered environment target, with its owner. */
export interface PluginEnvironmentTargetRecord {
  pluginId: string;
  target: NormalizedPluginEnvironmentTarget;
}

/**
 * Everything the dispatch pipeline and the system route need from the plugin
 * service about environment targets. An interface plus a module-level bridge
 * rather than a direct import, for the same reason as
 * {@link import("./plugin-hook-registry.js").PluginHookProvider}: the dispatch
 * path is assembled long before the plugin service exists, and this is the
 * seam a test substitutes fake targets through.
 */
export interface PluginEnvironmentTargetProvider {
  listEnvironmentTargets(): PluginEnvironmentTargetRecord[];
  getEnvironmentTarget(
    pluginId: string,
    targetId: string,
  ): PluginEnvironmentTargetRecord | undefined;
  invokeTarget<T>(
    pluginId: string,
    label: string,
    run: () => Promise<T>,
  ): Promise<PluginHookInvocation<T>>;
  readonly decisionTimeoutMs: number;
}

let provider: PluginEnvironmentTargetProvider | undefined;

export function setPluginEnvironmentTargetProvider(
  next: PluginEnvironmentTargetProvider | undefined,
): void {
  provider = next;
}

export function pluginEnvironmentTargetProvider():
  | PluginEnvironmentTargetProvider
  | undefined {
  return provider;
}

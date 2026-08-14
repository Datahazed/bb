import {
  buildAcpProviderInfo,
  getAgentProviderServerCapabilities as getStaticProviderServerCapabilities,
  getSupportedPermissionModes as getStaticSupportedPermissionModes,
  isAcpProviderId,
  isAgentProviderId,
  listBuiltInAgentProviderInfos,
  supportsManualCompaction as staticSupportsManualCompaction,
  supportsNativeFork as staticSupportsNativeFork,
  type ProviderServerCapabilities,
} from "@bb/agent-providers";
import type {
  PermissionMode,
  ProviderComposerAction,
  ProviderInfo,
} from "@bb/domain";
import type { HostDaemonProviderDriverLaunchSpec } from "@bb/host-daemon-contract";
import type {
  PluginProviderContribution,
  PluginService,
} from "../plugins/plugin-service.js";

type ProviderContributionSource = Pick<
  PluginService,
  "listProviderContributions"
>;

let contributionSource: ProviderContributionSource | undefined;

export function setPluginProviderContributions(
  source: ProviderContributionSource | undefined,
): void {
  contributionSource = source;
}

export function listPluginProviderContributions(): PluginProviderContribution[] {
  return contributionSource?.listProviderContributions() ?? [];
}

export function findPluginProviderContribution(
  providerId: string,
): PluginProviderContribution | undefined {
  return listPluginProviderContributions().find(
    (contribution) => contribution.registration.providerId === providerId,
  );
}

function pluginProviderInfo(
  contribution: PluginProviderContribution,
): ProviderInfo {
  const registration = contribution.registration;
  return {
    id: registration.providerId,
    displayName: registration.displayName,
    logoUrl: contribution.logoUrl,
    capabilities: structuredClone(registration.capabilities),
    composerActions: structuredClone(registration.composerActions),
    available: true,
  };
}

export function listRegisteredProviderInfos(): ProviderInfo[] {
  return [
    ...listBuiltInAgentProviderInfos(),
    ...listPluginProviderContributions().map(pluginProviderInfo),
  ];
}

export function getRegisteredProviderInfo(
  providerId: string,
): ProviderInfo | null {
  const plugin = findPluginProviderContribution(providerId);
  if (plugin !== undefined) return pluginProviderInfo(plugin);
  if (isAgentProviderId(providerId)) {
    return (
      listBuiltInAgentProviderInfos().find(
        (provider) => provider.id === providerId,
      ) ?? null
    );
  }
  if (isAcpProviderId(providerId)) {
    return buildAcpProviderInfo({
      id: providerId,
      displayName: providerId,
      logoUrl: null,
    });
  }
  return null;
}

export function getRegisteredProviderDriverLaunchSpec(
  providerId: string,
): HostDaemonProviderDriverLaunchSpec | undefined {
  const contribution = findPluginProviderContribution(providerId);
  if (contribution === undefined) return undefined;
  return {
    artifact: structuredClone(contribution.artifact.descriptor),
    displayName: contribution.registration.displayName,
    capabilities: structuredClone(contribution.registration.capabilities),
    config: structuredClone(contribution.registration.execution.config),
    process: structuredClone(contribution.registration.execution.process),
  };
}

export function getRegisteredProviderServerCapabilities(
  providerId: string,
): ProviderServerCapabilities | null {
  const plugin = findPluginProviderContribution(providerId);
  if (plugin !== undefined) {
    return {
      supportsWorkflows:
        plugin.registration.productCapabilities.supportsWorkflows,
      supportsExecutionOverride:
        plugin.registration.productCapabilities.supportsExecutionOverride,
      backsHostDaemonAiServices: false,
      reasoningLevels: [...plugin.registration.reasoningLevels],
    };
  }
  return getStaticProviderServerCapabilities(providerId);
}

export function getRegisteredProviderPermissionModes(
  providerId: string,
): readonly PermissionMode[] | null {
  return (
    findPluginProviderContribution(providerId)?.registration.capabilities
      .supportedPermissionModes ?? getStaticSupportedPermissionModes(providerId)
  );
}

export function getRegisteredProviderComposerActions(
  providerId: string,
): ProviderComposerAction[] {
  return (
    findPluginProviderContribution(providerId)?.registration.composerActions ??
    getRegisteredProviderInfo(providerId)?.composerActions ??
    []
  ).map((action) => structuredClone(action));
}

export function registeredProviderSupportsNativeFork(
  providerId: string,
): boolean {
  return (
    findPluginProviderContribution(providerId)?.registration.capabilities
      .supportsFork ?? staticSupportsNativeFork(providerId)
  );
}

export function registeredProviderSupportsManualCompaction(
  providerId: string,
): boolean {
  return (
    findPluginProviderContribution(providerId)?.registration.productCapabilities
      .supportsManualCompaction ?? staticSupportsManualCompaction(providerId)
  );
}

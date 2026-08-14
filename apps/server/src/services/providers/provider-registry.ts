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
  "isBuiltin" | "listHostDriverArtifacts" | "listProviderContributions"
>;

const BUILTIN_PROVIDER_PLUGIN_BY_PROVIDER_ID = new Map([
  ["claude-code", "claude-code"],
  ["codex", "codex"],
  ["pi", "pi"],
]);

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

function isManagedByInstalledBuiltinProviderPlugin(
  providerId: string,
): boolean {
  const pluginId = isAcpProviderId(providerId)
    ? "acp"
    : BUILTIN_PROVIDER_PLUGIN_BY_PROVIDER_ID.get(providerId);
  return (
    pluginId !== undefined && contributionSource?.isBuiltin(pluginId) === true
  );
}

function findLoadedHostDriverArtifact(pluginId: string, driverId: string) {
  return contributionSource
    ?.listHostDriverArtifacts()
    .find(
      (artifact) =>
        artifact.descriptor.meta.pluginId === pluginId &&
        artifact.descriptor.meta.driverId === driverId,
    );
}

export function registeredProviderDriverIsEnabled(providerId: string): boolean {
  if (!isManagedByInstalledBuiltinProviderPlugin(providerId)) return true;
  if (isAcpProviderId(providerId)) {
    return findLoadedHostDriverArtifact("acp", "acp") !== undefined;
  }
  return findPluginProviderContribution(providerId) !== undefined;
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
  const pluginProviders = listPluginProviderContributions();
  const pluginProviderIds = new Set(
    pluginProviders.map((contribution) => contribution.registration.providerId),
  );
  return [
    ...listBuiltInAgentProviderInfos().filter(
      (provider) =>
        !pluginProviderIds.has(provider.id) &&
        registeredProviderDriverIsEnabled(provider.id),
    ),
    ...pluginProviders.map(pluginProviderInfo),
  ];
}

export function getRegisteredProviderInfo(
  providerId: string,
): ProviderInfo | null {
  const plugin = findPluginProviderContribution(providerId);
  if (plugin !== undefined) return pluginProviderInfo(plugin);
  if (
    isManagedByInstalledBuiltinProviderPlugin(providerId) &&
    !registeredProviderDriverIsEnabled(providerId)
  ) {
    return null;
  }
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
  if (contribution !== undefined) {
    return {
      artifact: structuredClone(contribution.artifact.descriptor),
      driverProviderId: contribution.registration.providerId,
      displayName: contribution.registration.displayName,
      capabilities: structuredClone(contribution.registration.capabilities),
      config: structuredClone(contribution.registration.execution.config),
      process: structuredClone(contribution.registration.execution.process),
    };
  }
  const builtinPluginId =
    BUILTIN_PROVIDER_PLUGIN_BY_PROVIDER_ID.get(providerId);
  if (
    builtinPluginId !== undefined &&
    contributionSource?.isBuiltin(builtinPluginId) === true
  ) {
    throw new Error(`${providerId} provider driver plugin is not running`);
  }
  if (!isAcpProviderId(providerId)) return undefined;
  const artifact = findLoadedHostDriverArtifact("acp", "acp");
  if (artifact === undefined) {
    if (contributionSource?.isBuiltin("acp") === true) {
      throw new Error("ACP provider driver plugin is not running");
    }
    return undefined;
  }
  const info = buildAcpProviderInfo({
    id: providerId,
    displayName: providerId,
    logoUrl: null,
  });
  return {
    artifact: structuredClone(artifact.descriptor),
    driverProviderId: "acp",
    displayName: info.displayName,
    capabilities: info.capabilities,
    config: {},
    process: { scope: "environment", multiplexSessions: true },
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
  if (
    isManagedByInstalledBuiltinProviderPlugin(providerId) &&
    !registeredProviderDriverIsEnabled(providerId)
  ) {
    return null;
  }
  return getStaticProviderServerCapabilities(providerId);
}

export function getRegisteredProviderPermissionModes(
  providerId: string,
): readonly PermissionMode[] | null {
  const plugin = findPluginProviderContribution(providerId);
  if (plugin !== undefined) {
    return plugin.registration.capabilities.supportedPermissionModes;
  }
  if (
    isManagedByInstalledBuiltinProviderPlugin(providerId) &&
    !registeredProviderDriverIsEnabled(providerId)
  ) {
    return null;
  }
  return getStaticSupportedPermissionModes(providerId);
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
  const plugin = findPluginProviderContribution(providerId);
  if (plugin !== undefined) {
    return plugin.registration.capabilities.supportsFork;
  }
  if (
    isManagedByInstalledBuiltinProviderPlugin(providerId) &&
    !registeredProviderDriverIsEnabled(providerId)
  ) {
    return false;
  }
  return staticSupportsNativeFork(providerId);
}

export function registeredProviderSupportsManualCompaction(
  providerId: string,
): boolean {
  const plugin = findPluginProviderContribution(providerId);
  if (plugin !== undefined) {
    return plugin.registration.productCapabilities.supportsManualCompaction;
  }
  if (
    isManagedByInstalledBuiltinProviderPlugin(providerId) &&
    !registeredProviderDriverIsEnabled(providerId)
  ) {
    return false;
  }
  return staticSupportsManualCompaction(providerId);
}

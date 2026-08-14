import {
  getBuiltInAgentProviderInfo,
  getBuiltInAgentProviderServerCapabilities,
  supportsManualCompaction,
} from "@bb/agent-providers";
import type { BbPluginApi } from "@bb/plugin-sdk";

export default function piProviderPlugin(bb: BbPluginApi): void {
  const providerId = "pi";
  const info = getBuiltInAgentProviderInfo(providerId);
  const serverCapabilities =
    getBuiltInAgentProviderServerCapabilities(providerId);
  bb.experimental_providers.register({
    id: "default",
    displayName: info.displayName,
    description: "Pi coding agent with multi-provider model support.",
    capabilities: info.capabilities,
    composerActions: info.composerActions,
    reasoningLevels: [...serverCapabilities.reasoningLevels],
    productCapabilities: {
      supportsWorkflows: serverCapabilities.supportsWorkflows,
      supportsExecutionOverride: serverCapabilities.supportsExecutionOverride,
      supportsManualCompaction: supportsManualCompaction(providerId),
    },
    execution: {
      kind: "host-driver",
      driverId: "pi",
      config: {},
      process: { scope: "environment", multiplexSessions: true },
    },
  });
}

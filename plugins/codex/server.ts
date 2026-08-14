import {
  getBuiltInAgentProviderInfo,
  getBuiltInAgentProviderServerCapabilities,
  supportsManualCompaction,
} from "@bb/agent-providers";
import type { BbPluginApi } from "@bb/plugin-sdk";

export default function codexProviderPlugin(bb: BbPluginApi): void {
  const providerId = "codex";
  const info = getBuiltInAgentProviderInfo(providerId);
  const serverCapabilities =
    getBuiltInAgentProviderServerCapabilities(providerId);
  bb.experimental_providers.register({
    id: "default",
    displayName: info.displayName,
    description: "OpenAI Codex coding agent.",
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
      driverId: "codex",
      config: {},
      process: { scope: "thread", multiplexSessions: false },
    },
  });
}

import type { BbPluginApi } from "@bb/plugin-sdk";

export default function codexProviderPlugin(bb: BbPluginApi): void {
  bb.experimental_providers.register({
    id: "default",
    displayName: "Codex",
    description: "OpenAI Codex coding agent.",
    capabilities: {
      supportsArchive: true,
      supportsRename: true,
      supportsServiceTier: true,
      supportsUserQuestion: false,
      supportsFork: true,
      supportedPermissionModes: ["accept-edits", "auto", "full"],
    },
    composerActions: [
      { kind: "skills", trigger: "/" },
      {
        kind: "plan",
        command: { trigger: "/", name: "plan", trailingText: " " },
      },
      {
        kind: "goal",
        command: { trigger: "/", name: "goal", trailingText: " " },
      },
    ],
    reasoningLevels: ["low", "medium", "high", "xhigh", "max", "ultra"],
    productCapabilities: {
      supportsWorkflows: false,
      supportsExecutionOverride: false,
      supportsManualCompaction: true,
    },
    execution: {
      kind: "host-driver",
      driverId: "codex",
      config: {},
      process: { scope: "thread", multiplexSessions: false },
    },
  });
}

import type { BbPluginApi } from "@bb/plugin-sdk";

export default function claudeCodeProviderPlugin(bb: BbPluginApi): void {
  bb.experimental_providers.register({
    id: "default",
    displayName: "Claude Code",
    description: "Anthropic Claude Code coding agent.",
    capabilities: {
      supportsArchive: false,
      supportsRename: false,
      supportsServiceTier: false,
      supportsUserQuestion: true,
      supportsFork: true,
      supportedPermissionModes: ["accept-edits", "auto", "full"],
    },
    composerActions: [
      { kind: "skills", trigger: "/" },
      {
        kind: "plan",
        command: { trigger: "/", name: "plan", trailingText: " " },
      },
    ],
    reasoningLevels: [
      "low",
      "medium",
      "high",
      "xhigh",
      "ultracode",
      "max",
    ],
    productCapabilities: {
      supportsWorkflows: true,
      supportsExecutionOverride: true,
      supportsManualCompaction: true,
    },
    execution: {
      kind: "host-driver",
      driverId: "claude-code",
      config: {},
      process: { scope: "environment", multiplexSessions: true },
    },
  });
}

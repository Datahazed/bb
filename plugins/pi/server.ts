import type { BbPluginApi } from "@bb/plugin-sdk";

export default function piProviderPlugin(bb: BbPluginApi): void {
  bb.experimental_providers.register({
    id: "default",
    displayName: "Pi",
    description: "Pi coding agent with multi-provider model support.",
    capabilities: {
      supportsArchive: false,
      supportsRename: false,
      supportsServiceTier: false,
      supportsUserQuestion: false,
      supportsFork: true,
      supportedPermissionModes: ["full"],
    },
    composerActions: [{ kind: "skills", trigger: "/" }],
    reasoningLevels: ["low", "medium", "high", "xhigh", "max"],
    productCapabilities: {
      supportsWorkflows: false,
      supportsExecutionOverride: false,
      supportsManualCompaction: true,
    },
    execution: {
      kind: "host-driver",
      driverId: "pi",
      config: {},
      process: { scope: "environment", multiplexSessions: true },
    },
  });
}

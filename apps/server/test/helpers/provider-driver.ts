import {
  PROVIDER_DRIVER_ARTIFACT_ENTRYPOINT,
  PROVIDER_DRIVER_ARTIFACT_FORMAT_VERSION,
  PROVIDER_DRIVER_PROTOCOL_VERSION,
} from "@bb/provider-driver-contract";
import { setPluginProviderContributions } from "../../src/services/providers/provider-registry.js";

function testArtifact(pluginId: string, driverId: string) {
  return {
    archivePath: `/tmp/${pluginId}-${driverId}.tgz`,
    sizeBytes: 1,
    descriptor: {
      digest: "a".repeat(64),
      meta: {
        artifactFormatVersion: PROVIDER_DRIVER_ARTIFACT_FORMAT_VERSION,
        pluginId,
        pluginVersion: "0.0.0-test",
        driverId,
        providerDriverProtocolVersion: PROVIDER_DRIVER_PROTOCOL_VERSION,
        runtime: "node22" as const,
        entrypoint: PROVIDER_DRIVER_ARTIFACT_ENTRYPOINT,
        builtWith: { bbVersion: "test" },
      },
    },
  };
}

export function useTestAcpProviderDriver(): void {
  const artifact = testArtifact("acp", "acp");
  setPluginProviderContributions({
    isBuiltin: (pluginId) => pluginId === "acp",
    listHostDriverArtifacts: () => [artifact],
    listProviderContributions: () => [],
  });
}

export function useTestClaudeCodeProviderDriver(): void {
  const artifact = testArtifact("claude-code", "claude-code");
  setPluginProviderContributions({
    isBuiltin: (pluginId) => pluginId === "claude-code",
    listHostDriverArtifacts: () => [artifact],
    listProviderContributions: () => [
      {
        pluginId: "claude-code",
        artifact,
        logoUrl: null,
        registration: {
          localId: "default",
          providerId: "claude-code",
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
        },
      },
    ],
  });
}

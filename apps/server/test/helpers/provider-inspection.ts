import {
  buildAcpProviderInfo,
  getBuiltInAgentProviderInfo,
  isAgentProviderId,
} from "@bb/agent-providers";
import type { ProviderCapabilities } from "@bb/domain";
import type { HostDaemonProviderInspection } from "@bb/host-daemon-contract";

export const READY_HOST_PROVIDER_INSPECTION = {
  readiness: { status: "ready" },
  capabilities: {
    multiplexSessions: true,
    supportedSessionOperations: ["fork", "rename", "archive", "compact"],
    supportedPermissionModes: ["accept-edits", "auto", "full"],
    supportsServiceTier: false,
    supportsSteering: true,
    supportsUserQuestions: true,
  },
  diagnostics: [],
} as const satisfies HostDaemonProviderInspection;

function inspectionCapabilities(
  capabilities: ProviderCapabilities,
): HostDaemonProviderInspection["capabilities"] {
  return {
    multiplexSessions: true,
    supportedSessionOperations: [
      ...(capabilities.supportsFork ? (["fork"] as const) : []),
      ...(capabilities.supportsRename ? (["rename"] as const) : []),
      ...(capabilities.supportsArchive ? (["archive"] as const) : []),
    ],
    supportedPermissionModes: [...capabilities.supportedPermissionModes],
    supportsServiceTier: capabilities.supportsServiceTier,
    supportsSteering: true,
    supportsUserQuestions: capabilities.supportsUserQuestion,
  };
}

export function readyHostProviderInspectionFor(
  providerId: string,
): HostDaemonProviderInspection {
  const provider = isAgentProviderId(providerId)
    ? getBuiltInAgentProviderInfo(providerId)
    : buildAcpProviderInfo({
        id: providerId,
        displayName: providerId,
        logoUrl: null,
      });
  return {
    readiness: { status: "ready" },
    capabilities: inspectionCapabilities(provider.capabilities),
    diagnostics: [],
  };
}

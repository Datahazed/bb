import type { ProviderDriverInspectResult } from "@bb/provider-driver-contract";

/** Canonical ready/empty inspection fixture for daemon runtime doubles. */
export function createReadyProviderInspection(
  overrides: Partial<
    Pick<ProviderDriverInspectResult, "models" | "selectedOnlyModels">
  > = {},
): ProviderDriverInspectResult {
  return {
    readiness: { status: "ready" },
    capabilities: {
      multiplexSessions: true,
      supportedSessionOperations: ["fork", "rename", "archive", "compact"],
      supportedPermissionModes: ["accept-edits", "auto", "full"],
      supportsServiceTier: false,
      supportsSteering: true,
      supportsUserQuestions: true,
    },
    models: overrides.models ?? [],
    selectedOnlyModels: overrides.selectedOnlyModels ?? [],
    diagnostics: [],
  };
}

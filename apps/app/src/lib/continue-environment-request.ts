import { buildThreadHandoffPromptDraft } from "@/lib/thread-handoff-request";

export const CONTINUE_ENVIRONMENT_LOCATION_STATE_KEY =
  "continueEnvironment" as const;

export interface ContinueEnvironmentSeed {
  branchName: string;
  hostId: string;
  mergeBaseBranch: string;
  projectId: string;
  sourceEnvironmentId: string;
  sourceThreadId: string;
  sourceThreadTitle: string;
}

export function buildContinueEnvironmentLocationState(
  seed: ContinueEnvironmentSeed,
): Record<string, unknown> {
  return {
    [CONTINUE_ENVIRONMENT_LOCATION_STATE_KEY]: seed,
    focusPrompt: true,
  };
}

export function buildContinueEnvironmentPromptDraft(
  seed: ContinueEnvironmentSeed,
) {
  return buildThreadHandoffPromptDraft({
    environmentId: null,
    projectId: seed.projectId,
    sourceThreadId: seed.sourceThreadId,
    sourceThreadTitle: seed.sourceThreadTitle,
  });
}

export function readContinueEnvironmentSeed(
  state: unknown,
): ContinueEnvironmentSeed | null {
  if (typeof state !== "object" || state === null) return null;
  const candidate = (state as Record<string, unknown>)[
    CONTINUE_ENVIRONMENT_LOCATION_STATE_KEY
  ];
  if (typeof candidate !== "object" || candidate === null) return null;
  const value = candidate as Record<string, unknown>;
  if (
    typeof value.branchName !== "string" ||
    value.branchName.length === 0 ||
    typeof value.hostId !== "string" ||
    value.hostId.length === 0 ||
    typeof value.mergeBaseBranch !== "string" ||
    value.mergeBaseBranch.length === 0 ||
    typeof value.projectId !== "string" ||
    value.projectId.length === 0 ||
    typeof value.sourceEnvironmentId !== "string" ||
    value.sourceEnvironmentId.length === 0 ||
    typeof value.sourceThreadId !== "string" ||
    value.sourceThreadId.length === 0 ||
    typeof value.sourceThreadTitle !== "string" ||
    value.sourceThreadTitle.trim().length === 0
  ) {
    return null;
  }
  return {
    branchName: value.branchName,
    hostId: value.hostId,
    mergeBaseBranch: value.mergeBaseBranch,
    projectId: value.projectId,
    sourceEnvironmentId: value.sourceEnvironmentId,
    sourceThreadId: value.sourceThreadId,
    sourceThreadTitle: value.sourceThreadTitle.trim(),
  };
}

import type { Environment } from "@bb/domain";
import type { CreateThreadEnvironmentArgs } from "@bb/server-contract";
import {
  encodeHostValue,
  encodeReuseValue,
} from "@/components/pickers/environment-picker-value";
import type { RootComposeSelectedBranch } from "@/views/root-compose-thread-environment";

/**
 * Picker seed derived from a previously submitted environment: the encoded
 * environment-picker selection plus the branch pick that reproduces it. The
 * inverse of `resolveRootComposeThreadEnvironment`, up to the limits listed
 * on `NewThreadComposerProps.defaultEnvironment`.
 */
export interface NewThreadEnvironmentSeed {
  selectionValue: string;
  branch: RootComposeSelectedBranch | null;
}

type ContinuationSourceEnvironment = Pick<
  Environment,
  | "branchName"
  | "hostId"
  | "id"
  | "projectId"
  | "status"
  | "workspaceProvisionType"
>;

interface NewThreadEnvironmentSeedContext {
  projectId: string;
  continuationSourceEnvironment?: ContinuationSourceEnvironment;
}

/**
 * Maps `NewThreadRequest.environment` back to picker selections. Returns null
 * for the variants the composer cannot represent — `project-default` (the
 * composer always resolves a concrete environment) and a `personal` workspace
 * without a `hostId` (the picker only encodes concrete hosts) — so the
 * composer falls back to its own environment default. A continuation needs
 * its archived environment resolved through `context` because the request
 * itself contains only that environment's ID.
 */
export function newThreadEnvironmentArgsToSeed(
  environment: CreateThreadEnvironmentArgs,
  context?: NewThreadEnvironmentSeedContext,
): NewThreadEnvironmentSeed | null {
  if (environment.type === "project-default") {
    return null;
  }
  if (environment.type === "continue") {
    const source = context?.continuationSourceEnvironment;
    if (
      context === undefined ||
      source === undefined ||
      source.id !== environment.sourceEnvironmentId ||
      source.projectId !== context.projectId ||
      source.status !== "destroyed" ||
      source.workspaceProvisionType !== "managed-worktree" ||
      source.branchName === null
    ) {
      return null;
    }
    return {
      selectionValue: encodeHostValue(source.hostId, "worktree"),
      branch: {
        name: source.branchName,
        isNew: false,
        continueFromEnvironmentId: source.id,
      },
    };
  }
  if (environment.type === "reuse") {
    return {
      selectionValue: encodeReuseValue(environment.environmentId),
      branch: null,
    };
  }
  const { hostId, workspace } = environment;
  if (hostId === undefined) {
    return null;
  }
  if (workspace.type === "personal") {
    return { selectionValue: encodeHostValue(hostId, "local"), branch: null };
  }
  if (workspace.type === "managed-worktree") {
    return {
      selectionValue: encodeHostValue(hostId, "worktree"),
      branch:
        workspace.baseBranch.kind === "named"
          ? { name: workspace.baseBranch.name, isNew: false }
          : null,
    };
  }
  // Unmanaged. `path` has no picker control — the composer always submits
  // `path: null` — so it is not represented here.
  return {
    selectionValue: encodeHostValue(hostId, "local"),
    branch:
      workspace.branch === undefined
        ? null
        : workspace.branch.kind === "existing"
          ? { name: workspace.branch.name, isNew: false }
          : { name: workspace.branch.baseBranch, isNew: true },
  };
}

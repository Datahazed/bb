import type { JsonValue } from "@bb/domain";
import type { CreateThreadEnvironmentArgs } from "@bb/server-contract";
import {
  encodeHostValue,
  encodeReuseValue,
  encodeTargetValue,
  isWorktreeEnvironmentTarget,
} from "@/components/pickers/environment-picker-value";
import type { RootComposeSelectedBranch } from "@/views/root-compose-thread-environment";

interface NewThreadEnvironmentSeed {
  selectionValue: string;
  branch: RootComposeSelectedBranch | null;
  targetConfiguration?: JsonValue;
}

function readWorktreeTargetBranch(
  configuration: JsonValue,
): RootComposeSelectedBranch | null {
  if (
    typeof configuration !== "object" ||
    configuration === null ||
    Array.isArray(configuration)
  ) {
    return null;
  }
  const baseBranch = configuration.baseBranch;
  if (
    typeof baseBranch !== "object" ||
    baseBranch === null ||
    Array.isArray(baseBranch)
  ) {
    return null;
  }
  return baseBranch.kind === "named" && typeof baseBranch.name === "string"
    ? { name: baseBranch.name, isNew: false }
    : null;
}

export function newThreadEnvironmentArgsToSeed(
  environment: CreateThreadEnvironmentArgs,
): NewThreadEnvironmentSeed | null {
  if (environment.type === "project-default") {
    return null;
  }
  if (environment.type === "plugin-target") {
    return {
      selectionValue: encodeTargetValue(
        environment.pluginId,
        environment.targetId,
      ),
      branch: isWorktreeEnvironmentTarget(environment)
        ? readWorktreeTargetBranch(environment.configuration)
        : null,
      targetConfiguration: environment.configuration,
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

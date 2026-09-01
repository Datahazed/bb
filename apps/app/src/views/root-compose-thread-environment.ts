import { PERSONAL_PROJECT_ID, type JsonValue } from "@bb/domain";
import type {
  BaseBranchSpec,
  CreateThreadRequest,
  SystemEnvironmentTarget,
} from "@bb/server-contract";
import {
  isWorktreeEnvironmentTarget,
  parseEnvironmentValue,
} from "@/components/pickers/environment-picker-value";

export interface RootComposeSelectedBranch {
  name: string;
  isNew: boolean;
}

interface ResolveRootComposeThreadEnvironmentArgs {
  defaultBranch: string | null | undefined;
  defaultWorktreeBaseBranch: string | null | undefined;
  environmentValue: string;
  projectId: string | undefined;
  selectedBranch: RootComposeSelectedBranch | null;
  environmentTargets?: readonly SystemEnvironmentTarget[];
  targetHostId?: string | null;
  targetConfiguration?: JsonValue;
}

function isJsonObject(
  value: JsonValue,
): value is { [key: string]: JsonValue } {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function prefillEnvironmentTargetConfiguration(
  target: SystemEnvironmentTarget,
  hostId: string | null,
): JsonValue {
  if (!target.hostScoped) return target.defaultConfiguration;
  const base = isJsonObject(target.defaultConfiguration)
    ? target.defaultConfiguration
    : {};
  return hostId === null ? base : { ...base, hostId };
}

export function readEnvironmentTargetConfigurationHostId(
  configuration: JsonValue,
): string | null {
  if (!isJsonObject(configuration)) return null;
  const hostId = configuration.hostId;
  return typeof hostId === "string" && hostId.length > 0 ? hostId : null;
}

type ResolveManagedBaseBranchArgs = Pick<
  ResolveRootComposeThreadEnvironmentArgs,
  "defaultBranch" | "defaultWorktreeBaseBranch" | "selectedBranch"
>;

function resolveManagedBaseBranch(
  args: ResolveManagedBaseBranchArgs,
): BaseBranchSpec {
  const branchName =
    args.selectedBranch?.name ??
    args.defaultWorktreeBaseBranch ??
    args.defaultBranch;

  return branchName ? { kind: "named", name: branchName } : { kind: "default" };
}

export function resolveRootComposeThreadEnvironment(
  args: ResolveRootComposeThreadEnvironmentArgs,
): CreateThreadRequest["environment"] | null {
  if (!args.projectId) return null;
  const parsed = parseEnvironmentValue(args.environmentValue);
  if (!parsed) return null;

  if (parsed.type === "target") {
    const target = args.environmentTargets?.find(
      (candidate) =>
        candidate.pluginId === parsed.pluginId &&
        candidate.targetId === parsed.targetId,
    );
    if (target === undefined) return null;
    if (target.hostScoped && isWorktreeEnvironmentTarget(target)) {
      const hostId = args.targetHostId ?? null;
      if (hostId === null) return null;
      return {
        type: "plugin-target",
        pluginId: target.pluginId,
        targetId: target.targetId,
        configuration: {
          hostId,
          baseBranch: resolveManagedBaseBranch(args),
        },
      };
    }
    if (args.targetConfiguration === undefined) return null;
    return {
      type: "plugin-target",
      pluginId: target.pluginId,
      targetId: target.targetId,
      configuration: args.targetConfiguration,
    };
  }

  if (parsed.type === "reuse") {
    if (parsed.environmentId === null) return null;
    return { type: "reuse", environmentId: parsed.environmentId };
  }

  if (parsed.type === "host") {
    if (args.projectId === PERSONAL_PROJECT_ID) {
      return {
        type: "host",
        hostId: parsed.hostId,
        workspace: { type: "personal" },
      };
    }

    if (parsed.mode === "worktree") {
      return {
        type: "host",
        hostId: parsed.hostId,
        workspace: {
          type: "managed-worktree",
          baseBranch: resolveManagedBaseBranch(args),
        },
      };
    }

    if (args.selectedBranch?.isNew) {
      return {
        type: "host",
        hostId: parsed.hostId,
        workspace: {
          type: "unmanaged",
          path: null,
          branch: {
            kind: "new",
            baseBranch: args.selectedBranch.name,
          },
        },
      };
    }

    return {
      type: "host",
      hostId: parsed.hostId,
      workspace: {
        type: "unmanaged",
        path: null,
        ...(args.selectedBranch
          ? {
              branch: {
                kind: "existing",
                name: args.selectedBranch.name,
              },
            }
          : {}),
      },
    };
  }

  return null;
}

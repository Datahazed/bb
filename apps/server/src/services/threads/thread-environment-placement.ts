import { findProjectEnvironmentByHostPath, getEnvironment } from "@bb/db";
import type { JsonValue } from "@bb/domain";
import { z } from "zod";
import type {
  BaseBranchSpec,
  CreateThreadEnvironmentArgs,
  PluginTargetEnvironmentArgs,
  UnmanagedBranchSpec,
} from "@bb/server-contract";
import type { LoggedPendingInteractionWorkSessionDeps } from "../../types.js";
import { COMMAND_TIMEOUT_MS } from "../../constants.js";
import { ApiError } from "../../errors.js";
import { unmanagedAttachRefusal } from "./workspace-path-claims.js";
import { ensureHostSessionReadyForWork } from "../hosts/host-lifecycle.js";
import { callHostRetryableOnlineRpc } from "../hosts/online-rpc.js";
import { requireNonDestroyedHostWithStatus } from "../lib/entity-lookup.js";
import { runtimeErrorLogFields } from "../lib/error-log-fields.js";
import { throwEnvironmentNotReady } from "../lib/lifecycle-api-errors.js";
import { applyLoggedEnvironmentLifecycleEvent } from "../environments/lifecycle-outcome.js";
import { resolveManagedDefaultBaseBranchSpec } from "../projects/worktree-base-branch.js";
import { resolveProjectDefaultThreadEnvironment } from "./thread-default-policy.js";
import { resolveStableThreadRequestEnvironment } from "./thread-request-eligibility.js";
import type { ThreadProvisionEnvironmentIntent } from "./thread-provisioning-context.js";

type PlacementDeps = LoggedPendingInteractionWorkSessionDeps;

export const WORKTREE_TARGET_PLUGIN_ID = "worktree";
export const WORKTREE_TARGET_ID = "worktree";

/**
 * The cutover shim: a managed-worktree request becomes a worktree-target
 * selection at the boundary, so the worktree plugin is the only producer of
 * worktrees no matter which surface asked — the picker, root-compose
 * defaults, parent inheritance, `--new-environment worktree`, or a stored
 * automation request from before the cutover. Core's managed provisioning
 * has no producers left behind this line.
 */
export function rewriteManagedWorktreeEnvironment<
  T extends CreateThreadEnvironmentArgs,
>(environment: T): T | PluginTargetEnvironmentArgs {
  if (
    environment.type !== "host" ||
    environment.workspace.type !== "managed-worktree" ||
    environment.hostId === undefined
  ) {
    return environment;
  }
  return {
    type: "plugin-target",
    pluginId: WORKTREE_TARGET_PLUGIN_ID,
    targetId: WORKTREE_TARGET_ID,
    configuration: {
      hostId: environment.hostId,
      baseBranch: environment.workspace.baseBranch,
    },
  };
}

/**
 * The same shim for start contexts persisted before the cutover: a pending
 * thread created last week with a `direct-managed` intent re-attempts
 * against the plugin instead of the deleted core path. In-memory only — a
 * `ready` answer persists the resolved intent through the normal write.
 */
export function rewriteLegacyManagedStartIntent(
  intent: ThreadProvisionEnvironmentIntent,
): ThreadProvisionEnvironmentIntent {
  if (intent.type !== "direct-managed") {
    return intent;
  }
  return {
    type: "plugin-target",
    pluginId: WORKTREE_TARGET_PLUGIN_ID,
    targetId: WORKTREE_TARGET_ID,
    configuration: {
      hostId: intent.hostId,
      baseBranch: intent.baseBranch,
    },
  };
}

export interface ThreadEnvironmentPlacement {
  environmentId: string | null;
  environmentIntent: ThreadProvisionEnvironmentIntent;
}

/**
 * The machine a `plugin-target` selection names, when it names one at all: a
 * host-scoped target's picker pre-fills `configuration.hostId`, and reading it
 * back here — the one loose parse of an otherwise opaque configuration — is
 * what keeps a cold worktree start counted against its machine's pool and its
 * model catalog reachable. A target that makes its own machine has no
 * `hostId` and resolves to null.
 */
export function pluginTargetIntentHostId(configuration: JsonValue): string | null {
  const parsed = z
    .object({ hostId: z.string().min(1) })
    .passthrough()
    .safeParse(configuration);
  return parsed.success ? parsed.data.hostId : null;
}

interface ResolveManagedBaseBranchArgs {
  baseBranch: BaseBranchSpec;
  hostId: string;
  sourcePath: string;
}

async function resolveManagedBaseBranch(
  deps: PlacementDeps,
  args: ResolveManagedBaseBranchArgs,
): Promise<BaseBranchSpec> {
  if (args.baseBranch.kind === "named") {
    return args.baseBranch;
  }

  try {
    const result = await callHostRetryableOnlineRpc(deps, {
      hostId: args.hostId,
      timeoutMs: COMMAND_TIMEOUT_MS,
      command: {
        type: "host.inspect_git_source",
        path: args.sourcePath,
        remoteRefresh: "background",
      },
    });
    return resolveManagedDefaultBaseBranchSpec(result);
  } catch (error) {
    deps.logger.warn(
      {
        hostId: args.hostId,
        sourcePath: args.sourcePath,
        ...runtimeErrorLogFields(deps.config, error),
      },
      "Failed to resolve smart worktree base branch; using requested base",
    );
    return args.baseBranch;
  }
}

interface AssertUnmanagedHostPathIsAttachableArgs {
  branch: UnmanagedBranchSpec | undefined;
  dataDir: string;
  hostId: string;
  path: string;
  projectId: string;
}

function assertUnmanagedHostPathIsAttachable(
  deps: PlacementDeps,
  args: AssertUnmanagedHostPathIsAttachableArgs,
): void {
  const refusal = unmanagedAttachRefusal(deps.db, {
    checksOutBranch: args.branch !== undefined,
    dataDir: args.dataDir,
    hostId: args.hostId,
    path: args.path,
    projectId: args.projectId,
  });
  if (refusal) {
    throw new ApiError(409, "invalid_request", refusal.message);
  }
}

interface ExistingUnmanagedEnvironmentIntentByHostPathArgs {
  branch: UnmanagedBranchSpec | undefined;
  hostId: string;
  path: string;
  projectId: string;
}

interface ExistingUnmanagedEnvironmentIntentResult {
  environmentId: string;
  intent:
    | Extract<ThreadProvisionEnvironmentIntent, { type: "reuse" }>
    | Extract<ThreadProvisionEnvironmentIntent, { type: "checkout-unmanaged" }>;
}

function existingUnmanagedEnvironmentIntentByHostPath(
  deps: PlacementDeps,
  args: ExistingUnmanagedEnvironmentIntentByHostPathArgs,
): ExistingUnmanagedEnvironmentIntentResult | null {
  const existing = findProjectEnvironmentByHostPath(
    deps.db,
    args.projectId,
    args.hostId,
    args.path,
  );
  if (!existing) {
    return null;
  }

  if (!args.branch) {
    if (existing.status === "ready" || existing.status === "provisioning") {
      return {
        environmentId: existing.id,
        intent: {
          type: "reuse",
          environmentId: existing.id,
        },
      };
    }

    throw new ApiError(
      409,
      "invalid_request",
      `Workspace path is already attached to an environment in ${existing.status} state`,
    );
  }

  if (existing.status !== "ready" || !existing.path) {
    throw new ApiError(
      409,
      "invalid_request",
      `Cannot checkout branch while the workspace environment is in ${existing.status} state`,
    );
  }

  return {
    environmentId: existing.id,
    intent: {
      type: "checkout-unmanaged",
      environmentId: existing.id,
      hostId: args.hostId,
      path: args.path,
      branch: args.branch,
    },
  };
}

export interface ResolveThreadEnvironmentPlacementArgs {
  allowUnmanagedPersonalProjectReuseEnvironmentId?: string;
  projectId: string;
  requestedEnvironment: CreateThreadEnvironmentArgs;
}

/**
 * Resolves where a thread will run: the workspace-path claim checks, the
 * existing-unmanaged-environment reuse, and the managed base branch, in one
 * place so there is one policy. Creation calls it with whatever the request
 * carried; a plugin target's `ready` decision calls it with the environment
 * the plugin returned, so both producers of an intent go through the same
 * checks.
 */
export async function resolveThreadEnvironmentPlacement(
  deps: PlacementDeps,
  args: ResolveThreadEnvironmentPlacementArgs,
): Promise<ThreadEnvironmentPlacement> {
  if (args.requestedEnvironment.type === "plugin-target") {
    return {
      environmentId: null,
      environmentIntent: {
        type: "plugin-target",
        pluginId: args.requestedEnvironment.pluginId,
        targetId: args.requestedEnvironment.targetId,
        configuration: args.requestedEnvironment.configuration,
      },
    };
  }
  const resolvedEnvironment = resolveStableThreadRequestEnvironment(deps, {
    ...(args.allowUnmanagedPersonalProjectReuseEnvironmentId !== undefined
      ? {
          allowUnmanagedPersonalProjectReuseEnvironmentId:
            args.allowUnmanagedPersonalProjectReuseEnvironmentId,
        }
      : {}),
    environment:
      args.requestedEnvironment.type === "project-default"
        ? await resolveProjectDefaultThreadEnvironment(deps, {
            projectId: args.projectId,
          })
        : args.requestedEnvironment,
    projectId: args.projectId,
  });
  let environmentId: string | null = null;
  let environmentIntent: ThreadProvisionEnvironmentIntent;
  switch (resolvedEnvironment.type) {
    case "reuse": {
      let environment = resolvedEnvironment.environment;
      if (environment.status === "retiring") {
        applyLoggedEnvironmentLifecycleEvent(deps, {
          environmentId: environment.id,
          event: { type: "retire.cancelled" },
        });
        environment = getEnvironment(deps.db, environment.id) ?? environment;
      }
      if (
        environment.status !== "ready" &&
        environment.status !== "provisioning"
      ) {
        throwEnvironmentNotReady(environment);
      }
      if (environment.status === "ready" && !environment.path) {
        throwEnvironmentNotReady(environment);
      }
      if (environment.status === "provisioning") {
        requireNonDestroyedHostWithStatus(deps, environment.hostId);
      }
      environmentId = environment.id;
      environmentIntent = {
        type: "reuse",
        environmentId: environment.id,
      };
      break;
    }
    case "host": {
      const hostId = resolvedEnvironment.hostId;
      const workspace = resolvedEnvironment.workspace;
      if (workspace.type === "unmanaged") {
        if (resolvedEnvironment.unmanagedPath === null) {
          throw new Error(
            "Validated unmanaged host request is missing a workspace path",
          );
        }
        const dataDir = (
          await ensureHostSessionReadyForWork(deps, { hostId })
        ).dataDir;
        assertUnmanagedHostPathIsAttachable(deps, {
          branch: workspace.branch,
          dataDir,
          hostId,
          path: resolvedEnvironment.unmanagedPath,
          projectId: args.projectId,
        });
        const existingIntent = existingUnmanagedEnvironmentIntentByHostPath(
          deps,
          {
            branch: workspace.branch,
            hostId,
            path: resolvedEnvironment.unmanagedPath,
            projectId: args.projectId,
          },
        );
        environmentIntent = existingIntent?.intent ?? {
          type: "direct-unmanaged",
          hostId,
          path: resolvedEnvironment.unmanagedPath,
          ...(workspace.branch ? { branch: workspace.branch } : {}),
        };
        if (existingIntent) {
          environmentId = existingIntent.environmentId;
        }
        break;
      }

      const managedSource = resolvedEnvironment.localSource;
      if (!managedSource) {
        throw new Error(
          "Validated managed host request is missing a local source",
        );
      }
      environmentIntent = {
        type: "direct-managed",
        hostId,
        sourcePath: managedSource.path,
        baseBranch: await resolveManagedBaseBranch(deps, {
          baseBranch: workspace.baseBranch,
          hostId,
          sourcePath: managedSource.path,
        }),
        workspaceProvisionType: workspace.type,
      };
      break;
    }
    case "personal": {
      environmentIntent = {
        type: "direct-personal",
        hostId: resolvedEnvironment.hostId,
        workspaceProvisionType: "personal",
      };
      break;
    }
  }
  return { environmentId, environmentIntent };
}

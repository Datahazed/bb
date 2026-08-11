import {
  getEnvironment,
  getProjectSourceByHost,
  hasRevivableArchivedThreadInEnvironment,
} from "@bb/db";
import {
  type Environment,
  type LocalPathProjectSource,
  PERSONAL_PROJECT_ID,
  resolveEnvironmentMergeBaseBranch,
} from "@bb/domain";
import type { CreateThreadEnvironmentArgs } from "@bb/server-contract";
import { ApiError } from "../../errors.js";
import type { AppDeps } from "../../types.js";
import { requireEnvironment } from "../lib/entity-lookup.js";
import {
  assertUsableHostId,
  requireConnectedPrimaryHostId,
} from "../hosts/primary-host.js";

type ThreadRequestEnvironment = Exclude<
  CreateThreadEnvironmentArgs,
  { type: "project-default" }
>;
type ThreadRequestEnvironmentDeps = Pick<AppDeps, "config" | "db" | "hub">;
type HostThreadRequestEnvironment = Extract<
  ThreadRequestEnvironment,
  { type: "host" }
>;
type WorkspaceBackedHostWorkspace = Exclude<
  HostThreadRequestEnvironment["workspace"],
  { type: "personal" }
>;
type ReuseThreadRequestEnvironment = Extract<
  ThreadRequestEnvironment,
  { type: "reuse" }
>;
type ContinueThreadRequestEnvironment = Extract<
  ThreadRequestEnvironment,
  { type: "continue" }
>;
export interface ResolveStableThreadRequestEnvironmentArgs {
  /**
   * A directory switch can leave a personal-project source thread attached to
   * an unmanaged environment. Source-derived forks may reuse that exact
   * environment, but a new root thread must still use a personal workspace.
   */
  allowUnmanagedPersonalProjectReuseEnvironmentId?: string;
  environment: ThreadRequestEnvironment;
  projectId: string;
}

export interface ResolvedHostThreadRequestEnvironment {
  hostId: string;
  localSource: LocalPathProjectSource | null;
  type: "host";
  unmanagedPath: string | null;
  workspace: WorkspaceBackedHostWorkspace;
}

export interface ResolvedReuseThreadRequestEnvironment {
  environment: Environment;
  type: "reuse";
}

export interface ResolvedPersonalThreadRequestEnvironment {
  hostId: string | null;
  type: "personal";
}

export interface ResolvedContinueThreadRequestEnvironment {
  branchName: string;
  environment: Environment;
  hostId: string;
  localSource: LocalPathProjectSource;
  mergeBaseBranch: string;
  type: "continue";
}

export type ResolvedStableThreadRequestEnvironment =
  | ResolvedHostThreadRequestEnvironment
  | ResolvedContinueThreadRequestEnvironment
  | ResolvedPersonalThreadRequestEnvironment
  | ResolvedReuseThreadRequestEnvironment;

function requireHostEnvironmentId(
  environment: HostThreadRequestEnvironment,
): string {
  if (environment.hostId !== undefined) {
    return environment.hostId;
  }
  throw new ApiError(
    400,
    "invalid_request",
    "hostId is required for workspace-backed thread creation",
  );
}

function resolveContinueThreadRequestEnvironment(
  deps: ThreadRequestEnvironmentDeps,
  environment: ContinueThreadRequestEnvironment,
  projectId: string,
): ResolvedContinueThreadRequestEnvironment {
  if (projectId === PERSONAL_PROJECT_ID) {
    throw new ApiError(
      409,
      "invalid_request",
      "Personal project threads cannot continue archived managed worktrees",
    );
  }
  const sourceEnvironment = getEnvironment(
    deps.db,
    environment.sourceEnvironmentId,
  );
  if (!sourceEnvironment) {
    throw new ApiError(404, "environment_not_found", "Environment not found");
  }
  if (sourceEnvironment.projectId !== projectId) {
    throw new ApiError(
      409,
      "invalid_request",
      "Environment belongs to a different project",
    );
  }
  if (
    sourceEnvironment.status !== "destroyed" ||
    sourceEnvironment.workspaceProvisionType !== "managed-worktree" ||
    sourceEnvironment.branchName === null ||
    !hasRevivableArchivedThreadInEnvironment(deps.db, {
      environmentId: sourceEnvironment.id,
    })
  ) {
    throw new ApiError(
      409,
      "invalid_request",
      "Only archived managed worktrees with a branch can be continued",
    );
  }
  const mergeBaseBranch = resolveEnvironmentMergeBaseBranch(sourceEnvironment);
  if (mergeBaseBranch === undefined) {
    throw new ApiError(
      409,
      "invalid_request",
      "Archived environment has no merge base branch to preserve",
    );
  }
  assertUsableHostId(deps, { hostId: sourceEnvironment.hostId });
  const localSource = getProjectSourceByHost(
    deps.db,
    projectId,
    sourceEnvironment.hostId,
  );
  if (!localSource || localSource.type !== "local_path") {
    throw new ApiError(
      409,
      "invalid_request",
      "No project source configured for the archived environment's host",
    );
  }
  if (sourceEnvironment.managedSourcePath !== localSource.path) {
    throw new ApiError(
      409,
      "invalid_request",
      "Archived environment belongs to a different project source checkout",
    );
  }
  return {
    branchName: sourceEnvironment.branchName,
    environment: sourceEnvironment,
    hostId: sourceEnvironment.hostId,
    localSource,
    mergeBaseBranch,
    type: "continue",
  };
}

function assertPersonalWorkspaceProjectCompatibility(projectId: string): void {
  if (projectId !== PERSONAL_PROJECT_ID) {
    throw new ApiError(
      400,
      "invalid_request",
      "Personal workspaces are only supported for the personal project",
    );
  }
}

function assertReuseWorkspaceProjectCompatibility(
  projectId: string,
  environment: Environment,
  allowUnmanagedPersonalProjectReuseEnvironmentId: string | undefined,
): void {
  const projectIsPersonal = projectId === PERSONAL_PROJECT_ID;
  const environmentIsPersonal =
    environment.workspaceProvisionType === "personal";
  const environmentIsUnmanaged =
    environment.workspaceProvisionType === "unmanaged";
  if (
    projectIsPersonal &&
    !environmentIsPersonal &&
    !(
      environmentIsUnmanaged &&
      allowUnmanagedPersonalProjectReuseEnvironmentId === environment.id
    )
  ) {
    throw new ApiError(
      409,
      "invalid_request",
      "Personal project threads must reuse a personal workspace",
    );
  }
  if (!projectIsPersonal && environmentIsPersonal) {
    throw new ApiError(
      409,
      "invalid_request",
      "Standard project threads cannot reuse personal workspaces",
    );
  }
}

function resolveHostThreadRequestEnvironment(
  deps: ThreadRequestEnvironmentDeps,
  environment: HostThreadRequestEnvironment,
  projectId: string,
):
  | ResolvedHostThreadRequestEnvironment
  | ResolvedPersonalThreadRequestEnvironment {
  if (environment.workspace.type === "personal") {
    assertPersonalWorkspaceProjectCompatibility(projectId);
    const hostId = environment.hostId ?? requireConnectedPrimaryHostId(deps);
    assertUsableHostId(deps, { hostId });
    return {
      hostId,
      type: "personal",
    };
  }

  const hostId = requireHostEnvironmentId(environment);
  assertUsableHostId(deps, { hostId });

  if (
    environment.workspace.type === "unmanaged" &&
    environment.workspace.path !== null
  ) {
    return {
      hostId,
      localSource: null,
      type: "host",
      unmanagedPath: environment.workspace.path,
      workspace: environment.workspace,
    };
  }

  const localSource = getProjectSourceByHost(deps.db, projectId, hostId);
  if (!localSource || localSource.type !== "local_path") {
    throw new ApiError(
      409,
      "invalid_request",
      "No project source configured for this host",
    );
  }

  return {
    hostId,
    localSource,
    type: "host",
    unmanagedPath:
      environment.workspace.type === "unmanaged" ? localSource.path : null,
    workspace: environment.workspace,
  };
}

function resolveReuseThreadRequestEnvironment(
  deps: ThreadRequestEnvironmentDeps,
  environment: ReuseThreadRequestEnvironment,
  projectId: string,
  allowUnmanagedPersonalProjectReuseEnvironmentId: string | undefined,
): ResolvedReuseThreadRequestEnvironment {
  const reusedEnvironment = requireEnvironment(
    deps.db,
    environment.environmentId,
  );
  if (reusedEnvironment.projectId !== projectId) {
    throw new ApiError(
      409,
      "invalid_request",
      "Environment belongs to a different project",
    );
  }
  assertReuseWorkspaceProjectCompatibility(
    projectId,
    reusedEnvironment,
    allowUnmanagedPersonalProjectReuseEnvironmentId,
  );
  assertUsableHostId(deps, { hostId: reusedEnvironment.hostId });
  return {
    environment: reusedEnvironment,
    type: "reuse",
  };
}

export function resolveStableThreadRequestEnvironment(
  deps: ThreadRequestEnvironmentDeps,
  args: ResolveStableThreadRequestEnvironmentArgs,
): ResolvedStableThreadRequestEnvironment {
  switch (args.environment.type) {
    case "continue":
      return resolveContinueThreadRequestEnvironment(
        deps,
        args.environment,
        args.projectId,
      );
    case "host":
      return resolveHostThreadRequestEnvironment(
        deps,
        args.environment,
        args.projectId,
      );
    case "reuse":
      return resolveReuseThreadRequestEnvironment(
        deps,
        args.environment,
        args.projectId,
        args.allowUnmanagedPersonalProjectReuseEnvironmentId,
      );
    default: {
      const exhaustiveCheck: never = args.environment;
      throw new Error(
        `Unsupported thread request environment: ${exhaustiveCheck}`,
      );
    }
  }
}

import {
  getActiveSession,
  getEnvironment,
  getHost,
  getNonDestroyedHost,
  getProject,
  getProjectOperation,
  getThread,
  listHostThreadIds as listHostThreadIdsFromDb,
} from "@bb/db";
import type { Environment, Host, Project } from "@bb/domain";
import type { DbConnection } from "@bb/db";
import { ApiError } from "../../errors.js";
import {
  destroyedHostUnavailableDetails,
  destroyedThreadEnvironmentDetails,
  disconnectedHostUnavailableDetails,
  throwEnvironmentNotReady,
  throwHostUnavailable,
  throwProjectUnavailable,
  throwThreadEnvironmentUnavailable,
  threadEnvironmentUnavailableDetails,
} from "./lifecycle-api-errors.js";

type ThreadRow = NonNullable<ReturnType<typeof getThread>>;
type StandardProject = Project & { kind: "standard" };

export interface ThreadEnvironmentLookupResult {
  environment: Environment;
  thread: ThreadRow;
}

function toHostStatus(db: DbConnection, hostId: string): Host["status"] {
  const host = getNonDestroyedHost(db, hostId);
  if (!host) {
    return "disconnected";
  }

  const session = getActiveSession(db, hostId);
  if (session) {
    return "connected";
  }

  return "disconnected";
}

function throwHostNotFound(): never {
  throw new ApiError(404, "host_not_found", "Host not found");
}

function isStandardProject(project: Project): project is StandardProject {
  return project.kind === "standard";
}

/**
 * Orphaned with the daemon transport (host lookups answer from the synthetic
 * `'local'` host, `services/hosts/local-host.ts`); sole remaining caller is
 * the unmounted session machinery. Dies in P1c.
 */
export function requireConnectedHostSession(
  deps: Pick<{ db: DbConnection }, "db">,
  hostId: string,
) {
  const session = getActiveSession(deps.db, hostId);
  if (!session) {
    const host = getHost(deps.db, hostId);
    if (!host) {
      throwHostNotFound();
    }
    if (host.destroyedAt !== null) {
      throwHostUnavailable(
        404,
        "Host is unavailable",
        destroyedHostUnavailableDetails(host.destroyedAt),
      );
    }
    const hostStatus = toHostStatus(deps.db, hostId);
    throwHostUnavailable(
      502,
      "Host is not connected",
      disconnectedHostUnavailableDetails(hostStatus),
    );
  }
  return session;
}

export function requireProject(db: DbConnection, projectId: string): Project {
  const project = getProject(db, projectId);
  if (!project) {
    throw new ApiError(404, "project_not_found", "Project not found");
  }
  return project;
}

export function requirePublicProject(
  db: DbConnection,
  projectId: string,
): Project {
  const project = requireProject(db, projectId);
  const deleteOperation = getProjectOperation(db, {
    projectId,
    kind: "delete",
  });
  if (deleteOperation) {
    throwProjectUnavailable({
      reason: "pending_deletion",
      deletedAt: null,
    });
  }
  return project;
}

export function requirePublicStandardProject(
  db: DbConnection,
  projectId: string,
): StandardProject {
  const project = requirePublicProject(db, projectId);
  if (!isStandardProject(project)) {
    throw new ApiError(404, "project_not_found", "Project not found");
  }
  return project;
}

function requireThread(db: DbConnection, threadId: string): ThreadRow {
  const thread = getThread(db, threadId);
  if (!thread) {
    throw new ApiError(404, "thread_not_found", "Thread not found");
  }
  return thread;
}

export function requirePublicThread(
  db: DbConnection,
  threadId: string,
): ThreadRow {
  const thread = requireThread(db, threadId);
  if (
    thread.deletedAt !== null ||
    getProjectOperation(db, {
      projectId: thread.projectId,
      kind: "delete",
    }) !== null
  ) {
    throw new ApiError(404, "thread_not_found", "Thread not found");
  }
  return thread;
}

export function requireEnvironment(
  db: DbConnection,
  environmentId: string,
): Environment {
  const environment = getEnvironment(db, environmentId);
  if (!environment) {
    throw new ApiError(404, "environment_not_found", "Environment not found");
  }
  return environment;
}

export function requireReadyEnvironment(
  db: DbConnection,
  environmentId: string,
): Environment & { path: string; status: "ready" } {
  const environment = requireEnvironment(db, environmentId);
  if (environment.status !== "ready" || !environment.path) {
    throwEnvironmentNotReady(environment);
  }
  return {
    ...environment,
    path: environment.path,
    status: "ready",
  };
}

function requireEnvironmentForThread(
  db: DbConnection,
  thread: ThreadRow,
): Environment {
  if (!thread.environmentId) {
    throwThreadEnvironmentUnavailable(
      threadEnvironmentUnavailableDetails("never_attached", null),
    );
  }
  return requireEnvironment(db, thread.environmentId);
}

function ensureThreadEnvironmentAvailable(environment: Environment): void {
  const unavailableDetails = destroyedThreadEnvironmentDetails(environment);
  if (unavailableDetails) {
    throwThreadEnvironmentUnavailable(unavailableDetails);
  }
}

export function requireThreadEnvironmentAllowingDestroyed(
  db: DbConnection,
  threadId: string,
): ThreadEnvironmentLookupResult {
  const thread = requireThread(db, threadId);
  return {
    thread,
    environment: requireEnvironmentForThread(db, thread),
  };
}

export function requireThreadEnvironment(
  db: DbConnection,
  threadId: string,
): ThreadEnvironmentLookupResult {
  const result = requireThreadEnvironmentAllowingDestroyed(db, threadId);
  ensureThreadEnvironmentAvailable(result.environment);
  return result;
}

export function requirePublicThreadEnvironmentAllowingDestroyed(
  db: DbConnection,
  threadId: string,
): ThreadEnvironmentLookupResult {
  const thread = requirePublicThread(db, threadId);
  return {
    thread,
    environment: requireEnvironmentForThread(db, thread),
  };
}

export function requirePublicThreadEnvironment(
  db: DbConnection,
  threadId: string,
): ThreadEnvironmentLookupResult {
  const result = requirePublicThreadEnvironmentAllowingDestroyed(db, threadId);
  ensureThreadEnvironmentAvailable(result.environment);
  return result;
}

export function listHostThreadIds(db: DbConnection, hostId: string): string[] {
  return listHostThreadIdsFromDb(db, { hostId });
}

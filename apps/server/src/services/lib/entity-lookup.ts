import {
  getEnvironment,
  getProject,
  getThread,
} from "@bb/db";
import type { Environment, Project } from "@bb/domain";
import type { DbConnection } from "@bb/db";
import { ApiError } from "../../errors.js";
import {
  destroyedThreadEnvironmentDetails,
  throwEnvironmentNotReady,
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

function isStandardProject(project: Project): project is StandardProject {
  return project.kind === "standard";
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
  const project = getProject(db, projectId);
  if (!project) {
    throw new ApiError(404, "project_not_found", "Project not found");
  }
  if (project.deleteRequestedAt !== null) {
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
    getProject(db, thread.projectId)?.deleteRequestedAt != null
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

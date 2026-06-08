import { describe, expect, it } from "vitest";
import {
  createConnection,
  createEnvironment,
  createProject,
  createThread,
  migrate,
  noopNotifier,
  upsertHost,
  type DbConnection,
} from "@bb/db";
import {
  markProjectOperationRecordFailed,
  upsertProjectOperationRecord,
} from "@bb/db/internal-lifecycle";
import type { Host, Project } from "@bb/domain";
import { ApiError } from "../../src/errors.js";
import {
  requirePublicProject,
  requireReadyEnvironment,
  requireThreadEnvironment,
} from "../../src/services/lib/entity-lookup.js";

interface SetupResult {
  db: DbConnection;
  host: Host;
  project: Project;
}

type ThrowingCallback = () => void;

function setup(): SetupResult {
  const db = createConnection(":memory:");
  migrate(db);
  const hostRow = upsertHost(db, noopNotifier, {
    id: "host_entity_lookup",
    name: "Entity Lookup Host",
    type: "persistent",
  });
  const { project } = createProject(db, noopNotifier, {
    name: "Entity Lookup Project",
    source: {
      type: "local_path",
      hostId: hostRow.id,
      path: "/tmp/entity-lookup",
    },
  });
  const host: Host = {
    id: hostRow.id,
    name: hostRow.name,
    type: hostRow.type,
    status: "disconnected",
    lastSeenAt: hostRow.lastSeenAt,
    createdAt: hostRow.createdAt,
    updatedAt: hostRow.updatedAt,
  };
  return { db, host, project };
}

function captureApiError(callback: ThrowingCallback): ApiError {
  try {
    callback();
  } catch (error) {
    if (error instanceof ApiError) {
      return error;
    }
    throw error;
  }
  throw new Error("Expected ApiError");
}

describe("entity lookup lifecycle errors", () => {
  it("returns structured environment_not_ready details", () => {
    const { db, host, project } = setup();
    try {
      const environment = createEnvironment(db, noopNotifier, {
        hostId: host.id,
        projectId: project.id,
        workspaceProvisionType: "managed-worktree",
        path: null,
        status: "destroyed",
        cleanupRequestedAt: 123,
      });

      const error = captureApiError(() => {
        requireReadyEnvironment(db, environment.id);
      });

      expect(error.status).toBe(409);
      expect(error.body).toEqual({
        code: "environment_not_ready",
        message: "Environment unavailable",
        details: {
          environmentStatus: "destroyed",
          hasPath: false,
          cleanupRequestedAt: 123,
        },
      });
    } finally {
      db.$client.close();
    }
  });

  it("returns structured thread_environment_unavailable details", () => {
    const { db, host, project } = setup();
    try {
      const unattachedThread = createThread(db, noopNotifier, {
        projectId: project.id,
        providerId: "codex",
      });
      const unattachedError = captureApiError(() => {
        requireThreadEnvironment(db, unattachedThread.id);
      });
      expect(unattachedError.body).toEqual({
        code: "thread_environment_unavailable",
        message: "Thread environment is unavailable",
        details: {
          reason: "never_attached",
          environmentStatus: null,
        },
      });

      const environment = createEnvironment(db, noopNotifier, {
        hostId: host.id,
        projectId: project.id,
        workspaceProvisionType: "managed-worktree",
        path: null,
        status: "destroyed",
      });
      const destroyedEnvironmentThread = createThread(db, noopNotifier, {
        projectId: project.id,
        environmentId: environment.id,
        providerId: "codex",
      });
      const destroyedError = captureApiError(() => {
        requireThreadEnvironment(db, destroyedEnvironmentThread.id);
      });
      expect(destroyedError.body).toEqual({
        code: "thread_environment_unavailable",
        message: "Thread environment is unavailable",
        details: {
          reason: "destroyed",
          environmentStatus: "destroyed",
        },
      });
    } finally {
      db.$client.close();
    }
  });

  it("returns project_unavailable for pending project deletion", () => {
    const { db, project } = setup();
    try {
      upsertProjectOperationRecord(db, {
        kind: "delete",
        payload: "{}",
        projectId: project.id,
      });

      const error = captureApiError(() => {
        requirePublicProject(db, project.id);
      });

      expect(error.status).toBe(404);
      expect(error.body).toEqual({
        code: "project_unavailable",
        message: "Project is unavailable",
        details: {
          reason: "pending_deletion",
          deletedAt: null,
        },
      });
    } finally {
      db.$client.close();
    }
  });

  it("returns project_unavailable for terminal project delete operations", () => {
    const { db, project } = setup();
    try {
      upsertProjectOperationRecord(db, {
        kind: "delete",
        payload: "{}",
        projectId: project.id,
      });
      const failedOperation = markProjectOperationRecordFailed(db, {
        kind: "delete",
        projectId: project.id,
        failureReason: "environment cleanup failed",
        completedAt: 123,
      });
      expect(failedOperation?.state).toBe("failed");

      const error = captureApiError(() => {
        requirePublicProject(db, project.id);
      });

      expect(error.status).toBe(404);
      expect(error.body).toEqual({
        code: "project_unavailable",
        message: "Project is unavailable",
        details: {
          reason: "pending_deletion",
          deletedAt: null,
        },
      });
    } finally {
      db.$client.close();
    }
  });
});

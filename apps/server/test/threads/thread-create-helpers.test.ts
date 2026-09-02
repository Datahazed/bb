import { describe, expect, it } from "vitest";
import {
  createConnection,
  createEnvironment,
  createProject,
  createThreadSection,
  deleteThreadSection,
  migrate,
  noopNotifier,
  upsertHost,
} from "@bb/db";
import { ApiError } from "../../src/errors.js";
import {
  buildThreadBranchName,
  createThreadRecord,
} from "../../src/services/threads/thread-create-helpers.js";

describe("buildThreadBranchName", () => {
  it("applies the configured prefix, including an empty one", () => {
    expect(
      buildThreadBranchName({
        branchPrefix: "sawyer/wt-",
        threadId: "thr_abc123def456",
      }),
    ).toBe("sawyer/wt-thr_abc123def456");
    expect(
      buildThreadBranchName({ branchPrefix: "", threadId: "thr_abc123def456" }),
    ).toBe("thr_abc123def456");
  });
});

describe("createThreadRecord", () => {
  it("returns section_not_found when the section is stale by create time", () => {
    const db = createConnection(":memory:");
    try {
      migrate(db);
      const deps = { db, hub: noopNotifier };
      const host = upsertHost(db, noopNotifier, {
        name: "Test Host",
        type: "persistent",
      });
      const { project } = createProject(db, noopNotifier, {
        name: "Test Project",
        source: {
          hostId: host.id,
          path: "/tmp/stale-section-create-project",
          type: "local_path",
        },
      });
      const environment = createEnvironment(db, noopNotifier, {
        hostId: host.id,
        path: "/tmp/stale-section-create-project",
        projectId: project.id,
        status: "ready",
        workspaceProvisionType: "managed-worktree",
      });
      const sectionResult = createThreadSection(db, noopNotifier, {
        name: "Race",
      });
      if (sectionResult.status !== "created") {
        throw new Error("Expected section fixture to be created");
      }
      deleteThreadSection(db, noopNotifier, {
        id: sectionResult.section.id,
      });

      try {
        createThreadRecord(deps, {
          environmentId: environment.id,
          request: {
            environment: {
              environmentId: environment.id,
              type: "reuse",
            },
            sectionId: sectionResult.section.id,
            input: [],
            origin: "app",
            projectId: project.id,
            providerId: "codex",
            startedOnBehalfOf: null,
            titleFallback: null,
            visibility: "visible",
          },
        });
        throw new Error("Expected createThreadRecord to throw");
      } catch (error) {
        expect(error).toBeInstanceOf(ApiError);
        expect((error as ApiError).status).toBe(404);
        expect((error as ApiError).body).toMatchObject({
          code: "section_not_found",
          message: "Section not found",
        });
      }
    } finally {
      db.$client.close();
    }
  });
});

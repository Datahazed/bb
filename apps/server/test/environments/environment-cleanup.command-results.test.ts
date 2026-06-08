import { describe, expect, it } from "vitest";
import {
  createConnection,
  createEnvironment,
  createHostDaemonCommandId,
  createProject,
  getEnvironment,
  getEnvironmentOperation,
  migrate,
  type DbConnection,
} from "@bb/db";
import {
  markEnvironmentOperationRecordQueued,
  setEnvironmentStatus,
  upsertEnvironmentOperationRecord,
} from "@bb/db/internal-environment-lifecycle";
import {
  cancelPendingEnvironmentCleanup,
  requestEnvironmentCleanup,
  settleEnvironmentDestroyCommandResult,
  type SettleEnvironmentDestroyCommandResultArgs,
} from "../../src/services/environments/environment-cleanup-internal.js";
import { withTestHarness } from "../helpers/test-app.js";
import { seedEnvironment, seedProjectWithSource } from "../helpers/seed.js";
import { NotificationHub } from "../../src/ws/hub.js";

type EnvironmentDestroyCommand =
  SettleEnvironmentDestroyCommandResultArgs["command"];
type EnvironmentDestroyCommandResultReport =
  SettleEnvironmentDestroyCommandResultArgs["report"];

interface EnvironmentCleanupCommandResultSetup {
  db: DbConnection;
  environmentId: string;
  hostId: string;
  hub: NotificationHub;
}

interface SettleDestroyReportArgs {
  command: EnvironmentDestroyCommand;
  report: EnvironmentDestroyCommandResultReport;
  settledCommand: SettleEnvironmentDestroyCommandResultArgs["settledCommand"];
  testSetup: EnvironmentCleanupCommandResultSetup;
}

function setup(): EnvironmentCleanupCommandResultSetup {
  const db = createConnection(":memory:");
  migrate(db);

  const hub = new NotificationHub();
  const host = { id: "local" };
  const { project } = createProject(db, hub, {
    name: "test-project",
    source: { type: "local_path", hostId: host.id, path: "/tmp/source" },
  });
  const environment = createEnvironment(db, hub, {
    projectId: project.id,
    hostId: host.id,
    managed: true,
    workspaceProvisionType: "managed-worktree",
    path: "/tmp/environment-cleanup-command-results",
    status: "ready",
  });

  return {
    db,
    environmentId: environment.id,
    hostId: host.id,
    hub,
  };
}

function settleDestroyReport(args: SettleDestroyReportArgs) {
  return args.testSetup.db.transaction(
    (tx) =>
      settleEnvironmentDestroyCommandResult({
        command: args.command,
        deps: {
          db: tx,
          hub: args.testSetup.hub,
        },
        report: args.report,
        settledCommand: args.settledCommand,
      }),
    { behavior: "immediate" },
  );
}

describe("environment cleanup command result settlement", () => {
  it("cancels requested cleanup whose destroy dispatch is no longer in flight", async () => {
    await withTestHarness(async (harness) => {
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: "host-cleanup-cancel",
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: "host-cleanup-cancel",
        projectId: project.id,
        managed: true,
        path: "/tmp/environment-cleanup-command-results",
        status: "destroying",
      });
      requestEnvironmentCleanup(harness.deps, {
        environmentId: environment.id,
      });
      // A queued op whose dispatch already settled (or never fired) — the
      // in-flight registry has no entry for it.
      markEnvironmentOperationRecordQueued(harness.db, {
        environmentId: environment.id,
        kind: "destroy",
        commandId: createHostDaemonCommandId(),
      });

      expect(
        cancelPendingEnvironmentCleanup(harness.deps, {
          environmentId: environment.id,
        }),
      ).toBe("cancelled");

      expect(
        getEnvironmentOperation(harness.db, {
          environmentId: environment.id,
          kind: "destroy",
        }),
      ).toMatchObject({
        state: "cancelled",
      });
      expect(getEnvironment(harness.db, environment.id)).toMatchObject({
        cleanupMode: null,
        cleanupRequestedAt: null,
        status: "ready",
      });
    });
  });

  it("reports in-flight destroy dispatches as in progress", async () => {
    await withTestHarness(async (harness) => {
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: "host-cleanup-cancel",
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: "host-cleanup-cancel",
        projectId: project.id,
        managed: true,
        path: "/tmp/environment-cleanup-command-results",
        status: "destroying",
      });
      requestEnvironmentCleanup(harness.deps, {
        environmentId: environment.id,
      });
      const dispatched = harness.deps.engineDispatch.dispatch({
        command: {
          type: "environment.destroy",
          environmentId: environment.id,
          workspaceContext: {
            workspacePath: "/tmp/environment-cleanup-command-results",
            workspaceProvisionType: "managed-worktree",
          },
        },
      });
      markEnvironmentOperationRecordQueued(harness.db, {
        environmentId: environment.id,
        kind: "destroy",
        commandId: dispatched.commandId,
      });

      const operationBefore = getEnvironmentOperation(harness.db, {
        environmentId: environment.id,
        kind: "destroy",
      });
      const environmentBefore = getEnvironment(harness.db, environment.id);

      expect(
        cancelPendingEnvironmentCleanup(harness.deps, {
          environmentId: environment.id,
        }),
      ).toBe("in_progress");

      expect(
        getEnvironmentOperation(harness.db, {
          environmentId: environment.id,
          kind: "destroy",
        }),
      ).toEqual(operationBefore);
      expect(getEnvironment(harness.db, environment.id)).toEqual(
        environmentBefore,
      );

      harness.engineRouting.releaseAll();
    });
  });

  it("settles environment destroy once and ignores duplicate terminal results", () => {
    const testSetup = setup();
    setEnvironmentStatus(testSetup.db, testSetup.hub, testSetup.environmentId, {
      status: "destroying",
    });
    const commandPayload: EnvironmentDestroyCommand = {
      type: "environment.destroy",
      environmentId: testSetup.environmentId,
      workspaceContext: {
        workspacePath: "/tmp/workspace",
        workspaceProvisionType: "managed-worktree",
      },
    };
    const settledCommand = {
      command: commandPayload,
      dispatchedAt: 400,
      hostId: testSetup.hostId,
      id: createHostDaemonCommandId(),
    };
    upsertEnvironmentOperationRecord(testSetup.db, {
      environmentId: testSetup.environmentId,
      kind: "destroy",
      payload: JSON.stringify({}),
    });
    markEnvironmentOperationRecordQueued(testSetup.db, {
      environmentId: testSetup.environmentId,
      kind: "destroy",
      commandId: settledCommand.id,
    });

    const successReport: EnvironmentDestroyCommandResultReport = {
      attemptId: "attempt-destroy",
      commandId: settledCommand.id,
      completedAt: 500,
      ok: true,
      result: {},
      type: "environment.destroy",
    };
    const sideEffects = settleDestroyReport({
      command: commandPayload,
      report: successReport,
      settledCommand,
      testSetup,
    });

    expect(sideEffects.postCommitActions).toEqual([
      expect.objectContaining({
        context: {
          environmentId: testSetup.environmentId,
        },
        name: "Terminal cleanup after environment destroy",
      }),
    ]);
    expect(getEnvironment(testSetup.db, testSetup.environmentId)).toMatchObject(
      {
        status: "destroyed",
      },
    );
    const completed = getEnvironmentOperation(testSetup.db, {
      environmentId: testSetup.environmentId,
      kind: "destroy",
    });
    expect(completed).toMatchObject({
      state: "completed",
      commandId: settledCommand.id,
      failureReason: null,
    });

    const duplicateFailureReport: EnvironmentDestroyCommandResultReport = {
      attemptId: "attempt-destroy",
      commandId: settledCommand.id,
      completedAt: 600,
      errorCode: "late_destroy_failure",
      errorMessage: "destroy failed late",
      ok: false,
      type: "environment.destroy",
    };
    settleDestroyReport({
      command: commandPayload,
      report: duplicateFailureReport,
      settledCommand,
      testSetup,
    });

    expect(
      getEnvironmentOperation(testSetup.db, {
        environmentId: testSetup.environmentId,
        kind: "destroy",
      }),
    ).toMatchObject({
      state: "completed",
      commandId: settledCommand.id,
      completedAt: completed?.completedAt,
      failureReason: null,
    });
    expect(getEnvironment(testSetup.db, testSetup.environmentId)).toMatchObject(
      {
        status: "destroyed",
      },
    );
  });
});

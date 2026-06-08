import { describe, expect, it } from "vitest";
import { createHostDaemonCommandId } from "../../src/ids.js";
import { createConnection } from "../../src/connection.js";
import { migrate } from "../../src/migrate.js";
import { noopNotifier } from "../../src/notifier.js";
import { createThread } from "../../src/data/threads.js";
import {
  getThreadOperation,
  getThreadOperationByCommandId,
  markThreadOperationRecordCompleted,
  markThreadOperationRecordQueued,
  upsertThreadOperationRecord,
} from "../../src/data/thread-operations.js";
import { createEnvironment } from "../../src/data/environments.js";
import { createProject } from "../../src/data/projects.js";

function setup() {
  const db = createConnection(":memory:");
  migrate(db);
  const host = { id: "local" };
  const { project } = createProject(db, noopNotifier, {
    name: "test-project",
    source: { type: "local_path", hostId: host.id, path: "/tmp/test" },
  });
  const environment = createEnvironment(db, noopNotifier, {
    projectId: project.id,
    hostId: host.id,
    workspaceProvisionType: "unmanaged",
    status: "ready",
  });
  const thread = createThread(db, noopNotifier, {
    projectId: project.id,
    environmentId: environment.id,
    providerId: "openai",
  });
  return { db, environment, host, thread };
}

describe("thread operations", () => {
  it("upserts thread lifecycle operations by thread and kind", () => {
    const { db, thread } = setup();

    const first = upsertThreadOperationRecord(db, {
      threadId: thread.id,
      kind: "start",
      payload: JSON.stringify({ type: "thread.start" }),
      requestedAt: 111,
    });
    const second = upsertThreadOperationRecord(db, {
      threadId: thread.id,
      kind: "start",
      payload: JSON.stringify({ type: "thread.start", attempt: 2 }),
      requestedAt: 222,
    });

    expect(first).toMatchObject({
      threadId: thread.id,
      kind: "start",
      state: "requested",
      requestedAt: 111,
    });
    expect(second).toMatchObject({
      id: first.id,
      payload: JSON.stringify({ type: "thread.start", attempt: 2 }),
      requestedAt: 111,
      state: "requested",
    });
  });

  it("stores provisioning state columns for provision operations", () => {
    const { db, environment, thread } = setup();
    const command = { id: createHostDaemonCommandId() };

    const first = upsertThreadOperationRecord(db, {
      threadId: thread.id,
      kind: "provision",
      payload: JSON.stringify({ clientRequestId: "creq_23456789ab" }),
      provisioningState: {
        environmentId: null,
        provisionEventSequence: null,
        provisioningId: "tpv-db-1",
        stage: "metadata-pending",
        workspaceReadyEventSequence: null,
      },
    });
    const second = upsertThreadOperationRecord(db, {
      threadId: thread.id,
      kind: "provision",
      payload: JSON.stringify({ clientRequestId: "creq_23456789ac" }),
      provisioningState: {
        environmentId: environment.id,
        provisionEventSequence: 12,
        provisioningId: "tpv-db-1",
        stage: "workspace-ready",
        workspaceReadyEventSequence: 18,
      },
    });
    markThreadOperationRecordQueued(db, {
      threadId: thread.id,
      kind: "provision",
      commandId: command.id,
    });

    expect(first).toMatchObject({
      payload: JSON.stringify({ clientRequestId: "creq_23456789ab" }),
      provisioningId: "tpv-db-1",
      provisioningStage: "metadata-pending",
      provisioningEnvironmentId: null,
    });
    expect(second).toMatchObject({
      id: first.id,
      payload: JSON.stringify({ clientRequestId: "creq_23456789ac" }),
      provisioningId: "tpv-db-1",
      provisioningStage: "workspace-ready",
      provisioningEnvironmentId: environment.id,
      provisionEventSequence: 12,
      workspaceReadyEventSequence: 18,
    });
    expect(
      getThreadOperation(db, {
        threadId: thread.id,
        kind: "provision",
      }),
    ).toMatchObject({
      commandId: command.id,
      payload: JSON.stringify({ clientRequestId: "creq_23456789ac" }),
      provisioningId: "tpv-db-1",
      provisioningStage: "workspace-ready",
      provisioningEnvironmentId: environment.id,
      provisionEventSequence: 12,
      workspaceReadyEventSequence: 18,
    });
  });

  it("records queued and completed thread operations", () => {
    const { db, thread } = setup();
    const command = { id: createHostDaemonCommandId() };

    upsertThreadOperationRecord(db, {
      threadId: thread.id,
      kind: "stop",
      payload: JSON.stringify({ type: "thread.stop" }),
    });
    const queued = markThreadOperationRecordQueued(db, {
      threadId: thread.id,
      kind: "stop",
      commandId: command.id,
      queuedAt: 333,
    });
    const completed = markThreadOperationRecordCompleted(db, {
      threadId: thread.id,
      kind: "stop",
      completedAt: 444,
    });

    expect(queued).toMatchObject({
      state: "queued",
      commandId: command.id,
      queuedAt: 333,
    });
    expect(getThreadOperationByCommandId(db, command.id)?.id).toBe(queued?.id);
    expect(completed).toMatchObject({
      state: "completed",
      completedAt: 444,
    });
    expect(
      getThreadOperation(db, {
        threadId: thread.id,
        kind: "stop",
      }),
    ).toMatchObject({
      state: "completed",
      commandId: command.id,
    });
  });

  it("does not move terminal thread operations back to queued", () => {
    const { db, thread } = setup();
    const firstCommand = { id: createHostDaemonCommandId() };
    const secondCommand = { id: createHostDaemonCommandId() };

    upsertThreadOperationRecord(db, {
      threadId: thread.id,
      kind: "stop",
      payload: JSON.stringify({ type: "thread.stop" }),
    });
    markThreadOperationRecordQueued(db, {
      threadId: thread.id,
      kind: "stop",
      commandId: firstCommand.id,
    });
    markThreadOperationRecordCompleted(db, {
      threadId: thread.id,
      kind: "stop",
    });

    const regressed = markThreadOperationRecordQueued(db, {
      threadId: thread.id,
      kind: "stop",
      commandId: secondCommand.id,
    });

    expect(regressed).toBeNull();
    expect(
      getThreadOperation(db, {
        threadId: thread.id,
        kind: "stop",
      }),
    ).toMatchObject({
      commandId: firstCommand.id,
      state: "completed",
    });
  });
});

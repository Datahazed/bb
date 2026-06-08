import { describe, expect, it } from "vitest";
import { encodeClientTurnRequestIdNumber, turnScope } from "@bb/domain";
import { createHostDaemonCommandId } from "../../src/ids.js";
import { createConnection } from "../../src/connection.js";
import { migrate } from "../../src/migrate.js";
import { noopNotifier } from "../../src/notifier.js";
import {
  createPendingClientTurnRequestInTransaction,
  getClientTurnRequest,
  listClientTurnRequestsByThreadAndRequestIds,
  markClientTurnRequestAcceptedInTransaction,
  recordClientTurnRequestCommandCompletedInTransaction,
  settleClientTurnRequestsForCommandInTransaction,
  settlePendingClientTurnRequestsForThreadsInTransaction,
} from "../../src/data/client-turn-requests.js";
import { appendDaemonEventsInTransaction } from "../../src/data/events.js";
import { createProject } from "../../src/data/projects.js";
import { createThread } from "../../src/data/threads.js";

const requestId1 = encodeClientTurnRequestIdNumber({ value: 1 });
const requestId2 = encodeClientTurnRequestIdNumber({ value: 2 });

function setup() {
  const db = createConnection(":memory:");
  migrate(db);
  const host = { id: "local" };
  const { project } = createProject(db, noopNotifier, {
    name: "test-project",
    source: { type: "local_path", hostId: host.id, path: "/tmp/test" },
  });
  const thread = createThread(db, noopNotifier, {
    projectId: project.id,
    providerId: "codex",
  });
  const command = { id: createHostDaemonCommandId() };
  return { command, db, host, project, thread };
}

describe("client turn requests", () => {
  it("creates and lists pending request lifecycle rows", () => {
    const { command, db, thread } = setup();

    const row = db.transaction((tx) =>
      createPendingClientTurnRequestInTransaction(tx, {
        commandId: command.id,
        commandType: "turn.submit",
        environmentId: null,
        requestEventSequence: 7,
        requestId: requestId1,
        threadId: thread.id,
      }),
    );

    expect(row).toMatchObject({
      commandId: command.id,
      commandType: "turn.submit",
      requestEventSequence: 7,
      requestId: requestId1,
      status: "pending",
      threadId: thread.id,
    });
    expect(
      listClientTurnRequestsByThreadAndRequestIds(db, {
        requestIds: [requestId1],
        threadId: thread.id,
      }),
    ).toEqual([row]);
  });

  it("returns an existing pending lifecycle row for duplicate request ids", () => {
    const { command, db, thread } = setup();

    const first = db.transaction((tx) =>
      createPendingClientTurnRequestInTransaction(tx, {
        commandId: command.id,
        commandType: "turn.submit",
        environmentId: null,
        requestEventSequence: 7,
        requestId: requestId1,
        threadId: thread.id,
      }),
    );
    const second = db.transaction((tx) =>
      createPendingClientTurnRequestInTransaction(tx, {
        commandId: "hcmd_duplicate_ignored",
        commandType: "turn.submit",
        environmentId: null,
        requestEventSequence: 8,
        requestId: requestId1,
        threadId: thread.id,
      }),
    );

    expect(second).toEqual(first);
    expect(
      listClientTurnRequestsByThreadAndRequestIds(db, {
        requestIds: [requestId1],
        threadId: thread.id,
      }),
    ).toEqual([first]);
  });

  it("marks pending requests accepted once", () => {
    const { command, db, thread } = setup();
    db.transaction((tx) =>
      createPendingClientTurnRequestInTransaction(tx, {
        commandId: command.id,
        commandType: "turn.submit",
        environmentId: null,
        requestEventSequence: 7,
        requestId: requestId1,
        threadId: thread.id,
      }),
    );

    const accepted = db.transaction((tx) =>
      markClientTurnRequestAcceptedInTransaction(tx, {
        requestId: requestId1,
        settledAt: 123,
        threadId: thread.id,
      }),
    );
    const repeated = db.transaction((tx) =>
      markClientTurnRequestAcceptedInTransaction(tx, {
        requestId: requestId1,
        settledAt: 456,
        threadId: thread.id,
      }),
    );

    expect(accepted).toMatchObject({
      reasonCode: "accepted",
      requestId: requestId1,
      settledAt: 123,
      status: "accepted",
    });
    expect(repeated).toBeNull();
  });

  it("records command completion without terminalizing successful requests", () => {
    const { command, db, thread } = setup();
    db.transaction((tx) =>
      createPendingClientTurnRequestInTransaction(tx, {
        commandId: command.id,
        commandType: "turn.submit",
        environmentId: null,
        requestEventSequence: 7,
        requestId: requestId1,
        threadId: thread.id,
      }),
    );

    const [updated] = db.transaction((tx) =>
      recordClientTurnRequestCommandCompletedInTransaction(tx, {
        commandCompletedAt: 500,
        commandId: command.id,
      }),
    );

    expect(updated).toMatchObject({
      commandCompletedAt: 500,
      requestId: requestId1,
      settledAt: null,
      status: "pending",
    });
  });

  it("settles pending requests for a failed command", () => {
    const { command, db, thread } = setup();
    db.transaction((tx) =>
      createPendingClientTurnRequestInTransaction(tx, {
        commandId: command.id,
        commandType: "turn.submit",
        environmentId: null,
        requestEventSequence: 7,
        requestId: requestId1,
        threadId: thread.id,
      }),
    );

    const [settled] = db.transaction((tx) =>
      settleClientTurnRequestsForCommandInTransaction(tx, {
        commandCompletedAt: 500,
        commandId: command.id,
        message: "Provider rejected input",
        reasonCode: "command_failed",
        settledAt: 501,
        status: "failed",
      }),
    );

    expect(settled).toMatchObject({
      commandCompletedAt: 500,
      message: "Provider rejected input",
      reasonCode: "command_failed",
      requestId: requestId1,
      settledAt: 501,
      status: "failed",
    });
  });

  it("settles only pending lifecycle rows for selected threads", () => {
    const { command, db, project, thread } = setup();
    const otherThread = createThread(db, noopNotifier, {
      projectId: project.id,
      providerId: "codex",
    });
    db.transaction((tx) => {
      createPendingClientTurnRequestInTransaction(tx, {
        commandId: command.id,
        commandType: "turn.submit",
        environmentId: null,
        requestEventSequence: 7,
        requestId: requestId1,
        threadId: thread.id,
      });
      createPendingClientTurnRequestInTransaction(tx, {
        commandId: command.id,
        commandType: "turn.submit",
        environmentId: null,
        requestEventSequence: 8,
        requestId: requestId2,
        threadId: otherThread.id,
      });
      markClientTurnRequestAcceptedInTransaction(tx, {
        requestId: requestId2,
        settledAt: 100,
        threadId: otherThread.id,
      });
    });

    const settled = db.transaction((tx) =>
      settlePendingClientTurnRequestsForThreadsInTransaction(tx, {
        message: "Provider restarted",
        reasonCode: "provider_restarted",
        settledAt: 200,
        status: "canceled",
        threadIds: [thread.id, otherThread.id],
      }),
    );

    expect(settled).toHaveLength(1);
    expect(settled[0]).toMatchObject({
      message: "Provider restarted",
      reasonCode: "provider_restarted",
      requestId: requestId1,
      settledAt: 200,
      status: "canceled",
      threadId: thread.id,
    });
    expect(getClientTurnRequest(db, { requestId: requestId2 })).toMatchObject({
      reasonCode: "accepted",
      settledAt: 100,
      status: "accepted",
    });
  });

  it("marks lifecycle rows accepted when accepted input events are appended", () => {
    const { command, db, thread } = setup();
    db.transaction((tx) =>
      createPendingClientTurnRequestInTransaction(tx, {
        commandId: command.id,
        commandType: "turn.submit",
        environmentId: null,
        requestEventSequence: 7,
        requestId: requestId1,
        threadId: thread.id,
      }),
    );

    db.transaction((tx) =>
      appendDaemonEventsInTransaction(tx, [
        {
          data: JSON.stringify({ providerThreadId: "provider-thread-1" }),
          environmentId: null,
          itemId: null,
          itemKind: null,
          producerEventId: "producer-turn-started",
          producerEventPayloadHash: "hash-turn-started",
          providerThreadId: "provider-thread-1",
          scope: turnScope("turn-1"),
          threadId: thread.id,
          type: "turn/started",
        },
        {
          data: JSON.stringify({ clientRequestId: requestId1 }),
          environmentId: null,
          itemId: null,
          itemKind: null,
          producerEventId: "producer-input-accepted",
          producerEventPayloadHash: "hash-input-accepted",
          providerThreadId: "provider-thread-1",
          scope: turnScope("turn-1"),
          threadId: thread.id,
          type: "turn/input/accepted",
        },
      ]),
    );

    expect(getClientTurnRequest(db, { requestId: requestId1 })).toMatchObject({
      reasonCode: "accepted",
      status: "accepted",
    });
  });


});

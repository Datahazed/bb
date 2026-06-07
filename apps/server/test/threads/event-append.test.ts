import { getThread, listEvents } from "@bb/db";
import { threadScope, turnScope } from "@bb/domain";
import type { ThreadEvent } from "@bb/domain";
import { describe, expect, it } from "vitest";
import type { ThreadEventSink } from "../../src/engine/ports.js";
import { TurnStartGuardError } from "../../src/errors.js";
import { createThreadEventAppender } from "../../src/services/threads/event-append.js";
import { createMockHubSocket } from "../helpers/mock-hub-socket.js";
import { seedThread, seedThreadFixture } from "../helpers/seed.js";
import { withTestHarness } from "../helpers/test-app.js";

// Ports of the daemon spool's ordering assertions
// (`apps/host-daemon/src/event-buffer.test.ts`) onto the in-process append
// path. The durability/restart/hash-migration/rejected-row/zero-ack suites
// died with the transport.

interface ThreadEventFixtureArgs {
  providerThreadId?: string;
  threadId: string;
}

interface TurnEventFixtureArgs {
  threadId: string;
  turnId: string;
}

function threadIdentityEvent(args: ThreadEventFixtureArgs): ThreadEvent {
  return {
    type: "thread/identity",
    threadId: args.threadId,
    providerThreadId: args.providerThreadId ?? `provider-${args.threadId}`,
    scope: threadScope(),
  };
}

function threadCompactedEvent(args: ThreadEventFixtureArgs): ThreadEvent {
  return {
    type: "thread/compacted",
    threadId: args.threadId,
    providerThreadId: args.providerThreadId ?? `provider-${args.threadId}`,
    scope: threadScope(),
  };
}

function turnStartedEvent(args: TurnEventFixtureArgs): ThreadEvent {
  return {
    type: "turn/started",
    threadId: args.threadId,
    providerThreadId: `provider-${args.threadId}`,
    scope: turnScope(args.turnId),
  };
}

function turnCompletedEvent(args: TurnEventFixtureArgs): ThreadEvent {
  return {
    type: "turn/completed",
    threadId: args.threadId,
    providerThreadId: `provider-${args.threadId}`,
    status: "completed",
    scope: turnScope(args.turnId),
  };
}

function completedAgentMessageEvent(args: TurnEventFixtureArgs): ThreadEvent {
  return {
    type: "item/completed",
    threadId: args.threadId,
    providerThreadId: `provider-${args.threadId}`,
    scope: turnScope(args.turnId),
    item: {
      type: "agentMessage",
      id: `message-${args.threadId}`,
      text: "done",
    },
  };
}

describe("thread event appender", () => {
  it("preserves deterministic emit order across interleaved threads", async () => {
    await withTestHarness(async (harness) => {
      const {
        environment,
        project,
        thread: threadA,
      } = seedThreadFixture(harness);
      const threadB = seedThread(harness.deps, {
        environmentId: environment.id,
        projectId: project.id,
      });
      const appender = createThreadEventAppender(harness.deps);

      appender.emit({
        threadId: threadA.id,
        event: threadIdentityEvent({
          providerThreadId: "provider-a1",
          threadId: threadA.id,
        }),
      });
      appender.emit({
        threadId: threadB.id,
        event: threadIdentityEvent({
          providerThreadId: "provider-b1",
          threadId: threadB.id,
        }),
      });
      appender.emit({
        threadId: threadA.id,
        event: threadIdentityEvent({
          providerThreadId: "provider-a2",
          threadId: threadA.id,
        }),
      });
      await appender.flush();

      // Per-thread sequences keep advancing across separate batches.
      appender.emit({
        threadId: threadA.id,
        event: threadIdentityEvent({
          providerThreadId: "provider-a3",
          threadId: threadA.id,
        }),
      });
      await appender.flush();

      const threadAEvents = listEvents(harness.db, { threadId: threadA.id });
      expect(threadAEvents.map((row) => row.providerThreadId)).toEqual([
        "provider-a1",
        "provider-a2",
        "provider-a3",
      ]);
      expect(threadAEvents.map((row) => row.sequence)).toEqual([1, 2, 3]);
      expect(threadAEvents.map((row) => row.environmentId)).toEqual([
        environment.id,
        environment.id,
        environment.id,
      ]);

      const threadBEvents = listEvents(harness.db, { threadId: threadB.id });
      expect(threadBEvents.map((row) => row.providerThreadId)).toEqual([
        "provider-b1",
      ]);
      expect(threadBEvents.map((row) => row.sequence)).toEqual([1]);
    });
  });

  it("requires previously emitted events to settle before flush resolves", async () => {
    await withTestHarness(async (harness) => {
      const { thread } = seedThreadFixture(harness);
      // The appender is the P1b implementation of the engine seam — keep the
      // surfaces signature-compatible at compile time.
      const sink: ThreadEventSink = createThreadEventAppender(harness.deps);

      // Nothing emitted yet: the barrier is trivially satisfied.
      await sink.flush();
      expect(listEvents(harness.db, { threadId: thread.id })).toHaveLength(0);

      sink.emit({
        threadId: thread.id,
        event: threadIdentityEvent({
          providerThreadId: "provider-1",
          threadId: thread.id,
        }),
      });
      sink.emit({
        threadId: thread.id,
        event: threadIdentityEvent({
          providerThreadId: "provider-2",
          threadId: thread.id,
        }),
      });
      const flushed = sink.flush();
      sink.emit({
        threadId: thread.id,
        event: threadIdentityEvent({
          providerThreadId: "provider-3",
          threadId: thread.id,
        }),
      });
      await flushed;

      const storedAfterBarrier = listEvents(harness.db, {
        threadId: thread.id,
      }).map((row) => row.providerThreadId);
      expect(storedAfterBarrier).toContain("provider-1");
      expect(storedAfterBarrier).toContain("provider-2");

      await sink.flush();
      expect(
        listEvents(harness.db, { threadId: thread.id }).map(
          (row) => row.providerThreadId,
        ),
      ).toEqual(["provider-1", "provider-2", "provider-3"]);
    });
  });

  it("satisfies the turn-start guard within a single emitted batch", async () => {
    await withTestHarness(async (harness) => {
      const { thread } = seedThreadFixture(harness);
      const appender = createThreadEventAppender(harness.deps);

      appender.emit({
        threadId: thread.id,
        event: turnStartedEvent({ threadId: thread.id, turnId: "turn-1" }),
      });
      appender.emit({
        threadId: thread.id,
        event: completedAgentMessageEvent({
          threadId: thread.id,
          turnId: "turn-1",
        }),
      });
      await appender.flush();

      expect(
        listEvents(harness.db, { threadId: thread.id }).map((row) => row.type),
      ).toEqual(["turn/started", "item/completed"]);
    });
  });

  it("throws and drops the whole batch when a turn-scoped event precedes turn/started", async () => {
    await withTestHarness(async (harness) => {
      const {
        environment,
        project,
        thread: threadA,
      } = seedThreadFixture(harness);
      const threadB = seedThread(harness.deps, {
        environmentId: environment.id,
        projectId: project.id,
      });
      const appender = createThreadEventAppender(harness.deps);

      appender.emit({
        threadId: threadB.id,
        event: threadIdentityEvent({
          providerThreadId: "provider-b1",
          threadId: threadB.id,
        }),
      });
      appender.emit({
        threadId: threadA.id,
        event: completedAgentMessageEvent({
          threadId: threadA.id,
          turnId: "turn-1",
        }),
      });
      const firstWaiter = appender.flush();
      const secondWaiter = appender.flush();
      await expect(firstWaiter).rejects.toBeInstanceOf(TurnStartGuardError);
      await expect(secondWaiter).rejects.toThrow(
        /before turn\/started is stored/u,
      );

      // The violating batch rolled back as a whole — no partial appends, no
      // silent drops of the valid sibling.
      expect(listEvents(harness.db, { threadId: threadA.id })).toHaveLength(0);
      expect(listEvents(harness.db, { threadId: threadB.id })).toHaveLength(0);

      // The appender keeps accepting and committing later emissions.
      appender.emit({
        threadId: threadB.id,
        event: threadIdentityEvent({
          providerThreadId: "provider-b2",
          threadId: threadB.id,
        }),
      });
      await appender.flush();
      expect(
        listEvents(harness.db, { threadId: threadB.id }).map(
          (row) => row.providerThreadId,
        ),
      ).toEqual(["provider-b2"]);
    });
  });

  it("notifies the hub once per thread per batch with eventTypes metadata", async () => {
    await withTestHarness(async (harness) => {
      const {
        environment,
        project,
        thread: threadA,
      } = seedThreadFixture(harness);
      const threadB = seedThread(harness.deps, {
        environmentId: environment.id,
        projectId: project.id,
      });
      const appender = createThreadEventAppender(harness.deps);

      const socketA = createMockHubSocket();
      const socketB = createMockHubSocket();
      harness.hub.subscribe(socketA, "thread", threadA.id);
      harness.hub.subscribe(socketB, "thread", threadB.id);

      appender.emit({
        threadId: threadA.id,
        event: threadIdentityEvent({ threadId: threadA.id }),
      });
      appender.emit({
        threadId: threadA.id,
        event: threadCompactedEvent({ threadId: threadA.id }),
      });
      appender.emit({
        threadId: threadB.id,
        event: threadIdentityEvent({ threadId: threadB.id }),
      });
      await appender.flush();

      expect(socketA.messages).toHaveLength(1);
      expect(JSON.parse(socketA.messages[0])).toMatchObject({
        type: "changed",
        entity: "thread",
        id: threadA.id,
        changes: ["events-appended"],
        metadata: {
          eventTypes: ["thread/identity", "thread/compacted"],
        },
      });

      expect(socketB.messages).toHaveLength(1);
      expect(JSON.parse(socketB.messages[0])).toMatchObject({
        type: "changed",
        entity: "thread",
        id: threadB.id,
        changes: ["events-appended"],
        metadata: {
          eventTypes: ["thread/identity"],
        },
      });
    });
  });

  it("applies event effects once events commit", async () => {
    await withTestHarness(async (harness) => {
      const { thread } = seedThreadFixture(harness, {
        thread: { status: "idle" },
      });
      const appender = createThreadEventAppender(harness.deps);

      appender.emit({
        threadId: thread.id,
        event: turnStartedEvent({ threadId: thread.id, turnId: "turn-1" }),
      });
      await appender.flush();
      expect(getThread(harness.db, thread.id)?.status).toBe("active");

      appender.emit({
        threadId: thread.id,
        event: turnCompletedEvent({ threadId: thread.id, turnId: "turn-1" }),
      });
      await appender.flush();
      expect(getThread(harness.db, thread.id)?.status).toBe("idle");
    });
  });

  it("does not reactivate a thread for a turn/started whose turn already completed", async () => {
    await withTestHarness(async (harness) => {
      const { thread } = seedThreadFixture(harness, {
        thread: { status: "idle" },
      });
      const appender = createThreadEventAppender(harness.deps);

      appender.emit({
        threadId: thread.id,
        event: turnStartedEvent({ threadId: thread.id, turnId: "turn-1" }),
      });
      appender.emit({
        threadId: thread.id,
        event: turnCompletedEvent({ threadId: thread.id, turnId: "turn-1" }),
      });
      await appender.flush();
      expect(getThread(harness.db, thread.id)?.status).toBe("idle");

      // A re-emitted turn/started (the in-process analogue of a late daemon
      // replay) still appends but must not flip the thread back to active.
      appender.emit({
        threadId: thread.id,
        event: turnStartedEvent({ threadId: thread.id, turnId: "turn-1" }),
      });
      await appender.flush();

      expect(getThread(harness.db, thread.id)?.status).toBe("idle");
      expect(
        listEvents(harness.db, { threadId: thread.id }).map((row) => row.type),
      ).toEqual(["turn/started", "turn/completed", "turn/started"]);
    });
  });

  it("rejects an emission whose payload threadId disagrees with the input", async () => {
    await withTestHarness(async (harness) => {
      const { thread } = seedThreadFixture(harness);
      const appender = createThreadEventAppender(harness.deps);

      expect(() =>
        appender.emit({
          threadId: thread.id,
          event: threadIdentityEvent({ threadId: "thr_other" }),
        }),
      ).toThrow(/does not match payload threadId/u);
      await appender.flush();
      expect(listEvents(harness.db, { threadId: thread.id })).toHaveLength(0);
    });
  });
});

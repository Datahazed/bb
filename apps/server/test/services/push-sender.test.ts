import {
  applyThreadLifecycleEvent,
  archiveThread,
  listPushSubscriptions,
  setPendingInteractionResolved,
  updateThread,
  upsertPushSubscription,
} from "@bb/db";
import { threadScope, turnScope } from "@bb/domain";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createPushSender,
  type ExpoPushMessage,
  type PushSender,
  type PushSenderFetch,
} from "../../src/services/notifications/push-sender.js";
import {
  createCommandApprovalPayload,
  createUserQuestionPayload,
} from "../helpers/pending-interactions.js";
import {
  seedEvent,
  seedThreadFixture,
  seedTurnStarted,
} from "../helpers/seed.js";
import {
  createTestAppHarness,
  testLogger,
  type TestAppHarness,
} from "../helpers/test-app.js";

const EXPO_URL = "http://expo.test/push";
const COALESCE_MS = 50;

interface FakeExpo {
  fetch: PushSenderFetch;
  requests: ExpoPushMessage[][];
  sentAt: number[];
  /** Per-token ticket overrides; defaults to `ok`. */
  ticketErrors: Map<string, string>;
}

function createFakeExpo(): FakeExpo {
  const requests: ExpoPushMessage[][] = [];
  const sentAt: number[] = [];
  const ticketErrors = new Map<string, string>();
  const fetch: PushSenderFetch = async (url, init) => {
    expect(url).toBe(EXPO_URL);
    expect(init.headers["content-type"]).toBe("application/json");
    const batch = JSON.parse(init.body) as ExpoPushMessage[];
    requests.push(batch);
    sentAt.push(Date.now());
    const data = batch.map((message) => {
      const error = ticketErrors.get(message.to);
      return error === undefined
        ? { status: "ok", id: `ticket-${message.to}` }
        : {
            status: "error",
            message: `Token ${message.to} failed`,
            details: { error },
          };
    });
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ data }),
    };
  };
  return { fetch, requests, sentAt, ticketErrors };
}

function sentMessages(expo: FakeExpo): ExpoPushMessage[] {
  return expo.requests.flat();
}

async function waitForCoalesce(sender: PushSender): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, COALESCE_MS * 3));
  await sender.settle();
}

describe("push sender", () => {
  let harness: TestAppHarness;
  let expo: FakeExpo;
  let sender: PushSender;

  beforeEach(async () => {
    harness = await createTestAppHarness();
    expo = createFakeExpo();
    sender = createPushSender({
      db: harness.db,
      hub: harness.hub,
      logger: testLogger,
      enabled: true,
      expoPushUrl: EXPO_URL,
      fetch: expo.fetch,
      coalesceMs: COALESCE_MS,
    });
    sender.start();
    upsertPushSubscription(harness.db, {
      expoPushToken: "ExponentPushToken[phone]",
      platform: "ios",
      deviceLabel: "Phone",
    });
  });

  afterEach(async () => {
    sender.stop();
    await harness.cleanup();
  });

  async function seedActiveThread(title = "Fix the flaky test") {
    const fixture = seedThreadFixture(harness, {
      thread: { status: "active", title, titleFallback: null },
    });
    seedTurnStarted(harness.deps, {
      threadId: fixture.thread.id,
      turnId: "turn-1",
      providerThreadId: "provider-thread-1",
    });
    // A thread is born read (lastReadAt = createdAt); let the clock tick so
    // the turn finishing below lands in a later millisecond, as in production.
    await new Promise((resolve) => setTimeout(resolve, 2));
    return fixture;
  }

  function seedAssistantReply(threadId: string, text: string) {
    seedEvent(harness.deps, {
      threadId,
      providerThreadId: "provider-thread-1",
      scope: turnScope("turn-1"),
      sequence: 2,
      type: "item/completed",
      data: {
        item: { type: "agentMessage", id: "assistant-1", text },
      },
    });
  }

  it("pushes a turn-finished preview to every device when a root thread goes idle", async () => {
    upsertPushSubscription(harness.db, {
      expoPushToken: "ExponentPushToken[tablet]",
      platform: "android",
      deviceLabel: "Tablet",
    });
    const { thread, project } = await seedActiveThread();
    seedAssistantReply(
      thread.id,
      "Done: the retry loop was racing the timer.\n\nDetails below.",
    );

    applyThreadLifecycleEvent(harness.db, harness.hub, {
      threadId: thread.id,
      event: { type: "run.succeeded" },
    });
    await waitForCoalesce(sender);

    const messages = sentMessages(expo);
    expect(messages).toHaveLength(2);
    expect(messages.map((message) => message.to).sort()).toEqual([
      "ExponentPushToken[phone]",
      "ExponentPushToken[tablet]",
    ]);
    expect(messages[0]).toMatchObject({
      title: "Fix the flaky test",
      body: "Done: the retry loop was racing the timer.",
      data: {
        kind: "turn-finished",
        projectId: project.id,
        threadId: thread.id,
      },
      sound: "default",
      channelId: "default",
      priority: "high",
    });
  });

  it("skips the push when a client read the thread inside the coalesce window", async () => {
    const { thread } = await seedActiveThread();
    applyThreadLifecycleEvent(harness.db, harness.hub, {
      threadId: thread.id,
      event: { type: "run.succeeded" },
    });
    // The web marks the thread read as soon as attention lands while visible.
    updateThread(harness.db, harness.hub, thread.id, {
      lastReadAt: Date.now() + 1,
    });
    await waitForCoalesce(sender);

    expect(sentMessages(expo)).toEqual([]);
  });

  it("does not push for marking a thread unread or for child threads finishing", async () => {
    const parent = await seedActiveThread("Parent");
    applyThreadLifecycleEvent(harness.db, harness.hub, {
      threadId: parent.thread.id,
      event: { type: "run.succeeded" },
    });
    await waitForCoalesce(sender);
    expect(sentMessages(expo)).toHaveLength(1);

    updateThread(harness.db, harness.hub, parent.thread.id, {
      lastReadAt: Date.now() + 1,
    });
    updateThread(harness.db, harness.hub, parent.thread.id, {
      lastReadAt: null,
    });
    await waitForCoalesce(sender);
    expect(sentMessages(expo)).toHaveLength(1);

    const child = seedThreadFixture(harness, {
      thread: {
        status: "active",
        title: "Child",
        parentThreadId: parent.thread.id,
      },
    });
    applyThreadLifecycleEvent(harness.db, harness.hub, {
      threadId: child.thread.id,
      event: { type: "run.succeeded" },
    });
    await waitForCoalesce(sender);
    expect(sentMessages(expo)).toHaveLength(1);
  });

  it("coalesces a burst into one push and keeps later pushes a window apart", async () => {
    const { thread } = await seedActiveThread();
    applyThreadLifecycleEvent(harness.db, harness.hub, {
      threadId: thread.id,
      event: { type: "run.succeeded" },
    });
    // A second attention bump in the same window (re-run + finish) merges.
    applyThreadLifecycleEvent(harness.db, harness.hub, {
      threadId: thread.id,
      event: { type: "run.started" },
    });
    applyThreadLifecycleEvent(harness.db, harness.hub, {
      threadId: thread.id,
      event: { type: "run.succeeded" },
    });
    await waitForCoalesce(sender);
    expect(sentMessages(expo)).toHaveLength(1);

    // Right after a send, the next trigger waits out another window.
    applyThreadLifecycleEvent(harness.db, harness.hub, {
      threadId: thread.id,
      event: { type: "run.started" },
    });
    applyThreadLifecycleEvent(harness.db, harness.hub, {
      threadId: thread.id,
      event: { type: "run.succeeded" },
    });
    await waitForCoalesce(sender);
    expect(sentMessages(expo)).toHaveLength(2);
    expect(expo.sentAt[1]! - expo.sentAt[0]!).toBeGreaterThanOrEqual(
      COALESCE_MS,
    );
  });

  it("drops a turn-finished push when the agent is already working again", async () => {
    const { thread } = await seedActiveThread();
    applyThreadLifecycleEvent(harness.db, harness.hub, {
      threadId: thread.id,
      event: { type: "run.succeeded" },
    });
    // A queued message auto-sent before the window closed.
    applyThreadLifecycleEvent(harness.db, harness.hub, {
      threadId: thread.id,
      event: { type: "run.started" },
    });
    await waitForCoalesce(sender);

    expect(sentMessages(expo)).toEqual([]);
  });

  it("pushes the error message when a run fails", async () => {
    const { thread } = await seedActiveThread("Deploy");
    seedEvent(harness.deps, {
      threadId: thread.id,
      scope: threadScope(),
      sequence: 2,
      type: "system/error",
      data: { message: "Provider exited with code 1\nstack…" },
    });
    applyThreadLifecycleEvent(harness.db, harness.hub, {
      threadId: thread.id,
      event: { type: "run.failed" },
    });
    await waitForCoalesce(sender);

    expect(sentMessages(expo)).toEqual([
      expect.objectContaining({
        title: "Deploy",
        body: "Provider exited with code 1",
        data: expect.objectContaining({ kind: "thread-error" }),
      }),
    ]);
  });

  it("pushes the question text for a new pending interaction and skips answered ones", async () => {
    const { thread } = await seedActiveThread("Release");
    const registered =
      harness.deps.pendingInteractions.registerPendingInteraction({
        interaction: {
          threadId: thread.id,
          turnId: "turn-1",
          providerId: "codex",
          providerThreadId: "provider-thread-1",
          providerRequestId: "request-1",
          payload: createUserQuestionPayload({
            prompt: "Ship to staging or production?",
          }),
        },
      });
    expect(registered.outcome).toBe("created");
    await waitForCoalesce(sender);
    expect(sentMessages(expo)).toEqual([
      expect.objectContaining({
        title: "Release",
        body: "Ship to staging or production?",
        data: expect.objectContaining({ kind: "pending-interaction" }),
      }),
    ]);

    // An approval answered on the desktop before the window closes is silent.
    const other = seedThreadFixture(harness, {
      thread: { status: "active", title: "Other" },
    });
    seedTurnStarted(harness.deps, {
      threadId: other.thread.id,
      turnId: "turn-2",
      providerThreadId: "provider-thread-2",
    });
    const approval =
      harness.deps.pendingInteractions.registerPendingInteraction({
        interaction: {
          threadId: other.thread.id,
          turnId: "turn-2",
          providerId: "codex",
          providerThreadId: "provider-thread-2",
          providerRequestId: "request-2",
          payload: createCommandApprovalPayload({ command: "rm -rf dist" }),
        },
      });
    if (approval.outcome !== "created") {
      throw new Error(`unexpected outcome ${approval.outcome}`);
    }
    // Resolve through the data layer: the lifecycle would need a live daemon.
    setPendingInteractionResolved(harness.db, {
      id: approval.interaction.id,
      resolution: JSON.stringify({ decision: "deny" }),
    });
    await waitForCoalesce(sender);
    expect(sentMessages(expo)).toHaveLength(1);
  });

  it("prefers the interaction over turn-finished when both land together", async () => {
    const { thread } = await seedActiveThread("Both");
    harness.deps.pendingInteractions.registerPendingInteraction({
      interaction: {
        threadId: thread.id,
        turnId: "turn-1",
        providerId: "codex",
        providerThreadId: "provider-thread-1",
        providerRequestId: "request-1",
        payload: createCommandApprovalPayload({ command: "git push" }),
      },
    });
    applyThreadLifecycleEvent(harness.db, harness.hub, {
      threadId: thread.id,
      event: { type: "run.succeeded" },
    });
    await waitForCoalesce(sender);

    expect(sentMessages(expo)).toEqual([
      expect.objectContaining({
        body: "Approve command: git push",
        data: expect.objectContaining({ kind: "pending-interaction" }),
      }),
    ]);
  });

  it("skips archived threads and deletes subscriptions Expo reports as unregistered", async () => {
    upsertPushSubscription(harness.db, {
      expoPushToken: "ExponentPushToken[stale]",
      platform: "ios",
      deviceLabel: "Old phone",
    });
    expo.ticketErrors.set("ExponentPushToken[stale]", "DeviceNotRegistered");

    const archived = await seedActiveThread("Archived");
    applyThreadLifecycleEvent(harness.db, harness.hub, {
      threadId: archived.thread.id,
      event: { type: "run.succeeded" },
    });
    archiveThread(harness.db, harness.hub, archived.thread.id);
    await waitForCoalesce(sender);
    expect(sentMessages(expo)).toEqual([]);

    const live = await seedActiveThread("Live");
    applyThreadLifecycleEvent(harness.db, harness.hub, {
      threadId: live.thread.id,
      event: { type: "run.succeeded" },
    });
    await waitForCoalesce(sender);
    expect(sentMessages(expo)).toHaveLength(2);
    expect(
      listPushSubscriptions(harness.db).map((row) => row.expoPushToken),
    ).toEqual(["ExponentPushToken[phone]"]);
  });

  it("batches more than 100 devices into several Expo requests", async () => {
    for (let index = 0; index < 120; index += 1) {
      upsertPushSubscription(harness.db, {
        expoPushToken: `ExponentPushToken[device-${index}]`,
        platform: "ios",
        deviceLabel: `Device ${index}`,
      });
    }
    const { thread } = await seedActiveThread();
    applyThreadLifecycleEvent(harness.db, harness.hub, {
      threadId: thread.id,
      event: { type: "run.succeeded" },
    });
    await waitForCoalesce(sender);

    expect(expo.requests.map((batch) => batch.length)).toEqual([100, 21]);
  });

  it("stays silent when disabled and survives Expo outages", async () => {
    const disabledExpo = createFakeExpo();
    const disabled = createPushSender({
      db: harness.db,
      hub: harness.hub,
      logger: testLogger,
      enabled: false,
      expoPushUrl: EXPO_URL,
      fetch: disabledExpo.fetch,
      coalesceMs: COALESCE_MS,
    });
    disabled.start();
    const warn = vi.fn();
    sender.stop();
    sender = createPushSender({
      db: harness.db,
      hub: harness.hub,
      logger: { ...testLogger, warn },
      enabled: true,
      expoPushUrl: EXPO_URL,
      fetch: async () => {
        throw new Error("ECONNREFUSED");
      },
      coalesceMs: COALESCE_MS,
    });
    sender.start();

    const { thread } = await seedActiveThread();
    applyThreadLifecycleEvent(harness.db, harness.hub, {
      threadId: thread.id,
      event: { type: "run.succeeded" },
    });
    await waitForCoalesce(sender);
    await waitForCoalesce(disabled);

    expect(disabledExpo.requests).toEqual([]);
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({ count: 1 }),
      "Expo push request failed",
    );
    disabled.stop();
  });
});

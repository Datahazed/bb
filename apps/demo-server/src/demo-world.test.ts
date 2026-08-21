import {
  hostSchema,
  pongMessageSchema,
  resolvedThreadExecutionOptionsSchema,
  threadChangedMessageSchema,
  type ThreadChangedMessage,
} from "@bb/domain";
import {
  sendQueuedMessageResponseSchema,
  sidebarBootstrapResponseSchema,
  systemConfigResponseSchema,
  systemVersionResponseSchema,
  threadChildSummaryResponseSchema,
  threadListResponseSchema,
  threadPendingInteractionsResponseSchema,
  threadQueuedMessageListResponseSchema,
  threadResponseSchema,
  threadTabsResponseSchema,
  threadTimelineResponseSchema,
  type SendMessageRequest,
  type ThreadTimelineResponse,
} from "@bb/server-contract";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  DemoWorld,
  MAX_MESSAGE_CHARS,
  MAX_TURNS_PER_THREAD,
  REPLY_DELAY_MS,
} from "./demo-world.js";
import { DEMO_THREADS } from "./fixtures/timelines.js";

const ORIGIN = "https://demo.example.test";
const THREAD_ID = DEMO_THREADS[0].id;
const EXPECTED_MAX_REQUEST_BYTES = 64 * 1024;
const EXPECTED_MAX_INPUT_PARTS = 32;
const EXPECTED_MAX_QUEUED_MESSAGES = 16;
const EXPECTED_MAX_QUEUED_BYTES = 64 * 1024;

/** A world on a manual clock, so the scripted reply lands when the test says so. */
function createWorld() {
  let now = 1_800_000_000_000;
  const timers: { fn: () => void; at: number }[] = [];
  const notices: ThreadChangedMessage[] = [];
  const world = new DemoWorld({
    now: () => now,
    schedule: (fn, ms) => {
      timers.push({ fn, at: now + ms });
    },
  });
  world.onChanged((message) => notices.push(message));
  const advance = (ms: number) => {
    now += ms;
    for (const timer of timers.splice(0)) {
      if (timer.at <= now) timer.fn();
      else timers.push(timer);
    }
  };
  const get = (path: string) => world.handle(new Request(`${ORIGIN}${path}`));
  const send = (method: string, path: string, body: unknown) =>
    world.handle(
      new Request(`${ORIGIN}${path}`, {
        method,
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
    );
  const sendRaw = (method: string, path: string, body: string) =>
    world.handle(
      new Request(`${ORIGIN}${path}`, {
        method,
        headers: { "content-type": "application/json" },
        body,
      }),
    );
  return { world, get, send, sendRaw, advance, notices, clock: () => now };
}

async function parsed<T>(
  pending: Promise<Response>,
  schema: z.ZodType<T>,
): Promise<T> {
  const response = await pending;
  expect(response.status).toBe(200);
  return schema.parse(await response.json());
}

function sendBody(text: string): SendMessageRequest {
  return { input: [{ type: "text", text, mentions: [] }], mode: "auto" };
}

function texts(timeline: ThreadTimelineResponse): string[] {
  return timeline.rows.flatMap((row) =>
    row.kind === "conversation"
      ? [`${row.role}: ${row.text.split("\n")[0]}`]
      : [],
  );
}

describe("demo world routes", () => {
  it("answers every launch-path route with a body the contract accepts", async () => {
    const { get } = createWorld();
    const config = await parsed(
      get("/api/v1/system/config"),
      systemConfigResponseSchema,
    );
    expect(config.serverUrl).toBe(ORIGIN);
    expect(await (await get("/health")).json()).toEqual({ ok: true });
    await parsed(get("/api/v1/system/version"), systemVersionResponseSchema);
    await parsed(get("/api/v1/hosts"), z.array(hostSchema));
    const bootstrap = await parsed(
      get("/api/v1/sidebar-bootstrap"),
      sidebarBootstrapResponseSchema,
    );
    expect(bootstrap.projects[0].threads.map((thread) => thread.title)).toEqual(
      DEMO_THREADS.map((seed) => seed.title),
    );
    await parsed(get("/api/v1/threads"), threadListResponseSchema);
    await parsed(get(`/api/v1/threads/${THREAD_ID}`), threadResponseSchema);
    await parsed(
      get(`/api/v1/threads/${THREAD_ID}/interactions`),
      threadPendingInteractionsResponseSchema,
    );
    await parsed(
      get(`/api/v1/threads/${THREAD_ID}/queued-messages`),
      threadQueuedMessageListResponseSchema,
    );
    await parsed(
      get(`/api/v1/threads/${THREAD_ID}/tabs`),
      threadTabsResponseSchema,
    );
    await parsed(
      get(`/api/v1/threads/${THREAD_ID}/default-execution-options`),
      resolvedThreadExecutionOptionsSchema,
    );
    await parsed(
      get(`/api/v1/threads/${THREAD_ID}/child-summary`),
      threadChildSummaryResponseSchema,
    );
  });

  it("serves every seeded timeline in contract shape, oldest first", async () => {
    const { get, clock } = createWorld();
    for (const seed of DEMO_THREADS) {
      const timeline = await parsed(
        get(`/api/v1/threads/${seed.id}/timeline?limit=20`),
        threadTimelineResponseSchema,
      );
      expect(timeline.rows.length).toBeGreaterThan(1);
      expect(timeline.maxSeq).toBe(timeline.rows.length);
      const seqs = timeline.rows.map((row) => row.sourceSeqStart);
      expect(seqs).toEqual([...seqs].sort((a, b) => a - b));
      for (const row of timeline.rows)
        expect(row.startedAt).toBeLessThan(clock());
    }
  });

  it("answers unknown routes with 501, unknown threads with 404, bad bodies with 400", async () => {
    const { get, send } = createWorld();
    const unknown = await get("/api/v1/projects/proj_demo00000001/branches");
    expect(unknown.status).toBe(501);
    expect(await unknown.json()).toMatchObject({
      error: { code: "not_implemented" },
    });
    expect((await get("/api/v1/threads/thr_nope/timeline")).status).toBe(404);
    expect(
      (await send("POST", `/api/v1/threads/${THREAD_ID}/send`, { text: "x" }))
        .status,
    ).toBe(400);
  });

  it("echoes a tabs write with the next revision", async () => {
    const { send } = createWorld();
    const tabs = await parsed(
      send("PUT", `/api/v1/threads/${THREAD_ID}/tabs`, {
        expectedRevision: 3,
        tabs: [],
      }),
      threadTabsResponseSchema,
    );
    expect(tabs.revision).toBe(4);
  });
});

describe("sending a message", () => {
  it("rejects request bodies and prompt part arrays beyond the demo limits", async () => {
    const { send, sendRaw } = createWorld();
    const oversizedBody = await sendRaw(
      "POST",
      `/api/v1/threads/${THREAD_ID}/send`,
      JSON.stringify(sendBody("x".repeat(EXPECTED_MAX_REQUEST_BYTES))),
    );
    expect(oversizedBody.status).toBe(413);
    expect(await oversizedBody.json()).toMatchObject({
      code: "invalid_request",
    });

    const tooManyParts = await send(
      "POST",
      `/api/v1/threads/${THREAD_ID}/send`,
      {
        input: Array.from({ length: EXPECTED_MAX_INPUT_PARTS + 1 }, () => ({
          type: "text" as const,
          text: "x",
          mentions: [],
        })),
        mode: "auto",
      },
    );
    expect(tooManyParts.status).toBe(413);
    expect(await tooManyParts.json()).toMatchObject({
      code: "invalid_request",
    });
  });

  it("shows the user row at once, then the scripted reply after the delay", async () => {
    const { get, send, advance, notices, clock } = createWorld();
    const sentAt = clock();
    expect(
      (
        await send(
          "POST",
          `/api/v1/threads/${THREAD_ID}/send`,
          sendBody("Yes, go ahead."),
        )
      ).status,
    ).toBe(200);

    let thread = await parsed(
      get(`/api/v1/threads/${THREAD_ID}`),
      threadResponseSchema,
    );
    expect(thread.status).toBe("active");
    expect(thread.runtime.displayStatus).toBe("active");
    let timeline = await parsed(
      get(`/api/v1/threads/${THREAD_ID}/timeline`),
      threadTimelineResponseSchema,
    );
    expect(texts(timeline).at(-1)).toBe("user: Yes, go ahead.");
    // The app stamps its optimistic row with the device clock; the server's
    // row must not sort before it.
    expect(timeline.rows.at(-1)?.startedAt).toBe(sentAt);
    expect(notices.map((notice) => notice.changes)).toEqual([
      ["events-appended", "status-changed"],
    ]);
    for (const notice of notices) threadChangedMessageSchema.parse(notice);

    advance(REPLY_DELAY_MS - 1);
    timeline = await parsed(
      get(`/api/v1/threads/${THREAD_ID}/timeline`),
      threadTimelineResponseSchema,
    );
    expect(texts(timeline).at(-1)).toBe("user: Yes, go ahead.");

    advance(1);
    expect(notices).toHaveLength(2);
    thread = await parsed(
      get(`/api/v1/threads/${THREAD_ID}`),
      threadResponseSchema,
    );
    expect(thread.status).toBe("idle");
    timeline = await parsed(
      get(`/api/v1/threads/${THREAD_ID}/timeline`),
      threadTimelineResponseSchema,
    );
    expect(texts(timeline).slice(-2)).toEqual([
      "user: Yes, go ahead.",
      "assistant: That change is straightforward.",
    ]);
    expect(timeline.rows.at(-2)?.kind).toBe("work");
    expect(timeline.maxSeq).toBe(timeline.rows.length);
    // The sidebar reflects the new activity too.
    const bootstrap = await parsed(
      get("/api/v1/sidebar-bootstrap"),
      sidebarBootstrapResponseSchema,
    );
    expect(bootstrap.projects[0].threads[0].updatedAt).toBe(sentAt);
  });

  it("lands the pending reply when the thread is stopped", async () => {
    const { get, send } = createWorld();
    await send("POST", `/api/v1/threads/${THREAD_ID}/send`, sendBody("Go."));
    expect(
      (await send("POST", `/api/v1/threads/${THREAD_ID}/stop`, {})).status,
    ).toBe(200);
    const thread = await parsed(
      get(`/api/v1/threads/${THREAD_ID}`),
      threadResponseSchema,
    );
    expect(thread.status).toBe("idle");
    const timeline = await parsed(
      get(`/api/v1/threads/${THREAD_ID}/timeline`),
      threadTimelineResponseSchema,
    );
    expect(texts(timeline).at(-1)).toMatch(/^assistant:/u);
  });

  it("queues, then sends a queued message as a turn", async () => {
    const { get, send, notices } = createWorld();
    const queued = await parsed(
      send("POST", `/api/v1/threads/${THREAD_ID}/queued-messages`, {
        input: [{ type: "text", text: "Later.", mentions: [] }],
      }),
      threadQueuedMessageListResponseSchema.element,
    );
    expect(
      await parsed(
        get(`/api/v1/threads/${THREAD_ID}/queued-messages`),
        threadQueuedMessageListResponseSchema,
      ),
    ).toEqual([queued]);
    await parsed(
      send(
        "POST",
        `/api/v1/threads/${THREAD_ID}/queued-messages/${queued.id}/send`,
        {
          mode: "steer",
        },
      ),
      sendQueuedMessageResponseSchema,
    );
    expect(
      await parsed(
        get(`/api/v1/threads/${THREAD_ID}/queued-messages`),
        threadQueuedMessageListResponseSchema,
      ),
    ).toEqual([]);
    const timeline = await parsed(
      get(`/api/v1/threads/${THREAD_ID}/timeline`),
      threadTimelineResponseSchema,
    );
    expect(texts(timeline).at(-1)).toBe("user: Later.");
    expect(notices.map((notice) => notice.changes[0])).toEqual([
      "queue-changed",
      "queue-changed",
      "events-appended",
    ]);
  });

  it("rejects queued messages before retained entry or byte limits are exceeded", async () => {
    const { get, send } = createWorld();
    for (let index = 0; index < EXPECTED_MAX_QUEUED_MESSAGES; index += 1) {
      expect(
        (
          await send("POST", `/api/v1/threads/${THREAD_ID}/queued-messages`, {
            input: [{ type: "text", text: `Later ${index}.`, mentions: [] }],
          })
        ).status,
      ).toBe(200);
    }
    const full = await send(
      "POST",
      `/api/v1/threads/${THREAD_ID}/queued-messages`,
      { input: [{ type: "text", text: "One too many.", mentions: [] }] },
    );
    expect(full.status).toBe(409);
    expect(await full.json()).toMatchObject({ code: "queue_full" });
    expect(
      await parsed(
        get(`/api/v1/threads/${THREAD_ID}/queued-messages`),
        threadQueuedMessageListResponseSchema,
      ),
    ).toHaveLength(EXPECTED_MAX_QUEUED_MESSAGES);

    const otherThreadId = DEMO_THREADS[1].id;
    const halfLimit = "x".repeat(EXPECTED_MAX_QUEUED_BYTES / 2);
    expect(
      (
        await send("POST", `/api/v1/threads/${otherThreadId}/queued-messages`, {
          input: [{ type: "text", text: halfLimit, mentions: [] }],
        })
      ).status,
    ).toBe(200);
    const tooManyBytes = await send(
      "POST",
      `/api/v1/threads/${otherThreadId}/queued-messages`,
      { input: [{ type: "text", text: halfLimit, mentions: [] }] },
    );
    expect(tooManyBytes.status).toBe(409);
    expect(await tooManyBytes.json()).toMatchObject({ code: "queue_full" });
    expect(
      await parsed(
        get(`/api/v1/threads/${otherThreadId}/queued-messages`),
        threadQueuedMessageListResponseSchema,
      ),
    ).toHaveLength(1);
  });

  it("caps message length and the number of turns it keeps", async () => {
    const { get, send, advance } = createWorld();
    await send(
      "POST",
      `/api/v1/threads/${THREAD_ID}/send`,
      sendBody("x".repeat(MAX_MESSAGE_CHARS + 10)),
    );
    let timeline = await parsed(
      get(`/api/v1/threads/${THREAD_ID}/timeline`),
      threadTimelineResponseSchema,
    );
    const last = timeline.rows.at(-1);
    expect(last?.kind === "conversation" && last.text.length).toBe(
      MAX_MESSAGE_CHARS,
    );

    for (let index = 0; index < MAX_TURNS_PER_THREAD + 5; index += 1) {
      await send(
        "POST",
        `/api/v1/threads/${THREAD_ID}/send`,
        sendBody(`turn ${index}`),
      );
      advance(REPLY_DELAY_MS);
    }
    timeline = await parsed(
      get(`/api/v1/threads/${THREAD_ID}/timeline`),
      threadTimelineResponseSchema,
    );
    const seeded = DEMO_THREADS[0].rows(THREAD_ID, 0).length;
    expect(timeline.rows.length).toBe(seeded + MAX_TURNS_PER_THREAD * 3);
    expect(texts(timeline).at(-2)).toBe(
      `user: turn ${MAX_TURNS_PER_THREAD + 4}`,
    );
  });
});

describe("socket frames", () => {
  it("answers ping with pong and ignores subscriptions", () => {
    const { world } = createWorld();
    const pong = world.socketReply(JSON.stringify({ type: "ping" }));
    expect(pong).not.toBeNull();
    pongMessageSchema.parse(JSON.parse(pong ?? ""));
    expect(
      world.socketReply(
        JSON.stringify({
          type: "subscribe",
          target: { kind: "thread", threadId: THREAD_ID },
        }),
      ),
    ).toBeNull();
    expect(world.socketReply("not json")).toBeNull();
  });
});

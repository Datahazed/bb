import { describe, expect, it } from "vitest";
import {
  encodeClientTurnRequestIdNumber,
  threadScope,
  turnScope,
} from "@bb/domain";
import { insertEvents } from "@bb/db";
import {
  applyTimelineDelta,
  threadTimelineResponseSchema,
  type ThreadTimelineResponse,
} from "@bb/server-contract";
import { readJson } from "../helpers/json.js";
import { seedEvent, seedThreadFixture } from "../helpers/seed.js";
import { withTestHarness } from "../helpers/test-app.js";
import type { TestAppHarness } from "../helpers/test-app.js";
import { DEFAULT_MAX_INLINE_OUTPUT_CHARS } from "../../src/services/threads/timeline-output-truncation.js";

async function getTimeline(
  harness: TestAppHarness,
  threadId: string,
  afterSequence?: number,
): Promise<ThreadTimelineResponse> {
  const url =
    afterSequence === undefined
      ? `/api/v1/threads/${threadId}/timeline`
      : `/api/v1/threads/${threadId}/timeline?afterSequence=${afterSequence}`;
  const response = await harness.app.request(url);
  if (response.status !== 200) {
    throw new Error(
      `timeline ${url} -> ${response.status}: ${await response.text()}`,
    );
  }
  return threadTimelineResponseSchema.parse(await readJson(response));
}

describe("GET /threads/:id/timeline?afterSequence (row-patch delta)", () => {
  it("keeps a long active turn bounded and sends only cached row changes", async () => {
    await withTestHarness(async (harness) => {
      const { thread } = seedThreadFixture(harness, {
        thread: { status: "active" },
      });
      const clientRequestId = encodeClientTurnRequestIdNumber({ value: 1 });
      const outputCount = 840;
      insertEvents(harness.deps.db, harness.hub, [
        {
          threadId: thread.id,
          sequence: 1,
          type: "client/turn/requested",
          scope: threadScope(),
          itemId: null,
          itemKind: null,
          data: JSON.stringify({
            direction: "outbound",
            execution: {
              model: "gpt-5",
              permissionMode: "full",
              reasoningLevel: "medium",
              serviceTier: "default",
              source: "client/turn/requested",
            },
            initiator: "user",
            input: [
              {
                type: "text",
                text: "Run for several hours.",
                mentions: [],
              },
            ],
            request: { method: "thread/start", params: {} },
            requestId: clientRequestId,
            senderThreadId: null,
            source: "spawn",
            target: { kind: "thread-start" },
          }),
        },
        {
          threadId: thread.id,
          sequence: 2,
          type: "turn/started",
          scope: turnScope("long-active-turn"),
          providerThreadId: "provider-thread",
          itemId: null,
          itemKind: null,
          data: JSON.stringify({}),
        },
        {
          threadId: thread.id,
          sequence: 3,
          type: "turn/input/accepted",
          scope: turnScope("long-active-turn"),
          providerThreadId: "provider-thread",
          itemId: null,
          itemKind: null,
          data: JSON.stringify({ clientRequestId }),
        },
        {
          threadId: thread.id,
          sequence: 4,
          type: "item/started",
          scope: turnScope("long-active-turn"),
          providerThreadId: "provider-thread",
          itemId: "long-active-command",
          itemKind: "commandExecution",
          data: JSON.stringify({
            item: {
              type: "commandExecution",
              id: "long-active-command",
              command: "long-running-command",
              cwd: "/repo",
              status: "pending",
              approvalStatus: null,
            },
          }),
        },
        ...Array.from({ length: outputCount }, (_, index) => ({
          threadId: thread.id,
          sequence: index + 5,
          type: "item/commandExecution/outputDelta" as const,
          scope: turnScope("long-active-turn"),
          providerThreadId: "provider-thread",
          itemId: "long-active-command",
          itemKind: "commandExecution" as const,
          data: JSON.stringify({
            itemId: "long-active-command",
            delta: `cached chunk ${index} ${"x".repeat(256)}\n`,
          }),
        })),
      ]);

      const before = await getTimeline(harness, thread.id);
      const prompt = before.rows.find(
        (row) => row.kind === "conversation" && row.role === "user",
      );
      const pendingCommand = before.rows.find(
        (row) =>
          row.kind === "work" &&
          row.workKind === "command" &&
          row.callId === "long-active-command",
      );
      const beforeSummary = before.rows.find((row) => row.kind === "turn");
      expect(prompt).toBeDefined();
      expect(pendingCommand).toMatchObject({ status: "pending" });
      expect(beforeSummary).toBeDefined();
      expect(before.rows.length).toBeLessThan(20);
      if (
        !pendingCommand ||
        pendingCommand.kind !== "work" ||
        pendingCommand.workKind !== "command"
      ) {
        throw new Error("Expected pending command");
      }
      expect(pendingCommand.output.length).toBeGreaterThanOrEqual(
        DEFAULT_MAX_INLINE_OUTPUT_CHARS,
      );
      expect(pendingCommand.output.length).toBeLessThan(
        DEFAULT_MAX_INLINE_OUTPUT_CHARS + 200,
      );
      expect(JSON.stringify(before).length).toBeLessThan(50_000);

      insertEvents(harness.deps.db, harness.hub, [
        {
          threadId: thread.id,
          sequence: outputCount + 5,
          type: "item/commandExecution/outputDelta",
          scope: turnScope("long-active-turn"),
          providerThreadId: "provider-thread",
          itemId: "long-active-command",
          itemKind: "commandExecution",
          data: JSON.stringify({
            itemId: "long-active-command",
            delta: "one cached update\n",
          }),
        },
      ]);

      const delta = await getTimeline(harness, thread.id, before.maxSeq);
      expect(delta.rows).toHaveLength(0);
      expect(delta.delta).toBeDefined();
      expect(delta.delta?.upsertRows.length).toBeGreaterThan(0);
      expect(delta.delta?.upsertRows.map((row) => row.id)).not.toContain(
        prompt?.id,
      );

      const merged = applyTimelineDelta(before.rows, delta.delta!);
      const fresh = await getTimeline(harness, thread.id);
      expect(merged).toEqual(fresh.rows);
      const afterSummary = merged?.find((row) => row.kind === "turn");
      expect(afterSummary?.id).toBe(beforeSummary?.id);
      expect(afterSummary?.sourceSeqEnd).toBeGreaterThan(
        beforeSummary?.sourceSeqEnd ?? 0,
      );
      expect(JSON.stringify(delta).length).toBeLessThan(50_000);
      expect(JSON.stringify(delta).length).toBeLessThan(
        JSON.stringify(fresh).length,
      );
    });
  });

  it("a full fetch carries no delta and echoes maxSeq", async () => {
    await withTestHarness(async (harness) => {
      const { environment, thread } = seedThreadFixture(harness);
      seedEvent(harness.deps, {
        threadId: thread.id,
        environmentId: environment.id,
        sequence: 1,
        type: "system/manager/user_message",
        scope: threadScope(),
        data: { text: "hello" },
      });

      const full = await getTimeline(harness, thread.id);
      expect(full.delta).toBeUndefined();
      expect(full.rows.length).toBeGreaterThan(0);
      expect(full.maxSeq).toBe(1);
    });
  });

  it("delta + merge reproduces a fresh full window when rows are appended", async () => {
    await withTestHarness(async (harness) => {
      const { environment, thread } = seedThreadFixture(harness);
      seedEvent(harness.deps, {
        threadId: thread.id,
        environmentId: environment.id,
        providerThreadId: "p1",
        scope: turnScope("turn-1"),
        sequence: 1,
        type: "turn/started",
        data: {},
      });
      seedEvent(harness.deps, {
        threadId: thread.id,
        environmentId: environment.id,
        providerThreadId: "p1",
        scope: turnScope("turn-1"),
        sequence: 2,
        type: "item/completed",
        data: {
          item: {
            type: "toolCall",
            id: "tool-1",
            tool: "exec_command",
            arguments: { cmd: "pnpm test" },
            status: "completed",
          },
        },
      });

      const before = await getTimeline(harness, thread.id);

      // Append another item to the active turn.
      seedEvent(harness.deps, {
        threadId: thread.id,
        environmentId: environment.id,
        providerThreadId: "p1",
        scope: turnScope("turn-1"),
        sequence: 3,
        type: "item/completed",
        data: {
          item: { type: "agentMessage", id: "assistant-1", text: "Done." },
        },
      });

      const delta = await getTimeline(harness, thread.id, before.maxSeq);
      expect(delta.delta).toBeDefined();
      expect(delta.rows).toHaveLength(0);
      expect(delta.maxSeq).toBe(3);
      expect(delta.delta!.upsertRows.length).toBeGreaterThan(0);

      const merged = applyTimelineDelta(before.rows, delta.delta!);
      const fresh = await getTimeline(harness, thread.id);
      expect(merged).toEqual(fresh.rows);
    });
  });

  it("delta + merge reproduces a fresh full window when a turn completes (collapse)", async () => {
    await withTestHarness(async (harness) => {
      const { environment, thread } = seedThreadFixture(harness);
      const turn = {
        threadId: thread.id,
        environmentId: environment.id,
        providerThreadId: "p1",
        scope: turnScope("turn-1"),
      } as const;
      seedEvent(harness.deps, {
        ...turn,
        sequence: 1,
        type: "turn/started",
        data: {},
      });
      seedEvent(harness.deps, {
        ...turn,
        sequence: 2,
        type: "item/completed",
        data: {
          item: {
            type: "toolCall",
            id: "tool-1",
            tool: "exec_command",
            arguments: { cmd: "ls" },
            status: "completed",
          },
        },
      });
      seedEvent(harness.deps, {
        ...turn,
        sequence: 3,
        type: "item/completed",
        data: {
          item: { type: "agentMessage", id: "assistant-1", text: "First." },
        },
      });

      // Active turn: rows are expanded.
      const before = await getTimeline(harness, thread.id);

      // Complete the turn -> the projection collapses the turn's rows.
      seedEvent(harness.deps, {
        ...turn,
        sequence: 4,
        type: "turn/completed",
        data: { status: "completed" },
      });

      const delta = await getTimeline(harness, thread.id, before.maxSeq);
      expect(delta.delta).toBeDefined();

      const merged = applyTimelineDelta(before.rows, delta.delta!);
      const fresh = await getTimeline(harness, thread.id);
      expect(merged).not.toBeNull();
      expect(merged).toEqual(fresh.rows);
      // The collapse genuinely changed the window (different row ids/content),
      // and a row the client held was dropped — i.e. the delta exercised removal,
      // not just upsert. Otherwise the test proves nothing.
      expect(fresh.rows).not.toEqual(before.rows);
      const beforeIds = new Set(before.rows.map((row) => row.id));
      const freshIds = new Set(fresh.rows.map((row) => row.id));
      expect([...beforeIds].some((id) => !freshIds.has(id))).toBe(true);
    });
  });

  it("a no-op delta (no new events) returns an empty patch and merges to the same rows", async () => {
    await withTestHarness(async (harness) => {
      const { environment, thread } = seedThreadFixture(harness);
      seedEvent(harness.deps, {
        threadId: thread.id,
        environmentId: environment.id,
        sequence: 1,
        type: "system/manager/user_message",
        scope: threadScope(),
        data: { text: "hello" },
      });

      const before = await getTimeline(harness, thread.id);
      const delta = await getTimeline(harness, thread.id, before.maxSeq);
      expect(delta.delta).toBeDefined();
      expect(delta.delta!.upsertRows).toHaveLength(0);
      expect(delta.delta!.rowOrder).toBeUndefined();
      expect(applyTimelineDelta(before.rows, delta.delta!)).toEqual(
        before.rows,
      );
    });
  });
});

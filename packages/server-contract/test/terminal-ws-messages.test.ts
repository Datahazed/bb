/**
 * Contract tripwire — single-host rebuild plan §6 Phase 0 / §4.2.
 *
 * Pins the literal terminal WS message shapes (src/api-types.ts) spoken at
 * /ws/threads/:threadId/terminals/:terminalId. The frozen frontend terminal
 * view is the consumer: both directions are `.strict()`, so a renamed, added,
 * or removed field — or a new accepted `close` reason — changes what the
 * frozen client sends/receives and must be a deliberate contract decision.
 * (The existing contract.test.ts "public terminal contracts" block covers
 * cols/rows/dataBase64 bounds; this file pins the message envelopes.)
 */
import { describe, expect, it } from "vitest";
import {
  terminalClientMessageSchema,
  terminalServerMessageSchema,
  terminalSessionSchema,
  type TerminalClientMessage,
  type TerminalServerMessage,
  type TerminalSession,
} from "../src/index.js";

const runningSession: TerminalSession = {
  id: "term_1",
  threadId: "thr_1",
  environmentId: "env_1",
  hostId: "host_1",
  title: "Terminal 1",
  initialCwd: "/workspace/repo",
  currentCwd: "/workspace/repo/src",
  cols: 120,
  rows: 40,
  status: "running",
  exitCode: null,
  closeReason: null,
  createdAt: 1_700_000_000_000,
  updatedAt: 1_700_000_001_000,
  lastUserInputAt: 1_700_000_000_500,
};

const exitedSession: TerminalSession = {
  ...runningSession,
  status: "exited",
  exitCode: 0,
  closeReason: "user",
  lastUserInputAt: null,
};

const clientMessages: TerminalClientMessage[] = [
  { type: "input", dataBase64: "aGVsbG8=" },
  { type: "resize", cols: 120, rows: 40 },
  { type: "close", reason: "user" },
  { type: "ping" },
];

const serverMessages: TerminalServerMessage[] = [
  { type: "attached", session: runningSession, nextSeq: 12 },
  { type: "output", chunk: { seq: 12, dataBase64: "aGVsbG8=" } },
  { type: "session-updated", session: runningSession },
  { type: "exited", session: exitedSession },
  { type: "error", code: "terminal_not_found", message: "Terminal not found" },
  { type: "pong" },
];

describe("terminal WS message contracts", () => {
  it("declares exactly the frozen message variants in both directions", () => {
    expect(
      terminalClientMessageSchema.options.map(
        (option) => option.shape.type.value,
      ),
    ).toEqual(["input", "resize", "close", "ping"]);
    expect(
      terminalServerMessageSchema.options.map(
        (option) => option.shape.type.value,
      ),
    ).toEqual([
      "attached",
      "output",
      "session-updated",
      "exited",
      "error",
      "pong",
    ]);
  });

  it.each(clientMessages)(
    "client $type parses verbatim and rejects extra keys",
    (message) => {
      expect(terminalClientMessageSchema.parse(message)).toEqual(message);
      expect(
        terminalClientMessageSchema.safeParse({
          ...message,
          unexpected: true,
        }).success,
      ).toBe(false);
    },
  );

  it.each(serverMessages)(
    "server $type parses verbatim and rejects extra keys",
    (message) => {
      expect(terminalServerMessageSchema.parse(message)).toEqual(message);
      expect(
        terminalServerMessageSchema.safeParse({
          ...message,
          unexpected: true,
        }).success,
      ).toBe(false);
    },
  );

  it("close accepts only reason 'user'", () => {
    // The other close reasons stay alive as dead enum values on
    // terminalSessionCloseReasonSchema (server-emitted session state), but
    // the client close message must never accept them.
    const rejectedReasons = [
      "process-exit",
      "daemon-disconnect",
      "environment-destroyed",
      "thread-archived",
      "thread-deleted",
      "open-timeout",
      "server-restarted",
    ];
    for (const reason of rejectedReasons) {
      expect(
        terminalClientMessageSchema.safeParse({ type: "close", reason })
          .success,
      ).toBe(false);
    }
    expect(
      terminalClientMessageSchema.safeParse({ type: "close" }).success,
    ).toBe(false);
  });

  it("requires session.hostId in server payloads", () => {
    const { hostId: _omittedHostId, ...sessionWithoutHostId } = runningSession;
    expect(
      terminalServerMessageSchema.safeParse({
        type: "attached",
        session: sessionWithoutHostId,
        nextSeq: 0,
      }).success,
    ).toBe(false);
  });

  it("terminalSessionSchema declares exactly the frozen session fields", () => {
    // terminalSessionSchema is NOT .strict(), so a renamed field would still
    // parse old fixtures — pin the field inventory explicitly. The frozen FE
    // renders all of these from `attached`/`session-updated`/`exited`.
    expect(Object.keys(terminalSessionSchema.shape).sort()).toEqual([
      "closeReason",
      "cols",
      "createdAt",
      "currentCwd",
      "environmentId",
      "exitCode",
      "hostId",
      "id",
      "initialCwd",
      "lastUserInputAt",
      "rows",
      "status",
      "threadId",
      "title",
      "updatedAt",
    ]);
  });
});

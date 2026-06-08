/**
 * Kill-9 matrix: SIGKILL with an open terminal (plan §8). Terminal runtimes
 * (ptys) die with the process; boot reconciliation must mark every open
 * session row exited before the restarted server accepts requests. Exited
 * sessions vanish from the list route (the UI's view), so the row state is
 * asserted directly against the on-disk database.
 */
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createConnection, terminalSessions } from "@bb/db";
import {
  terminalSessionSchema,
  threadTerminalListResponseSchema,
} from "@bb/server-contract";
import { eq } from "drizzle-orm";
import {
  withCrashServerHarness,
  type CrashServerHarness,
} from "../../helpers/crash-server.js";
import { createCrashThread } from "./shared.js";

async function openTerminal(harness: CrashServerHarness, threadId: string) {
  const response = await harness.api.threads[":id"].terminals.$post({
    param: { id: threadId },
    json: { cols: 80, rows: 24 },
  });
  expect(response.status).toBe(201);
  return terminalSessionSchema.parse(await response.json());
}

async function listTerminals(harness: CrashServerHarness, threadId: string) {
  const response = await harness.api.threads[":id"].terminals.$get({
    param: { id: threadId },
  });
  expect(response.status).toBe(200);
  return threadTerminalListResponseSchema.parse(await response.json())
    .sessions;
}

function readStoredSession(harness: CrashServerHarness, sessionId: string) {
  const db = createConnection(path.join(harness.dataDir, "bb.db"));
  try {
    return db
      .select()
      .from(terminalSessions)
      .where(eq(terminalSessions.id, sessionId))
      .get();
  } finally {
    db.$client.close();
  }
}

describe.sequential("kill-9 boot reconciliation: open terminal", () => {
  it("marks the orphaned terminal session exited on restart", () =>
    withCrashServerHarness({}, async (harness) => {
      const { thread } = await createCrashThread(
        harness,
        "Kill9 Open Terminal",
      );

      const session = await openTerminal(harness, thread.id);
      expect(["starting", "running"]).toContain(session.status);
      expect(await listTerminals(harness, thread.id)).toHaveLength(1);

      await harness.crash();
      await harness.restart();

      // The UI's view: nothing is open anymore.
      expect(await listTerminals(harness, thread.id)).toEqual([]);

      const stored = readStoredSession(harness, session.id);
      if (!stored) {
        throw new Error("Expected the terminal session row to survive");
      }
      expect(stored.status).toBe("exited");
      expect(stored.exitedAt).toEqual(expect.any(Number));
      // The frozen wire close reason the FE already accepts (plan §4.2
      // dead-value rule).
      expect(stored.closeReason).toBe("daemon-disconnect");
    }));
});

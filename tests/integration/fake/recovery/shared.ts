/**
 * Boot-reconciliation (kill-9) suite shared helpers — the Phase 2 rewrite of
 * the daemon-era recovery suite (plan §6 Phase 2, §8 kill-9 matrix). Each
 * test SIGKILLs a real out-of-process server (`crash-server.ts`) mid-flight
 * and asserts what boot reconciliation settles on restart against the same
 * on-disk SQLite state.
 *
 * Daemon-era files this suite replaces, and where each scenario went:
 * - `active-crash-recovery` / `graceful-restart` / `idle-crash-restart` /
 *   `managed-crash-restart` / `managed-graceful-restart` →
 *   `kill9-mid-turn.test.ts` and `kill9-mid-provision.test.ts` (there is no
 *   daemon to lose separately anymore: a crash is a server crash, and
 *   "graceful restart keeps threads alive" died with the process split —
 *   every restart interrupts cleanly with `server-restarted`, plan
 *   Decision 2).
 * - `idle-error-reconciliation` → the dangling-state passes asserted across
 *   the matrix plus the unit matrix in
 *   `apps/server/test/lifecycle/boot-reconciliation.test.ts`.
 * - `offline-queue` → deleted with no replacement: the durable command queue
 *   and host-offline buffering do not exist in a single process.
 * - `session-continuity` → deleted with no replacement: daemon session
 *   leases/handshakes do not exist; provider-session resume after restart is
 *   asserted by the re-send step of `kill9-mid-turn.test.ts`.
 */
import { expect } from "vitest";
import type { Thread } from "@bb/domain";
import type {
  ThreadTimelineResponse,
  TimelineRow,
} from "@bb/server-contract";
import { getThreadEvents, getThreadTimeline } from "../../helpers/api.js";
import { waitForThreadStatus } from "../../helpers/assertions.js";
import {
  createProjectFixture,
  createReadyHostThread,
  type ReadyThreadFixture,
} from "../../helpers/fixtures.js";
import type { CrashServerHarness } from "../../helpers/crash-server.js";
import { scaleTimeoutMs } from "../../helpers/time.js";

// Setup waits: child-process server boot + thread provisioning are heavier
// than the in-process harness.
export const DEFAULT_TIMEOUT_MS = scaleTimeoutMs(30_000);
// Whole-turn waits for the fake provider.
export const TURN_TIMEOUT_MS = scaleTimeoutMs(20_000);
// Catch a turn in flight before the crash step.
export const ACTIVE_TIMEOUT_MS = scaleTimeoutMs(10_000);
// Recovery waits: restart + boot reconciliation + sweep re-drives, plus the
// orphaned provider's pending turn timer (HOLD_TURN_TEXT) firing into its
// broken pipe.
export const RECOVERY_TIMEOUT_MS = scaleTimeoutMs(45_000);
// Hold the turn long enough to observe `active` and SIGKILL mid-turn.
export const HOLD_TURN_TEXT = "delay:15000 hold for the crash";

export type CrashWorkspaceType = "unmanaged" | "managed-worktree";

export async function createCrashThread(
  harness: CrashServerHarness,
  name: string,
  workspaceType: CrashWorkspaceType = "unmanaged",
): Promise<ReadyThreadFixture> {
  const project = await createProjectFixture(harness, { name });
  const workspace =
    workspaceType === "unmanaged"
      ? { type: "unmanaged" as const, path: harness.repoDir }
      : { type: "managed-worktree" as const };
  return createReadyHostThread(harness, {
    projectId: project.id,
    timeoutMs: DEFAULT_TIMEOUT_MS,
    workspace,
  });
}

function collectTimelineRows(rows: readonly TimelineRow[]): TimelineRow[] {
  const collected: TimelineRow[] = [];
  for (const row of rows) {
    collected.push(row);
    if (row.kind === "turn" && row.children) {
      collected.push(...collectTimelineRows(row.children));
    }
  }
  return collected;
}

function findThreadInterruptedRow(
  timeline: ThreadTimelineResponse,
): TimelineRow | null {
  return (
    collectTimelineRows(timeline.rows).find(
      (row) =>
        row.kind === "system" &&
        row.systemKind === "operation" &&
        row.operationKind === "thread-interrupted",
    ) ?? null
  );
}

/**
 * The full `server-restarted` interruption contract a restarted server must
 * present for a previously-active thread: idle status, no pending stop, the
 * interruption + interrupted-turn events, and the timeline operation row the
 * frozen FE renders (thread-view `threadInterruptedTitle`, plan §5.8.3).
 */
export async function expectServerRestartedInterruption(
  harness: CrashServerHarness,
  threadId: string,
  options: { expectInterruptedTurn: boolean },
): Promise<Thread> {
  const thread = await waitForThreadStatus(
    harness.api,
    threadId,
    "idle",
    RECOVERY_TIMEOUT_MS,
  );
  expect(thread.stopRequestedAt).toBeNull();

  const events = await getThreadEvents(harness.api, threadId);
  expect(
    events.some(
      (event) =>
        event.type === "system/thread/interrupted" &&
        event.data.reason === "server-restarted",
    ),
  ).toBe(true);
  expect(
    events.some(
      (event) =>
        event.type === "turn/completed" &&
        event.data.status === "interrupted",
    ),
  ).toBe(options.expectInterruptedTurn);
  expect(events.some((event) => event.type === "system/error")).toBe(false);

  const interruptedRow = findThreadInterruptedRow(
    await getThreadTimeline(harness.api, threadId),
  );
  if (!interruptedRow || interruptedRow.kind !== "system") {
    throw new Error("Expected a thread-interrupted timeline row");
  }
  expect(interruptedRow.title).toBe("Server restarted");

  return thread;
}

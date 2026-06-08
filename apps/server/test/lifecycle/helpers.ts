/**
 * Shared plumbing for the Phase 2 lifecycle suites — the replacement for the
 * quarantined queue-era `test/threads/thread-lifecycle.test.ts` (plan §6
 * Phase 2, P1b→P1c handoff note 2).
 *
 * Settlement timing rule (P1b→P1c handoff note 3): lifecycle continuations
 * run one microtask after an engine command settles, and detached follow-ups
 * (`scheduleDetachedWork`) run a macrotask later. Post-settlement assertions
 * must `await settleLifecycleWork(harness)` first.
 */
import { setTimeout as sleep } from "node:timers/promises";
import { getThread, listEvents } from "@bb/db";
import type { Thread } from "@bb/domain";
import type { TestAppHarness } from "../helpers/test-app.js";
import {
  seedEnvironment,
  seedHostSession,
  seedProjectWithSource,
  seedThread,
  seedTurnStarted,
} from "../helpers/seed.js";

export type ListedEvent = ReturnType<typeof listEvents>[number];

export interface ActiveThreadWithTurnFixture {
  environmentId: string;
  hostId: string;
  providerThreadId: string;
  threadId: string;
  turnId: string;
}

/**
 * Drains in-flight engine dispatches, then yields a macrotask so settlement
 * continuations and detached follow-up work observe their post-commit state.
 * Only valid once every held dispatch has been settled or released — while a
 * command is deliberately held in flight, use `yieldLifecycleTicks` instead.
 */
export async function settleLifecycleWork(
  harness: TestAppHarness,
): Promise<void> {
  await harness.deps.engineDispatch.drain();
  await new Promise<void>((resolve) => {
    setImmediate(resolve);
  });
}

/**
 * Yields a few macrotasks so settlement continuations of an
 * already-reported command run, without draining dispatches that a test is
 * deliberately holding in flight.
 */
export async function yieldLifecycleTicks(): Promise<void> {
  for (let tick = 0; tick < 3; tick += 1) {
    await new Promise<void>((resolve) => {
      setImmediate(resolve);
    });
  }
}

export async function waitFor(
  check: () => boolean,
  message: string,
  timeoutMs = 1_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (check()) {
      return;
    }
    await sleep(10);
  }
  throw new Error(message);
}

export function seedActiveThreadWithTurn(
  harness: TestAppHarness,
): ActiveThreadWithTurnFixture {
  const { host } = seedHostSession(harness.deps);
  const { project } = seedProjectWithSource(harness.deps, {
    hostId: host.id,
  });
  const environment = seedEnvironment(harness.deps, {
    hostId: host.id,
    projectId: project.id,
  });
  const thread = seedThread(harness.deps, {
    projectId: project.id,
    environmentId: environment.id,
    status: "active",
  });
  const turnId = `turn-${thread.id}`;
  const providerThreadId = `provider-${thread.id}`;
  seedTurnStarted(harness.deps, {
    threadId: thread.id,
    environmentId: environment.id,
    turnId,
    providerThreadId,
  });

  return {
    environmentId: environment.id,
    hostId: host.id,
    providerThreadId,
    threadId: thread.id,
    turnId,
  };
}

export function requireThreadRow(
  harness: TestAppHarness,
  threadId: string,
): Thread {
  const thread = getThread(harness.db, threadId);
  if (!thread) {
    throw new Error(`Expected thread ${threadId}`);
  }
  return thread;
}

export function getSingleEvent(
  events: ListedEvent[],
  type: ListedEvent["type"],
): ListedEvent {
  const matches = events.filter((event) => event.type === type);
  if (matches.length !== 1 || !matches[0]) {
    throw new Error(
      `Expected one ${type} event, found ${matches.length} in [${events
        .map((event) => event.type)
        .join(", ")}]`,
    );
  }
  return matches[0];
}

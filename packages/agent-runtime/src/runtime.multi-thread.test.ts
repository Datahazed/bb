import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ThreadEvent } from "@bb/domain";
import { createAgentRuntimeWithProviderDrivers } from "./test/runtime-with-provider-drivers.js";
import type { AgentRuntime } from "./types.js";
import {
  fullRuntimeOptions,
  waitForRuntimeState,
  waitForThreadAgentMessageText,
  waitForThreadTurnCompleted,
} from "./test/runtime-test-harness.js";
import { promptTextInput } from "./test/prompt-input.js";

interface WaitForBothThreadsStartedArgs {
  events: ThreadEvent[];
  firstThreadId: string;
  providerId: string;
  runtime: AgentRuntime;
  secondThreadId: string;
}

function hasThreadTurnStarted(
  events: ThreadEvent[],
  threadId: string,
): boolean {
  return events.some(
    (event) => event.type === "turn/started" && event.threadId === threadId,
  );
}

async function waitForBothThreadsStarted(
  args: WaitForBothThreadsStartedArgs,
): Promise<void> {
  await waitForRuntimeState({
    events: args.events,
    label: `turn/started for ${args.firstThreadId} and ${args.secondThreadId}`,
    predicate: () =>
      hasThreadTurnStarted(args.events, args.firstThreadId) &&
      hasThreadTurnStarted(args.events, args.secondThreadId),
    providerId: args.providerId,
    runtime: args.runtime,
  });
}

describe("createAgentRuntime multi-thread routing", () => {
  let tmpDir: string;
  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "bb-runtime-test-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("handles multiple threads on the same provider", async () => {
    const events: ThreadEvent[] = [];
    const runtime = createAgentRuntimeWithProviderDrivers({
      workspacePath: tmpDir,
      onEvent: (e) => events.push(e),
      onToolCall: async () => ({
        contentItems: [{ type: "inputText", text: "ok" }],
        success: true,
      }),
    });

    const r1 = await runtime.startThread({
      environmentId: "env-1",
      threadId: "t1",
      projectId: "p1",
      providerId: "fake",
      options: fullRuntimeOptions,
    });
    const r2 = await runtime.startThread({
      environmentId: "env-1",
      threadId: "t2",
      projectId: "p1",
      providerId: "fake",
      options: fullRuntimeOptions,
    });

    // Each thread gets a unique providerThreadId
    expect(r1.providerThreadId).not.toBe(r2.providerThreadId);

    // Run turns concurrently
    await Promise.all([
      runtime.runTurn({
        clientRequestId: "creq_222222222b",
        threadId: "t1",
        input: [promptTextInput({ text: "thread 1" })],
        options: fullRuntimeOptions,
      }),
      runtime.runTurn({
        clientRequestId: "creq_222222222c",
        threadId: "t2",
        input: [promptTextInput({ text: "thread 2" })],
        options: fullRuntimeOptions,
      }),
    ]);
    await Promise.all([
      waitForThreadTurnCompleted({
        events,
        providerId: "fake",
        runtime,
        threadId: "t1",
      }),
      waitForThreadTurnCompleted({
        events,
        providerId: "fake",
        runtime,
        threadId: "t2",
      }),
    ]);

    // Both threads should have turn/completed events with correct threadIds
    const t1Completed = events.filter(
      (e) =>
        e.type === "turn/completed" && "threadId" in e && e.threadId === "t1",
    );
    const t2Completed = events.filter(
      (e) =>
        e.type === "turn/completed" && "threadId" in e && e.threadId === "t2",
    );
    expect(t1Completed.length).toBe(1);
    expect(t2Completed.length).toBe(1);

    await runtime.shutdown();
  });

  it("keeps sibling threads running for multiplexed providers after stopping one thread", async () => {
    const events: ThreadEvent[] = [];
    const providerId = "keep-provider-fake";
    const runtime = createAgentRuntimeWithProviderDrivers({
      workspacePath: tmpDir,
      onEvent: (event) => events.push(event),
      onToolCall: async () => ({
        contentItems: [{ type: "inputText", text: "ok" }],
        success: true,
      }),
    });

    await runtime.startThread({
      environmentId: "env-1",
      threadId: "t1",
      projectId: "p1",
      providerId,
      options: fullRuntimeOptions,
    });
    await runtime.startThread({
      environmentId: "env-1",
      threadId: "t2",
      projectId: "p1",
      providerId,
      options: fullRuntimeOptions,
    });

    await Promise.all([
      runtime.runTurn({
        clientRequestId: "creq_222222222d",
        threadId: "t1",
        input: [promptTextInput({ text: "delay:500 thread A should stop" })],
        options: fullRuntimeOptions,
      }),
      runtime.runTurn({
        clientRequestId: "creq_222222222e",
        threadId: "t2",
        input: [promptTextInput({ text: "delay:500 thread B should survive" })],
        options: fullRuntimeOptions,
      }),
    ]);
    await waitForBothThreadsStarted({
      events,
      firstThreadId: "t1",
      providerId,
      runtime,
      secondThreadId: "t2",
    });

    await runtime.stopThread({ threadId: "t1" });
    expect(runtime.listRunningProviders()).toEqual([providerId]);

    await waitForThreadAgentMessageText({
      events,
      providerId,
      runtime,
      threadId: "t2",
      text: "thread B should survive",
    });

    await runtime.runTurn({
      clientRequestId: "creq_222222222f",
      threadId: "t2",
      input: [promptTextInput({ text: "thread B still accepts turns" })],
      options: fullRuntimeOptions,
    });
    await waitForThreadAgentMessageText({
      events,
      providerId,
      runtime,
      threadId: "t2",
      text: "thread B still accepts turns",
    });

    await runtime.shutdown();
  });

  it("stamps all events with bb threadId and providerThreadId", async () => {
    const events: ThreadEvent[] = [];
    const runtime = createAgentRuntimeWithProviderDrivers({
      workspacePath: tmpDir,
      onEvent: (e) => events.push(e),
      onToolCall: async () => ({
        contentItems: [{ type: "inputText", text: "ok" }],
        success: true,
      }),
    });

    const { providerThreadId } = await runtime.startThread({
      environmentId: "env-1",
      threadId: "my-thread",
      projectId: "p1",
      providerId: "fake",
      options: fullRuntimeOptions,
    });
    await runtime.runTurn({
      clientRequestId: "creq_222222222g",
      threadId: "my-thread",
      input: [promptTextInput({ text: "check ids" })],
      options: fullRuntimeOptions,
    });
    await waitForThreadTurnCompleted({
      events,
      providerId: "fake",
      runtime,
      threadId: "my-thread",
    });

    // Every event with a threadId should have the bb threadId, not the provider's
    const threadEvents = events.filter((e) => "threadId" in e);
    expect(threadEvents.length).toBeGreaterThan(0);
    for (const e of threadEvents) {
      expect(e.threadId).toBe("my-thread");
      if ("providerThreadId" in e) {
        expect(e.providerThreadId).toBe(providerThreadId);
      }
    }

    await runtime.shutdown();
  });

  it("stamps events correctly for multiple threads", async () => {
    const events: ThreadEvent[] = [];
    const runtime = createAgentRuntimeWithProviderDrivers({
      workspacePath: tmpDir,
      onEvent: (e) => events.push(e),
      onToolCall: async () => ({
        contentItems: [{ type: "inputText", text: "ok" }],
        success: true,
      }),
    });

    const r1 = await runtime.startThread({
      environmentId: "env-1",
      threadId: "t1",
      projectId: "p1",
      providerId: "fake",
      options: fullRuntimeOptions,
    });
    const r2 = await runtime.startThread({
      environmentId: "env-1",
      threadId: "t2",
      projectId: "p1",
      providerId: "fake",
      options: fullRuntimeOptions,
    });

    await Promise.all([
      runtime.runTurn({
        clientRequestId: "creq_222222222h",
        threadId: "t1",
        input: [promptTextInput({ text: "from t1" })],
        options: fullRuntimeOptions,
      }),
      runtime.runTurn({
        clientRequestId: "creq_222222222i",
        threadId: "t2",
        input: [promptTextInput({ text: "from t2" })],
        options: fullRuntimeOptions,
      }),
    ]);
    await Promise.all([
      waitForThreadTurnCompleted({
        events,
        providerId: "fake",
        runtime,
        threadId: "t1",
      }),
      waitForThreadTurnCompleted({
        events,
        providerId: "fake",
        runtime,
        threadId: "t2",
      }),
    ]);

    // t1 events should have threadId "t1" and providerThreadId from r1
    const t1Events = events.filter(
      (e) => "threadId" in e && e.threadId === "t1",
    );
    const t2Events = events.filter(
      (e) => "threadId" in e && e.threadId === "t2",
    );

    expect(t1Events.length).toBeGreaterThan(0);
    expect(t2Events.length).toBeGreaterThan(0);

    for (const e of t1Events) {
      if ("providerThreadId" in e) {
        expect(e.providerThreadId).toBe(r1.providerThreadId);
      }
    }
    for (const e of t2Events) {
      if ("providerThreadId" in e) {
        expect(e.providerThreadId).toBe(r2.providerThreadId);
      }
    }

    await runtime.shutdown();
  });

  // Canonical drivers bind attachments before events are accepted, so the
  // former pre-identity and unscoped-event ambiguity cases are impossible.

  // ---- Multi-provider ----

  it("handles multiple providers in a single runtime", async () => {
    const events: ThreadEvent[] = [];
    const runtime = createAgentRuntimeWithProviderDrivers({
      workspacePath: tmpDir,
      onEvent: (e) => events.push(e),
      onToolCall: async () => ({
        contentItems: [{ type: "inputText", text: "ok" }],
        success: true,
      }),
    });

    await runtime.startThread({
      environmentId: "env-1",
      threadId: "t1",
      projectId: "p1",
      providerId: "provider-a",
      options: fullRuntimeOptions,
    });
    await runtime.startThread({
      environmentId: "env-1",
      threadId: "t2",
      projectId: "p1",
      providerId: "provider-b",
      options: fullRuntimeOptions,
    });

    await Promise.all([
      runtime.runTurn({
        clientRequestId: "creq_222222222m",
        threadId: "t1",
        input: [promptTextInput({ text: "from a" })],
        options: fullRuntimeOptions,
      }),
      runtime.runTurn({
        clientRequestId: "creq_222222222n",
        threadId: "t2",
        input: [promptTextInput({ text: "from b" })],
        options: fullRuntimeOptions,
      }),
    ]);
    await Promise.all([
      waitForThreadTurnCompleted({
        events,
        providerId: "provider-a",
        runtime,
        threadId: "t1",
      }),
      waitForThreadTurnCompleted({
        events,
        providerId: "provider-b",
        runtime,
        threadId: "t2",
      }),
    ]);

    const completedEvents = events.filter((e) => e.type === "turn/completed");
    expect(completedEvents.length).toBe(2);

    await runtime.shutdown();
  });

  // ---- Resume across runtimes ----

  it("resumes across runtime instances", async () => {
    // Runtime 1: start a thread
    const events1: ThreadEvent[] = [];
    const runtime1 = createAgentRuntimeWithProviderDrivers({
      workspacePath: tmpDir,
      onEvent: (e) => events1.push(e),
      onToolCall: async () => ({
        contentItems: [{ type: "inputText", text: "ok" }],
        success: true,
      }),
    });

    const { providerThreadId } = await runtime1.startThread({
      environmentId: "env-1",
      threadId: "t1",
      projectId: "p1",
      providerId: "fake",
      options: fullRuntimeOptions,
    });
    await runtime1.runTurn({
      clientRequestId: "creq_222222222p",
      threadId: "t1",
      input: [promptTextInput({ text: "first runtime" })],
      options: fullRuntimeOptions,
    });
    await waitForThreadTurnCompleted({
      events: events1,
      providerId: "fake",
      runtime: runtime1,
      threadId: "t1",
    });
    await runtime1.shutdown();

    // Runtime 2: resume the thread
    const events2: ThreadEvent[] = [];
    const runtime2 = createAgentRuntimeWithProviderDrivers({
      workspacePath: tmpDir,
      onEvent: (e) => events2.push(e),
      onToolCall: async () => ({
        contentItems: [{ type: "inputText", text: "ok" }],
        success: true,
      }),
    });

    await runtime2.resumeThread({
      environmentId: "env-1",
      threadId: "t1-resumed",
      providerThreadId,
      providerId: "fake",
      options: fullRuntimeOptions,
    });
    await runtime2.runTurn({
      clientRequestId: "creq_222222222q",
      threadId: "t1-resumed",
      input: [promptTextInput({ text: "second runtime" })],
      options: fullRuntimeOptions,
    });
    await waitForThreadTurnCompleted({
      events: events2,
      providerId: "fake",
      runtime: runtime2,
      threadId: "t1-resumed",
    });

    expect(events2.some((e) => e.type === "turn/completed")).toBe(true);
    await runtime2.shutdown();
  }, 15_000);
});

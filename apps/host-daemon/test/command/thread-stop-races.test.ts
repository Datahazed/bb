import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  createAgentRuntime,
  type AgentRuntime,
  type AgentRuntimeProcessExitInfo,
} from "@bb/agent-runtime";
import {
  createScriptedEchoRequestRecord,
  type ScriptedEchoLaunchScript,
  type ScriptedEchoRequestRecord,
} from "@bb/agent-runtime/test";
import { buildPluginHost, resolvePluginBuildToolchain } from "@bb/plugin-build";
import {
  encodeClientTurnRequestIdNumber,
  type ClientTurnRequestId,
  type ThreadEvent,
} from "@bb/domain";
import type {
  HostDaemonBridgeLaunch,
  HostDaemonOnlineRpcResponseMessage,
} from "@bb/host-daemon-contract";
import { afterEach, describe, expect, it, vi } from "vitest";
import { dispatchCommand } from "../../src/command-dispatch.js";
import {
  noopEventSink,
  resolveRuntimeBridgeLaunch,
  type CommandDispatchOptions,
  type CommandOf,
} from "../../src/command-dispatch-support.js";
import { CommandRouter } from "../../src/command-router.js";
import { RuntimeManager } from "../../src/runtime-manager.js";
import {
  cleanupTempDirs,
  createFakeWorkspace,
  makeDispatchOptions,
  makeTempDir,
  unexpectedProjectAttachmentFetch,
  unexpectedProviderMaintenance,
  fetchDispatchTestArtifact,
} from "./dispatch-helpers.js";

/**
 * Race coverage for the thread.stop dispatch flow against the REAL agent
 * runtime (the scripted echo bridge, a real provider subprocess behind the
 * real bridge-protocol adapter): the stop wait is event-driven via
 * runtime.waitForActiveTurn, crash clearing is owned by the runtime, and
 * repeated stops are idempotent.
 */

const ENVIRONMENT_ID = "env-stop-race";
const THREAD_STOP_ACTIVE_TURN_WAIT_MS = 5_000;

interface RaceHarness {
  dispatchOptions: CommandDispatchOptions;
  events: ThreadEvent[];
  /** The scripted echo bridge launch every command in this harness carries. */
  launch: HostDaemonBridgeLaunch;
  manager: RuntimeManager;
  unexpectedProcessExit: Promise<AgentRuntimeProcessExitInfo>;
  /** Every request the bridge processes handled (the provider's view). */
  record: ScriptedEchoRequestRecord;
  requireRuntime: () => AgentRuntime;
  workspacePath: string;
}

interface ThreadStartArgs {
  threadId: string;
  providerId?: string;
  inputText?: string;
  bridgeLaunch?: HostDaemonBridgeLaunch;
}

interface TurnSubmitArgs {
  threadId: string;
  inputText: string;
  /** Defaults to an explicit start. */
  target?: CommandOf<"turn.submit">["target"];
}

const managers: RuntimeManager[] = [];
let nextClientRequestIdValue = 1;
let nextRpcRequestIdValue = 1;

afterEach(async () => {
  vi.useRealTimers();
  await Promise.all(managers.splice(0).map((manager) => manager.shutdownAll()));
  await cleanupTempDirs();
});

function nextClientRequestId(): ClientTurnRequestId {
  const requestId = encodeClientTurnRequestIdNumber({
    value: nextClientRequestIdValue,
  });
  nextClientRequestIdValue += 1;
  return requestId;
}

/** Lets queued microtasks (the dispatch chain up to its turn waiter) run. */
function flushMicrotasks(): Promise<void> {
  return new Promise((resolve) => {
    setImmediate(resolve);
  });
}

/**
 * The scripted echo bridge as the daemon receives a plugin provider: a built
 * `bb.host` artifact named by digest and byte length on the wire, fetched and
 * hash-verified into the daemon's cache before the bootstrap imports it.
 * Built once per file from source, like the plugin runtime builds it.
 */
let scriptedEchoArtifact: Promise<{
  bytes: Uint8Array;
  digest: string;
}> | null = null;

function buildScriptedEchoArtifact(): Promise<{
  bytes: Uint8Array;
  digest: string;
}> {
  scriptedEchoArtifact ??= (async () => {
    const rootDir = fileURLToPath(
      new URL("../../../../tests/scripted-echo-provider", import.meta.url),
    );
    const toolchain = await resolvePluginBuildToolchain(
      path.join(os.tmpdir(), "bb-plugin-build-toolchain"),
    );
    const build = await buildPluginHost(rootDir, "0.0.0-test", toolchain);
    return {
      bytes: await readFile(build.jsPath),
      digest: build.artifactDigest,
    };
  })();
  return scriptedEchoArtifact;
}

/**
 * The launch the dispatch commands carry, the way the server attaches a
 * plugin provider's artifact. `scripted` rides `providerOptions` like any
 * provider-owned static.
 */
async function scriptedEchoDispatchLaunch(
  options: { pluginId?: string; scripted?: ScriptedEchoLaunchScript } = {},
): Promise<HostDaemonBridgeLaunch> {
  const artifact = await buildScriptedEchoArtifact();
  return {
    pluginId: options.pluginId ?? "provider-scripted-echo",
    source: {
      kind: "artifact",
      digest: artifact.digest,
      byteLength: artifact.bytes.byteLength,
    },
    providerOptions:
      options.scripted === undefined
        ? {}
        : { scripted: JSON.parse(JSON.stringify(options.scripted)) },
    envPassthrough: [],
    capabilities: {
      providerInstallation: false,
      supportsServiceTier: false,
      permissionModes: ["accept-edits", "auto", "full"],
      supportsThreadArchive: true,
      supportsThreadRename: true,
      fork: "checkpoint",
    },
  };
}

async function createRaceHarness(
  options: { scripted?: ScriptedEchoLaunchScript } = {},
): Promise<RaceHarness> {
  const workspacePath = await makeTempDir("bb-stop-race-workspace-");
  const events: ThreadEvent[] = [];
  const record = createScriptedEchoRequestRecord();
  let resolveUnexpectedProcessExit: (
    info: AgentRuntimeProcessExitInfo,
  ) => void = () => undefined;
  const unexpectedProcessExit = new Promise<AgentRuntimeProcessExitInfo>(
    (resolve) => {
      resolveUnexpectedProcessExit = resolve;
    },
  );
  let runtime: AgentRuntime | null = null;
  const manager = new RuntimeManager({
    provisionWorkspace: async () =>
      createFakeWorkspace(workspacePath).workspace,
    createRuntime: (options) => {
      runtime = createAgentRuntime({
        ...options,
        env: { ...options.env, ...record.env },
      });
      return runtime;
    },
    onEvent: ({ event }) => {
      events.push(event);
    },
    onProcessExit: (info) => {
      if (!info.expected) {
        resolveUnexpectedProcessExit(info);
      }
    },
  });
  managers.push(manager);

  const artifact = await buildScriptedEchoArtifact();
  const dataDir = await makeTempDir("bb-stop-race-daemon-data-");
  return {
    dispatchOptions: makeDispatchOptions({
      runtimeManager: manager,
      dataDir,
      // The daemon's artifact fetcher, serving the built scripted echo bridge
      // for whichever plugin id a launch names.
      fetchPluginHostArtifact: async ({ digest }) => {
        if (digest !== artifact.digest) {
          throw new Error(`unknown plugin host artifact ${digest}`);
        }
        return artifact.bytes;
      },
    }),
    events,
    launch: await scriptedEchoDispatchLaunch(
      options.scripted === undefined ? {} : { scripted: options.scripted },
    ),
    manager,
    record,
    requireRuntime: () => {
      if (!runtime) {
        throw new Error("Runtime has not been created yet");
      }
      return runtime;
    },
    unexpectedProcessExit,
    workspacePath,
  };
}

function threadStartCommand(
  harness: RaceHarness,
  args: ThreadStartArgs,
): CommandOf<"thread.start"> {
  return {
    bridgeLaunch: args.bridgeLaunch ?? harness.launch,
    type: "thread.start",
    environmentId: ENVIRONMENT_ID,
    threadId: args.threadId,
    workspaceContext: {
      workspacePath: harness.workspacePath,
      workspaceProvisionType: "unmanaged",
    },
    projectId: "project-stop-race",
    providerId: args.providerId ?? "fake",
    requestId: nextClientRequestId(),
    input:
      args.inputText === undefined
        ? []
        : [{ type: "text", text: args.inputText, mentions: [] }],
    options: {
      model: "fake-model",
      serviceTier: "default",
      reasoningLevel: "medium",
      providerOptions: {},
      permissionMode: "full",
      permissionScope: "full",
      approvalReviewer: null,
      permissionEscalation: null,
    },
    instructions: "Be a helpful coding agent.",
    dynamicTools: [],
    injectedSkillSources: [],
    instructionMode: "append",
  };
}

function turnSubmitCommand(
  harness: RaceHarness,
  args: TurnSubmitArgs,
): CommandOf<"turn.submit"> {
  return {
    bridgeLaunch: harness.launch,
    type: "turn.submit",
    environmentId: ENVIRONMENT_ID,
    threadId: args.threadId,
    requestId: nextClientRequestId(),
    input: [{ type: "text", text: args.inputText, mentions: [] }],
    options: {
      model: "fake-model",
      serviceTier: "default",
      reasoningLevel: "medium",
      providerOptions: {},
      permissionMode: "full",
      permissionScope: "full",
      approvalReviewer: null,
      permissionEscalation: null,
    },
    resumeContext: {
      bridgeLaunch: harness.launch,
      workspaceContext: {
        workspacePath: harness.workspacePath,
        workspaceProvisionType: "unmanaged",
      },
      projectId: "project-stop-race",
      providerId: "fake",
      providerThreadId: "prov-1",
      instructions: "Be a helpful coding agent.",
      dynamicTools: [],
      injectedSkillSources: [],
      instructionMode: "append",
    },
    target: args.target ?? { mode: "start" },
  };
}

function threadStopCommand(
  threadId: string,
  intent: CommandOf<"thread.stop">["intent"] = "interrupt",
): CommandOf<"thread.stop"> {
  return {
    type: "thread.stop",
    intent,
    environmentId: ENVIRONMENT_ID,
    threadId,
  };
}

/** The `thread/stop` requests that reached a bridge process, in order. */
function recordedThreadStops(harness: RaceHarness): Record<string, unknown>[] {
  return harness.record
    .read()
    .filter((request) => request.method === "thread/stop")
    .map((request) => request.params ?? {});
}

function routerStop(
  router: CommandRouter,
  threadId: string,
  intent: CommandOf<"thread.stop">["intent"] = "interrupt",
): Promise<HostDaemonOnlineRpcResponseMessage> {
  const requestId = `stop-race-rpc-${nextRpcRequestIdValue}`;
  nextRpcRequestIdValue += 1;
  return router.handleOnlineRpcRequest({
    type: "host-rpc.request",
    requestId,
    command: threadStopCommand(threadId, intent),
  });
}

function routerSubmit(
  router: CommandRouter,
  harness: RaceHarness,
  args: TurnSubmitArgs,
): Promise<HostDaemonOnlineRpcResponseMessage> {
  const requestId = `stop-race-rpc-${nextRpcRequestIdValue}`;
  nextRpcRequestIdValue += 1;
  return router.handleOnlineRpcRequest({
    type: "host-rpc.request",
    requestId,
    command: turnSubmitCommand(harness, args),
  });
}

/**
 * A router over the harness's own dispatch options, so commands it admits
 * resolve the scripted echo artifact from the same cache the direct
 * dispatches filled.
 */
function createRouter(harness: RaceHarness): CommandRouter {
  return new CommandRouter({
    ...harness.dispatchOptions,
    logger: { debug: () => undefined, warn: () => undefined },
  });
}

describe("thread.stop race semantics", () => {
  it("resolves a stop dispatched before turn/started event-driven and stops the right turn", async () => {
    const harness = await createRaceHarness();
    await dispatchCommand(
      threadStartCommand(harness, { threadId: "t-race" }),
      harness.dispatchOptions,
    );
    const runtime = harness.requireRuntime();
    expect(runtime.hasThread("t-race")).toBe(true);
    expect(runtime.getActiveTurnId("t-race")).toBeNull();

    // Stop arrives while no turn is active yet: it must wait for the
    // turn/started observation, not poll and not give up.
    const stopPromise = dispatchCommand(
      threadStopCommand("t-race"),
      harness.dispatchOptions,
    );
    await flushMicrotasks();
    expect(recordedThreadStops(harness)).toHaveLength(0);

    // The turn now starts; its turn/started observation must release the stop.
    const submitPromise = dispatchCommand(
      turnSubmitCommand(harness, {
        threadId: "t-race",
        inputText: "delay:60000",
      }),
      harness.dispatchOptions,
    );
    await expect(stopPromise).resolves.toEqual({ providerCheckpointId: null });
    await expect(submitPromise).resolves.toEqual({ appliedAs: "new-turn" });

    // The wire carries the bridge's own turn id, reverse-mapped by the
    // adapter from the assembler-minted id the runtime tracks.
    expect(recordedThreadStops(harness)).toEqual([
      expect.objectContaining({
        threadId: "t-race",
        intent: "interrupt",
        activeTurnId: "turn-1",
      }),
    ]);
    expect(harness.events).toContainEqual(
      expect.objectContaining({
        type: "turn/completed",
        threadId: "t-race",
        status: "interrupted",
      }),
    );
    expect(runtime.getActiveTurnId("t-race")).toBeNull();
    expect(runtime.hasThread("t-race")).toBe(false);
  });

  it("noops a stop after the turn-start wait times out without hanging", async () => {
    const harness = await createRaceHarness();
    await dispatchCommand(
      threadStartCommand(harness, { threadId: "t-idle" }),
      harness.dispatchOptions,
    );
    const runtime = harness.requireRuntime();
    expect(runtime.getActiveTurnId("t-idle")).toBeNull();

    // No turn ever starts, so the stop waits the full timeout. Fake timers
    // advance past it without spending the 5s in test time.
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const stopPromise = dispatchCommand(
      threadStopCommand("t-idle"),
      harness.dispatchOptions,
    );
    await flushMicrotasks();
    await vi.advanceTimersByTimeAsync(THREAD_STOP_ACTIVE_TURN_WAIT_MS);
    vi.useRealTimers();

    await expect(stopPromise).resolves.toEqual({ providerCheckpointId: null });
    // The stop reached the provider as a no-turn stop and released the thread.
    expect(recordedThreadStops(harness)).toEqual([
      expect.objectContaining({
        threadId: "t-idle",
        intent: "release",
        activeTurnId: null,
      }),
    ]);
    expect(runtime.hasThread("t-idle")).toBe(false);
    expect(
      harness.events.filter((event) => event.type === "turn/completed"),
    ).toEqual([]);
  });

  it("clears the active turn when the provider crashes mid-turn so a later stop noops", async () => {
    const harness = await createRaceHarness();
    // A second provider whose bridge dies mid-turn: it acknowledges the turn
    // (turn/started reaches the runtime) and then exits.
    const crasherLaunch = await scriptedEchoDispatchLaunch({
      pluginId: "provider-crasher",
      scripted: { exitAfter: "turn/start" },
    });
    const entry = await harness.manager.ensureEnvironment({
      environmentId: ENVIRONMENT_ID,
      workspacePath: harness.workspacePath,
      workspaceProvisionType: "unmanaged",
    });
    const healthyLaunch = await resolveRuntimeBridgeLaunch(
      harness.launch,
      harness.dispatchOptions,
    );
    // A healthy sibling process keeps this same environment runtime loaded,
    // so the later stop exercises its unknown-thread dispatch path. Start its
    // independent bootstrap beside the crasher instead of serializing two
    // real Node process startups under the test's wall-clock budget.
    const healthyStart = entry.runtime.ensureProvider({
      providerId: "fake",
      bridgeLaunch: healthyLaunch,
    });
    const crashStart = dispatchCommand(
      threadStartCommand(harness, {
        threadId: "t-crash",
        providerId: "crasher",
        inputText: "boom",
        bridgeLaunch: crasherLaunch,
      }),
      harness.dispatchOptions,
    );
    await Promise.all([healthyStart, crashStart]);

    const crashExit = await harness.unexpectedProcessExit;
    expect(crashExit.providerId).toBe("crasher");
    // The exit snapshot proves the thread was mid-turn when the process died.
    expect(crashExit.threads).toEqual([
      expect.objectContaining({
        threadId: "t-crash",
        providerThreadId: "prov-1",
        activeTurnId: expect.any(String),
      }),
    ]);
    // The runtime's own exit handling is the only clearing of that state.
    const runtime = harness.requireRuntime();
    expect(runtime.getActiveTurnId("t-crash")).toBeNull();
    expect(runtime.hasThread("t-crash")).toBe(false);
    // The daemon synthesized the failure for the orphaned turn.
    expect(harness.events).toContainEqual(
      expect.objectContaining({
        type: "turn/completed",
        threadId: "t-crash",
        status: "failed",
      }),
    );
    expect(await harness.manager.getOrAwait(ENVIRONMENT_ID)).toBe(entry);

    await expect(
      dispatchCommand(threadStopCommand("t-crash"), harness.dispatchOptions),
    ).resolves.toEqual({ providerCheckpointId: null });
    // The stop never reached a provider: the crashed thread is unknown.
    expect(recordedThreadStops(harness)).toHaveLength(0);
  });

  it("runs a stop queued behind submits that wait for a pending start without waiting out their bound", async () => {
    // The bridge accepts turn/start and never opens the turn: the case the
    // runtime's turn-start watchdog exists for, and the one where a submit
    // parks in its pending-start wait for the whole watchdog threshold.
    const harness = await createRaceHarness({
      scripted: { swallowTurnStart: true },
    });
    const router = createRouter(harness);
    await dispatchCommand(
      threadStartCommand(harness, { threadId: "t-pending" }),
      harness.dispatchOptions,
    );
    const runtime = harness.requireRuntime();
    const autoSend = { mode: "auto" as const, expectedTurnId: null };

    await expect(
      routerSubmit(router, harness, {
        threadId: "t-pending",
        inputText: "never opens",
        target: autoSend,
      }),
    ).resolves.toMatchObject({ ok: true, result: { appliedAs: "new-turn" } });
    expect(runtime.getLiveThreadIds()).toEqual(["t-pending"]);
    expect(runtime.getActiveTurnId("t-pending")).toBeNull();

    // Two more sends reach the router while that start is pending. The
    // first parks in its pending-start wait and holds the thread lane; the
    // second waits in the turn lane. Fake timers hold every bounded wait
    // from here on, so neither the submit's watchdog-sized bound nor the
    // stop's own wait spends test time.
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const waitForActiveTurn = vi.spyOn(runtime, "waitForActiveTurn");
    const secondSend = routerSubmit(router, harness, {
      threadId: "t-pending",
      inputText: "second",
      target: autoSend,
    });
    const thirdSend = routerSubmit(router, harness, {
      threadId: "t-pending",
      inputText: "third",
      target: autoSend,
    });
    await vi.waitFor(() => {
      expect(waitForActiveTurn).toHaveBeenCalledWith(
        "t-pending",
        expect.objectContaining({ timeoutMs: 120_000 }),
      );
    });

    // The user stops the thread. The stop shares the thread lane with the
    // waiting submit, so it queues behind it; the router aborts the submit's
    // wait on arrival and the submit answers thread_turn_busy (the server
    // parks its input) instead of holding the stop for its bound.
    const stop = routerStop(router, "t-pending");
    await expect(secondSend).resolves.toMatchObject({
      ok: false,
      errorCode: "thread_turn_busy",
      errorMessage: expect.stringMatching(/a stop for it is queued/),
    });
    // The stop holds the lane now. Its own bounded wait for the pending
    // start is the only wait left; advance past it.
    await vi.waitFor(() => {
      expect(waitForActiveTurn).toHaveBeenCalledWith("t-pending", {
        timeoutMs: THREAD_STOP_ACTIVE_TURN_WAIT_MS,
      });
    });
    await vi.advanceTimersByTimeAsync(THREAD_STOP_ACTIVE_TURN_WAIT_MS);
    vi.useRealTimers();

    await expect(stop).resolves.toMatchObject({
      ok: true,
      result: { providerCheckpointId: null },
    });
    // No turn ever opened, so the wire stop is a no-turn release.
    expect(recordedThreadStops(harness)).toEqual([
      expect.objectContaining({
        threadId: "t-pending",
        intent: "release",
        activeTurnId: null,
      }),
    ]);
    expect(runtime.hasThread("t-pending")).toBe(false);
    // Only the first send's start reached the bridge ahead of the stop: no
    // competing turn was opened on the stuck one.
    expect(
      harness.record
        .read()
        .filter((request) => request.method === "turn/start"),
    ).toHaveLength(1);

    // The third send was ordered after the stop by the turn lane, so it
    // runs on the stopped thread as any send after a stop does: the thread
    // is resumed and the input opens its own turn.
    await expect(thirdSend).resolves.toMatchObject({
      ok: true,
      result: { appliedAs: "new-turn" },
    });
    waitForActiveTurn.mockRestore();
  });

  it("lets a release stop wait behind a submit in its pending-start wait instead of aborting it", async () => {
    // Same stuck start as above, but the stop is a release: the server
    // settled nothing for it and leaves lifecycle state alone, so a submit
    // it aborted would park its input with no turn event left to settle the
    // thread. The submit keeps its wait; the release queues behind it.
    const harness = await createRaceHarness({
      scripted: { swallowTurnStart: true },
    });
    const router = createRouter(harness);
    await dispatchCommand(
      threadStartCommand(harness, { threadId: "t-release" }),
      harness.dispatchOptions,
    );
    const runtime = harness.requireRuntime();
    const autoSend = { mode: "auto" as const, expectedTurnId: null };
    await expect(
      routerSubmit(router, harness, {
        threadId: "t-release",
        inputText: "never opens",
        target: autoSend,
      }),
    ).resolves.toMatchObject({ ok: true, result: { appliedAs: "new-turn" } });

    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const waitForActiveTurn = vi.spyOn(runtime, "waitForActiveTurn");
    const secondSend = routerSubmit(router, harness, {
      threadId: "t-release",
      inputText: "second",
      target: autoSend,
    });
    await vi.waitFor(() => {
      expect(waitForActiveTurn).toHaveBeenCalledWith(
        "t-release",
        expect.objectContaining({ timeoutMs: 120_000 }),
      );
    });
    let secondSettled = false;
    void secondSend.finally(() => {
      secondSettled = true;
    });

    const release = routerStop(router, "t-release", "release");
    await vi.advanceTimersByTimeAsync(1_000);
    expect(secondSettled).toBe(false);

    // Only the bound ends the wait; the refusal does not blame a stop.
    await vi.advanceTimersByTimeAsync(120_000);
    await expect(secondSend).resolves.toMatchObject({
      ok: false,
      errorCode: "thread_turn_busy",
      errorMessage: expect.not.stringMatching(/a stop for it is queued/),
    });
    vi.useRealTimers();
    await expect(release).resolves.toMatchObject({
      ok: true,
      result: { providerCheckpointId: null },
    });
    expect(runtime.hasThread("t-release")).toBe(false);
    waitForActiveTurn.mockRestore();
  });

  it("treats the second of two racing stops as an idempotent no-op", async () => {
    const harness = await createRaceHarness();
    const router = new CommandRouter({
      dataDir: "/tmp/bb-stop-race-data",
      eventSink: noopEventSink,
      fetchProjectAttachment: unexpectedProjectAttachmentFetch,
      fetchPluginHostArtifact: fetchDispatchTestArtifact,
      ...unexpectedProviderMaintenance,
      logger: { debug: () => undefined, warn: () => undefined },
      runtimeManager: harness.manager,
      threadStorageRootPath: "/tmp/bb-stop-race-thread-storage",
    });
    await dispatchCommand(
      threadStartCommand(harness, {
        threadId: "t-double",
        inputText: "delay:60000",
      }),
      harness.dispatchOptions,
    );
    const runtime = harness.requireRuntime();
    await vi.waitFor(
      () => {
        expect(runtime.getActiveTurnId("t-double")).not.toBeNull();
      },
      { timeout: 5_000 },
    );

    const [firstStop, secondStop] = await Promise.all([
      routerStop(router, "t-double"),
      routerStop(router, "t-double"),
    ]);

    expect(firstStop.ok).toBe(true);
    expect(secondStop.ok).toBe(true);
    // Only one stop reached the provider; the loser saw the thread already
    // forgotten and nooped.
    expect(recordedThreadStops(harness)).toHaveLength(1);
    expect(
      harness.events.filter(
        (event) =>
          event.type === "turn/completed" && event.threadId === "t-double",
      ),
    ).toEqual([
      expect.objectContaining({
        status: "interrupted",
      }),
    ]);
    expect(runtime.hasThread("t-double")).toBe(false);
  });
});

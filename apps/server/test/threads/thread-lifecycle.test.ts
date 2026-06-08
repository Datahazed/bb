import { describe, expect, it, vi } from "vitest";
import {
  createPendingClientTurnRequestInTransaction,
  getClientTurnRequest,
  getCommand,
  getEnvironment,
  getEnvironmentOperation,
  getThread,
  getThreadOperation,
  hostDaemonCommands,
  listEvents,
  listThreads,
  markThreadStopRequested,
} from "@bb/db";
import {
  encodeClientTurnRequestIdNumber,
  systemThreadProvisioningEventDataSchema,
  type ClientTurnRequestId,
  type Thread,
  type ThreadEventType,
  type ThreadProvisioningState,
} from "@bb/domain";
import {
  hostDaemonCommandSchema,
  type EnvironmentProvisionCommand,
} from "@bb/host-daemon-contract";
import { upsertThreadOperationRecord } from "@bb/db/internal-lifecycle";
import { eq } from "drizzle-orm";
// Quarantined suite (excluded from vitest + tsconfig): `handleCommandResult`
// died with the durable queue in P1c; its surviving settle* owners live in
// the engine module below. Phase 2's boot-reconciliation rewrite replaces
// this suite.
import { handleCommandResult } from "../../src/services/engine/command-results.js";
import {
  finalizeStoppedThread,
  interruptActiveTurnForThread,
  requestThreadStart,
  requestThreadStop,
  requestThreadStopForCurrentState,
} from "../../src/services/threads/thread-lifecycle.js";
import { runThreadLifecycleSweep } from "../../src/services/system/periodic-sweeps.js";
import {
  ensureCommandDelivered,
  waitForQueuedCommandAfter,
} from "../helpers/commands.js";
import { readJson } from "../helpers/json.js";
import { queueEnvironmentProvisionLifecycleCommand } from "../helpers/lifecycle-commands.js";
import {
  seedEnvironment,
  seedHostSession,
  seedProjectWithSource,
  seedThread,
  seedTurnStarted,
} from "../helpers/seed.js";
import { withTestHarness } from "../helpers/test-app.js";
import type { TestAppHarness } from "../helpers/test-app.js";

type ListedEvent = ReturnType<typeof listEvents>[number];
type ListedCommand = typeof hostDaemonCommands.$inferSelect;

interface ActiveThreadWithTurnFixture {
  environmentId: string;
  hostId: string;
  providerThreadId: string;
  threadId: string;
  turnId: string;
}

interface SeedPendingClientTurnRequestArgs {
  commandId: string;
  environmentId: string | null;
  requestEventSequence: number;
  requestId: ClientTurnRequestId;
  threadId: string;
}

interface ProvisioningThreadFixture {
  commandId: string;
  environmentId: string;
  hostId: string;
  provisioningId: string;
  sessionId: string;
  threadId: string;
}

interface ProvisioningThreadIdentity {
  environmentId: string;
  provisioningId: string;
  threadId: string;
}

interface ProvisioningStateFixture {
  environmentId: string;
  provisioningId: string;
}

function seedActiveThreadWithTurn(
  harness: TestAppHarness,
): ActiveThreadWithTurnFixture {
  const { host } = seedHostSession(harness.deps, {
    id: "host-thread-lifecycle-interrupt",
  });
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
  const turnId = "turn-thread-lifecycle-interrupt";
  const providerThreadId = "provider-thread-lifecycle-interrupt";
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

function seedPendingClientTurnRequest(
  harness: TestAppHarness,
  args: SeedPendingClientTurnRequestArgs,
): void {
  harness.db.transaction((tx) => {
    createPendingClientTurnRequestInTransaction(tx, {
      commandId: args.commandId,
      commandType: "turn.submit",
      environmentId: args.environmentId,
      requestEventSequence: args.requestEventSequence,
      requestId: args.requestId,
      threadId: args.threadId,
    });
  });
}

function buildProvisioningState(
  fixture: ProvisioningStateFixture,
): ThreadProvisioningState {
  return {
    environmentId: fixture.environmentId,
    provisionEventSequence: 1,
    provisioningId: fixture.provisioningId,
    stage: "environment-provisioning",
    workspaceReadyEventSequence: null,
  };
}

function buildEnvironmentProvisionCommand(
  fixture: ProvisioningThreadIdentity,
): EnvironmentProvisionCommand {
  return {
    type: "environment.provision",
    environmentId: fixture.environmentId,
    initiator: {
      threadId: fixture.threadId,
      provisioningId: fixture.provisioningId,
    },
    workspaceProvisionType: "unmanaged",
    path: "/tmp/thread-lifecycle-provisioning-stop",
  };
}

function seedProvisioningThread(
  harness: TestAppHarness,
): ProvisioningThreadFixture {
  const { host, session } = seedHostSession(harness.deps, {
    id: "host-thread-lifecycle-provision-stop",
  });
  const { project } = seedProjectWithSource(harness.deps, {
    hostId: host.id,
  });
  const environment = seedEnvironment(harness.deps, {
    hostId: host.id,
    path: "/tmp/thread-lifecycle-provisioning-stop",
    projectId: project.id,
    status: "provisioning",
  });
  const thread = seedThread(harness.deps, {
    environmentId: environment.id,
    projectId: project.id,
    status: "provisioning",
  });
  const identity: ProvisioningThreadIdentity = {
    environmentId: environment.id,
    provisioningId: "tpv-thread-lifecycle-stop",
    threadId: thread.id,
  };

  upsertThreadOperationRecord(harness.db, {
    threadId: thread.id,
    kind: "provision",
    payload: JSON.stringify({}),
    provisioningState: buildProvisioningState(identity),
  });

  const command = queueEnvironmentProvisionLifecycleCommand(harness, {
    command: buildEnvironmentProvisionCommand(identity),
    environmentId: environment.id,
    hostId: host.id,
    sessionId: session.id,
  });

  return {
    commandId: command.id,
    environmentId: environment.id,
    hostId: host.id,
    provisioningId: identity.provisioningId,
    sessionId: session.id,
    threadId: thread.id,
  };
}

function getSingleEvent(
  events: ListedEvent[],
  type: ThreadEventType,
): ListedEvent {
  const matches = events.filter((event) => event.type === type);
  expect(matches).toHaveLength(1);
  const event = matches[0];
  if (!event) {
    throw new Error(`Expected one ${type} event`);
  }
  return event;
}

function requireThreadRow(harness: TestAppHarness, threadId: string): Thread {
  const thread = getThread(harness.db, threadId);
  if (!thread) {
    throw new Error(`Expected thread ${threadId}`);
  }
  return thread;
}

function getSingleCommandByType(
  harness: TestAppHarness,
  type: string,
): ListedCommand {
  const commands = listCommandsByType(harness, type);
  expect(commands).toHaveLength(1);
  const command = commands[0];
  if (!command) {
    throw new Error(`Expected one ${type} command`);
  }
  return command;
}

function listCommandsByType(
  harness: TestAppHarness,
  type: string,
): ListedCommand[] {
  const commands = harness.db
    .select()
    .from(hostDaemonCommands)
    .where(eq(hostDaemonCommands.type, type))
    .all();
  return commands;
}

describe("thread lifecycle interruption", () => {
  it("interrupts an active turn with provider state and idles the thread", async () => {
    await withTestHarness(async (harness) => {
      const fixture = seedActiveThreadWithTurn(harness);

      expect(
        interruptActiveTurnForThread(harness.deps, {
          environmentId: fixture.environmentId,
          reason: "manual-stop",
          threadId: fixture.threadId,
        }),
      ).toBe(true);

      expect(getThread(harness.db, fixture.threadId)?.status).toBe("idle");
      const events = listEvents(harness.db, { threadId: fixture.threadId });
      expect(events.map((event) => event.type)).toEqual([
        "turn/started",
        "turn/completed",
        "system/thread/interrupted",
      ]);

      const turnCompleted = getSingleEvent(events, "turn/completed");
      expect(turnCompleted).toMatchObject({
        environmentId: fixture.environmentId,
        providerThreadId: fixture.providerThreadId,
        scopeKind: "turn",
        turnId: fixture.turnId,
      });
      expect(turnCompleted.data).toBe(
        JSON.stringify({
          providerThreadId: fixture.providerThreadId,
          status: "interrupted",
        }),
      );

      const interrupted = getSingleEvent(events, "system/thread/interrupted");
      expect(interrupted).toMatchObject({
        providerThreadId: null,
        scopeKind: "thread",
        turnId: null,
      });
      expect(interrupted.data).toBe(
        JSON.stringify({
          reason: "manual-stop",
        }),
      );
    });
  });

  it("does not mutate an active thread when no active turn exists", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps, {
        id: "host-thread-lifecycle-no-turn",
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
      });
      const thread = seedThread(harness.deps, {
        projectId: project.id,
        status: "active",
      });

      expect(
        interruptActiveTurnForThread(harness.deps, {
          environmentId: null,
          reason: "manual-stop",
          threadId: thread.id,
        }),
      ).toBe(false);

      expect(getThread(harness.db, thread.id)?.status).toBe("active");
      expect(listEvents(harness.db, { threadId: thread.id })).toEqual([]);
    });
  });

  it("finalizes a manually stopped active thread without an active turn and cancels pending requests", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps, {
        id: "host-thread-lifecycle-manual-no-turn",
      });
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
      const requestId = encodeClientTurnRequestIdNumber({ value: 10 });
      seedPendingClientTurnRequest(harness, {
        commandId: "hcmd_thread_lifecycle_manual_pending",
        environmentId: environment.id,
        requestEventSequence: 10,
        requestId,
        threadId: thread.id,
      });
      requestThreadStop(harness.deps, {
        environmentId: environment.id,
        interruptionReason: "manual-stop",
        stopRequestedAt: null,
        threadId: thread.id,
      });

      expect(
        finalizeStoppedThread(harness.deps, {
          threadId: thread.id,
        }),
      ).toBe(true);

      expect(getThread(harness.db, thread.id)?.status).toBe("idle");
      expect(getClientTurnRequest(harness.db, { requestId })).toMatchObject({
        message: "Thread stopped before provider accepted the request",
        reasonCode: "runtime_canceled",
        status: "canceled",
      });
      expect(
        listEvents(harness.db, { threadId: thread.id }).map(
          (event) => event.type,
        ),
      ).toEqual(["system/thread/interrupted"]);
    });
  });

  it("finalizes a stopped active thread with one interrupted turn and thread event", async () => {
    await withTestHarness(async (harness) => {
      const fixture = seedActiveThreadWithTurn(harness);
      requestThreadStop(harness.deps, {
        environmentId: fixture.environmentId,
        interruptionReason: "manual-stop",
        stopRequestedAt: null,
        threadId: fixture.threadId,
      });
      const queuedStop = getThreadOperation(harness.db, {
        threadId: fixture.threadId,
        kind: "stop",
      });
      if (!queuedStop?.commandId) {
        throw new Error("Expected a queued stop operation");
      }

      expect(
        finalizeStoppedThread(harness.deps, {
          threadId: fixture.threadId,
        }),
      ).toBe(true);

      const finalizedThread = getThread(harness.db, fixture.threadId);
      expect(finalizedThread).toMatchObject({
        status: "idle",
        stopRequestedAt: null,
      });
      expect(getCommand(harness.db, queuedStop.commandId)?.state).toBe("error");
      expect(
        getThreadOperation(harness.db, {
          threadId: fixture.threadId,
          kind: "stop",
        }),
      ).toMatchObject({
        commandId: queuedStop.commandId,
        state: "completed",
      });

      const events = listEvents(harness.db, { threadId: fixture.threadId });
      expect(events.map((event) => event.type)).toEqual([
        "turn/started",
        "turn/completed",
        "system/thread/interrupted",
      ]);
      expect(getSingleEvent(events, "turn/completed").data).toBe(
        JSON.stringify({
          providerThreadId: fixture.providerThreadId,
          status: "interrupted",
        }),
      );
      expect(getSingleEvent(events, "system/thread/interrupted").data).toBe(
        JSON.stringify({
          reason: "manual-stop",
        }),
      );
    });
  });

  it("stops a created thread without an environment", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps, {
        id: "host-thread-lifecycle-created-stop",
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
      });
      const thread = seedThread(harness.deps, {
        environmentId: null,
        projectId: project.id,
        status: "created",
      });

      requestThreadStopForCurrentState(harness.deps, thread, null);

      expect(getThread(harness.db, thread.id)).toMatchObject({
        status: "idle",
        stopRequestedAt: null,
      });
      const events = listEvents(harness.db, { threadId: thread.id });
      expect(events.map((event) => event.type)).toEqual([
        "system/thread/interrupted",
      ]);
      expect(getSingleEvent(events, "system/thread/interrupted").data).toBe(
        JSON.stringify({
          reason: "manual-stop",
        }),
      );
    });
  });

  it("cancels pending provisioning and finalizes the thread", async () => {
    await withTestHarness(async (harness) => {
      const fixture = seedProvisioningThread(harness);

      requestThreadStopForCurrentState(
        harness.deps,
        requireThreadRow(harness, fixture.threadId),
        {
                    id: fixture.environmentId,
        },
      );

      expect(getThread(harness.db, fixture.threadId)).toMatchObject({
        status: "idle",
        stopRequestedAt: null,
      });
      expect(getCommand(harness.db, fixture.commandId)).toMatchObject({
        resultPayload: JSON.stringify({
          errorCode: "environment_provision_cancelled",
          errorMessage: "Environment provisioning was cancelled",
        }),
        state: "error",
      });
      expect(
        getThreadOperation(harness.db, {
          threadId: fixture.threadId,
          kind: "provision",
        }),
      ).toMatchObject({ state: "cancelled" });
      expect(
        getEnvironmentOperation(harness.db, {
          environmentId: fixture.environmentId,
          kind: "provision",
        }),
      ).toMatchObject({ state: "cancelled" });
      expect(getEnvironment(harness.db, fixture.environmentId)).toMatchObject({
        status: "ready",
      });

      const events = listEvents(harness.db, { threadId: fixture.threadId });
      expect(events.map((event) => event.type)).toEqual([
        "system/thread/interrupted",
        "system/thread-provisioning",
      ]);
      expect(getSingleEvent(events, "system/thread/interrupted").data).toBe(
        JSON.stringify({
          reason: "manual-stop",
        }),
      );
      const provisioningData = systemThreadProvisioningEventDataSchema.parse(
        JSON.parse(getSingleEvent(events, "system/thread-provisioning").data),
      );
      expect(provisioningData).toMatchObject({
        provisioningId: fixture.provisioningId,
        status: "cancelled",
        environmentId: fixture.environmentId,
        entries: [
          {
            type: "step",
            key: "provisioning-stopped",
            text: "Provisioning stopped by user request",
            status: "completed",
          },
        ],
      });
      expect(provisioningData.entries[0]?.startedAt).toEqual(
        expect.any(Number),
      );
    });
  });

  it("does not queue a stale start after provisioning stop finalizes", async () => {
    await withTestHarness(async (harness) => {
      const fixture = seedProvisioningThread(harness);
      const staleThread = requireThreadRow(harness, fixture.threadId);

      requestThreadStopForCurrentState(harness.deps, staleThread, {
        id: fixture.environmentId,
      });

      const environment = getEnvironment(harness.db, fixture.environmentId);
      if (!environment) {
        throw new Error(`Expected environment ${fixture.environmentId}`);
      }

      await requestThreadStart(harness.deps, {
        thread: staleThread,
        environment: {
          id: environment.id,
          hostId: environment.hostId,
          cleanupRequestedAt: environment.cleanupRequestedAt,
          path: environment.path,
          status: environment.status,
          workspaceProvisionType: environment.workspaceProvisionType,
        },
        requestId: "creq_23456789ad",
        input: [{ type: "text", text: "stale provisioning handoff" }],
        execution: {
          model: "gpt-5",
          reasoningLevel: "medium",
          permissionMode: "full",
          serviceTier: "default",
          source: "client/turn/requested",
        },
        permissionEscalation: "ask",
        projectId: staleThread.projectId,
        providerId: staleThread.providerId,
      });

      expect(getThread(harness.db, fixture.threadId)).toMatchObject({
        status: "idle",
        stopRequestedAt: null,
      });
      expect(
        getThreadOperation(harness.db, {
          threadId: fixture.threadId,
          kind: "start",
        }),
      ).toBeNull();
      expect(listCommandsByType(harness, "thread.start")).toHaveLength(0);
    });
  });

  it("keeps fetched provisioning stop-requested until host cancellation settles", async () => {
    await withTestHarness(async (harness) => {
      const fixture = seedProvisioningThread(harness);
      const provisionAttemptId = ensureCommandDelivered(harness, {
        commandId: fixture.commandId,
        hostId: fixture.hostId,
        sessionId: fixture.sessionId,
      });

      requestThreadStopForCurrentState(
        harness.deps,
        requireThreadRow(harness, fixture.threadId),
        {
                    id: fixture.environmentId,
        },
      );

      expect(getThread(harness.db, fixture.threadId)).toMatchObject({
        status: "provisioning",
      });
      expect(
        requireThreadRow(harness, fixture.threadId).stopRequestedAt,
      ).toEqual(expect.any(Number));
      expect(getCommand(harness.db, fixture.commandId)).toMatchObject({
        state: "fetched",
      });
      expect(
        getEnvironmentOperation(harness.db, {
          environmentId: fixture.environmentId,
          kind: "provision",
        }),
      ).toMatchObject({ state: "queued" });
      const cancelCommand = getSingleCommandByType(
        harness,
        "environment.provision.cancel",
      );
      expect(cancelCommand).toMatchObject({
        state: "pending",
        type: "environment.provision.cancel",
      });
      expect(
        hostDaemonCommandSchema.parse(JSON.parse(cancelCommand.payload)),
      ).toEqual({
        type: "environment.provision.cancel",
        environmentId: fixture.environmentId,
      });

      const events = listEvents(harness.db, { threadId: fixture.threadId });
      expect(events.map((event) => event.type)).toEqual([
        "system/thread/interrupted",
        "system/thread-provisioning",
      ]);

      const cancelAttemptId = ensureCommandDelivered(harness, {
        commandId: cancelCommand.id,
        hostId: fixture.hostId,
        sessionId: fixture.sessionId,
      });
      await handleCommandResult(harness.deps, {
        attemptId: cancelAttemptId,
        commandId: cancelCommand.id,
        completedAt: Date.now(),
        ok: true,
        result: { aborted: true },
        type: "environment.provision.cancel",
      });

      expect(getThread(harness.db, fixture.threadId)).toMatchObject({
        status: "idle",
        stopRequestedAt: null,
      });
      expect(getCommand(harness.db, fixture.commandId)).toMatchObject({
        resultPayload: JSON.stringify({
          errorCode: "environment_provision_cancelled",
          errorMessage: "Environment provisioning was cancelled",
        }),
        state: "error",
      });
      expect(
        getEnvironmentOperation(harness.db, {
          environmentId: fixture.environmentId,
          kind: "provision",
        }),
      ).toMatchObject({ state: "cancelled" });

      await handleCommandResult(harness.deps, {
        attemptId: provisionAttemptId,
        commandId: fixture.commandId,
        completedAt: Date.now(),
        ok: true,
        result: {
          branchName: "bb/cancelled-late",
          defaultBranch: "main",
          isGitRepo: true,
          isWorktree: false,
          path: "/tmp/thread-lifecycle-provisioning-stop",
          transcript: [],
        },
        type: "environment.provision",
      });

      expect(getThread(harness.db, fixture.threadId)).toMatchObject({
        status: "idle",
        stopRequestedAt: null,
      });
      expect(getEnvironment(harness.db, fixture.environmentId)).toMatchObject({
        status: "ready",
      });
      expect(
        getEnvironmentOperation(harness.db, {
          environmentId: fixture.environmentId,
          kind: "provision",
        }),
      ).toMatchObject({ state: "cancelled" });
    });
  });

  it("stops one shared provisioning thread without cancelling environment provisioning", async () => {
    await withTestHarness(async (harness) => {
      const fixture = seedProvisioningThread(harness);
      const stoppedThread = requireThreadRow(harness, fixture.threadId);
      const dependentThread = seedThread(harness.deps, {
        environmentId: fixture.environmentId,
        projectId: stoppedThread.projectId,
        status: "provisioning",
      });
      upsertThreadOperationRecord(harness.db, {
        threadId: dependentThread.id,
        kind: "provision",
        payload: JSON.stringify({}),
        provisioningState: buildProvisioningState({
          environmentId: fixture.environmentId,
          provisioningId: "tpv-thread-lifecycle-shared-dependent",
        }),
      });

      requestThreadStopForCurrentState(harness.deps, stoppedThread, {
        id: fixture.environmentId,
      });

      expect(getThread(harness.db, fixture.threadId)).toMatchObject({
        status: "idle",
        stopRequestedAt: null,
      });
      expect(
        getThreadOperation(harness.db, {
          threadId: fixture.threadId,
          kind: "provision",
        }),
      ).toMatchObject({ state: "cancelled" });
      expect(getThread(harness.db, dependentThread.id)).toMatchObject({
        status: "provisioning",
        stopRequestedAt: null,
      });
      expect(
        getThreadOperation(harness.db, {
          threadId: dependentThread.id,
          kind: "provision",
        }),
      ).toMatchObject({ state: "requested" });
      expect(
        getEnvironmentOperation(harness.db, {
          environmentId: fixture.environmentId,
          kind: "provision",
        }),
      ).toMatchObject({
        commandId: fixture.commandId,
        state: "queued",
      });
      expect(getCommand(harness.db, fixture.commandId)).toMatchObject({
        state: "pending",
      });
      expect(
        listCommandsByType(harness, "environment.provision.cancel"),
      ).toHaveLength(0);
    });
  });

  it("rejects new co-tenants while provisioning cancellation is active", async () => {
    await withTestHarness(async (harness) => {
      const fixture = seedProvisioningThread(harness);
      const provisionAttemptId = ensureCommandDelivered(harness, {
        commandId: fixture.commandId,
        hostId: fixture.hostId,
        sessionId: fixture.sessionId,
      });
      const stoppedThread = requireThreadRow(harness, fixture.threadId);

      requestThreadStopForCurrentState(harness.deps, stoppedThread, {
        id: fixture.environmentId,
      });

      const cancelCommand = getSingleCommandByType(
        harness,
        "environment.provision.cancel",
      );
      expect(cancelCommand).toMatchObject({
        state: "pending",
        type: "environment.provision.cancel",
      });

      const attachResponse = await harness.app.request("/api/v1/threads", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          origin: "app",
          projectId: stoppedThread.projectId,
          providerId: "codex",
          model: "gpt-5",
          input: [
            {
              type: "text",
              text: "try to join cancelling provision",
            },
          ],
          environment: {
            type: "reuse",
            environmentId: fixture.environmentId,
          },
        }),
      });

      expect(attachResponse.status).toBe(409);
      await expect(readJson(attachResponse)).resolves.toMatchObject({
        code: "environment_not_ready",
      });
      expect(
        listThreads(harness.db, { projectId: stoppedThread.projectId }).map(
          (thread) => thread.id,
        ),
      ).toEqual([fixture.threadId]);

      await handleCommandResult(harness.deps, {
        attemptId: provisionAttemptId,
        commandId: fixture.commandId,
        completedAt: Date.now(),
        ok: false,
        errorCode: "provision_cancelled",
        errorMessage: "provision cancelled",
        type: "environment.provision",
      });

      expect(getThread(harness.db, fixture.threadId)).toMatchObject({
        status: "provisioning",
      });
      expect(
        requireThreadRow(harness, fixture.threadId).stopRequestedAt,
      ).toEqual(expect.any(Number));
      expect(
        listThreads(harness.db, { projectId: stoppedThread.projectId }).map(
          (thread) => thread.id,
        ),
      ).toEqual([fixture.threadId]);
      expect(
        listEvents(harness.db, { threadId: fixture.threadId }).map(
          (event) => event.type,
        ),
      ).toEqual(["system/thread/interrupted", "system/thread-provisioning"]);
    });
  });

  it("recovers stop-requested provisioning through the lifecycle sweep", async () => {
    await withTestHarness(async (harness) => {
      const fixture = seedProvisioningThread(harness);
      const provisionAttemptId = ensureCommandDelivered(harness, {
        commandId: fixture.commandId,
        hostId: fixture.hostId,
        sessionId: fixture.sessionId,
      });
      markThreadStopRequested(harness.db, harness.hub, {
        requestedAt: 123,
        threadId: fixture.threadId,
      });

      await runThreadLifecycleSweep(harness.deps);

      expect(getThread(harness.db, fixture.threadId)).toMatchObject({
        status: "provisioning",
        stopRequestedAt: 123,
      });
      expect(getCommand(harness.db, fixture.commandId)).toMatchObject({
        state: "fetched",
      });
      expect(
        getThreadOperation(harness.db, {
          threadId: fixture.threadId,
          kind: "provision",
        }),
      ).toMatchObject({ state: "cancelled" });
      const cancelCommand = getSingleCommandByType(
        harness,
        "environment.provision.cancel",
      );
      expect(cancelCommand).toMatchObject({
        state: "pending",
        type: "environment.provision.cancel",
      });

      const cancelAttemptId = ensureCommandDelivered(harness, {
        commandId: cancelCommand.id,
        hostId: fixture.hostId,
        sessionId: fixture.sessionId,
      });
      await handleCommandResult(harness.deps, {
        attemptId: cancelAttemptId,
        commandId: cancelCommand.id,
        completedAt: Date.now(),
        ok: true,
        result: { aborted: true },
        type: "environment.provision.cancel",
      });

      expect(getThread(harness.db, fixture.threadId)).toMatchObject({
        status: "idle",
        stopRequestedAt: null,
      });
      expect(getCommand(harness.db, fixture.commandId)).toMatchObject({
        resultPayload: JSON.stringify({
          errorCode: "environment_provision_cancelled",
          errorMessage: "Environment provisioning was cancelled",
        }),
        state: "error",
      });
      expect(
        getEnvironmentOperation(harness.db, {
          environmentId: fixture.environmentId,
          kind: "provision",
        }),
      ).toMatchObject({ state: "cancelled" });

      await handleCommandResult(harness.deps, {
        attemptId: provisionAttemptId,
        commandId: fixture.commandId,
        completedAt: Date.now(),
        ok: true,
        result: {
          branchName: "bb/cancelled-sweep-late",
          defaultBranch: "main",
          isGitRepo: true,
          isWorktree: false,
          path: "/tmp/thread-lifecycle-provisioning-stop",
          transcript: [],
        },
        type: "environment.provision",
      });

      expect(getThread(harness.db, fixture.threadId)).toMatchObject({
        status: "idle",
        stopRequestedAt: null,
      });
      expect(
        getEnvironmentOperation(harness.db, {
          environmentId: fixture.environmentId,
          kind: "provision",
        }),
      ).toMatchObject({ state: "cancelled" });
    });
  });

  it("logs and retries when fetched provisioning cancellation fails", async () => {
    await withTestHarness(async (harness) => {
      const warnSpy = vi.fn();
      harness.deps.logger.warn = warnSpy;
      const fixture = seedProvisioningThread(harness);
      ensureCommandDelivered(harness, {
        commandId: fixture.commandId,
        hostId: fixture.hostId,
        sessionId: fixture.sessionId,
      });

      requestThreadStopForCurrentState(
        harness.deps,
        requireThreadRow(harness, fixture.threadId),
        {
                    id: fixture.environmentId,
        },
      );

      const cancelCommand = getSingleCommandByType(
        harness,
        "environment.provision.cancel",
      );
      const cancelAttemptId = ensureCommandDelivered(harness, {
        commandId: cancelCommand.id,
        hostId: fixture.hostId,
        sessionId: fixture.sessionId,
      });
      await handleCommandResult(harness.deps, {
        attemptId: cancelAttemptId,
        commandId: cancelCommand.id,
        completedAt: Date.now(),
        ok: false,
        errorCode: "environment_cancel_failed",
        errorMessage: "cancel failed",
        type: "environment.provision.cancel",
      });

      expect(warnSpy).toHaveBeenCalledWith(
        {
          activeProvisionOperationCommandId: fixture.commandId,
          activeProvisionOperationKind: "provision",
          activeProvisionOperationState: "queued",
          commandId: cancelCommand.id,
          environmentId: fixture.environmentId,
          errorCode: "environment_cancel_failed",
          errorMessage: "cancel failed",
          stoppedThreadCount: 1,
          stoppedThreadIds: [fixture.threadId],
        },
        "Environment provision cancel command failed",
      );
      expect(getCommand(harness.db, fixture.commandId)).toMatchObject({
        state: "fetched",
      });
      expect(getCommand(harness.db, cancelCommand.id)).toMatchObject({
        state: "error",
      });
      expect(getThread(harness.db, fixture.threadId)).toMatchObject({
        status: "provisioning",
      });
      expect(
        requireThreadRow(harness, fixture.threadId).stopRequestedAt,
      ).toEqual(expect.any(Number));
      expect(
        getEnvironmentOperation(harness.db, {
          environmentId: fixture.environmentId,
          kind: "provision",
        }),
      ).toMatchObject({
        commandId: fixture.commandId,
        state: "queued",
      });

      const retryCancelCommand = await waitForQueuedCommandAfter(
        harness,
        cancelCommand.cursor,
        ({ command, row }) =>
          command.type === "environment.provision.cancel" &&
          command.environmentId === fixture.environmentId &&
          row.state === "pending",
      );
      expect(retryCancelCommand.row.id).not.toBe(cancelCommand.id);
    });
  });

  it("keeps stopped provisioning out of error when failure arrives before cancel result", async () => {
    await withTestHarness(async (harness) => {
      const fixture = seedProvisioningThread(harness);
      const provisionAttemptId = ensureCommandDelivered(harness, {
        commandId: fixture.commandId,
        hostId: fixture.hostId,
        sessionId: fixture.sessionId,
      });

      requestThreadStopForCurrentState(
        harness.deps,
        requireThreadRow(harness, fixture.threadId),
        {
                    id: fixture.environmentId,
        },
      );

      const cancelCommand = getSingleCommandByType(
        harness,
        "environment.provision.cancel",
      );
      await handleCommandResult(harness.deps, {
        attemptId: provisionAttemptId,
        commandId: fixture.commandId,
        completedAt: Date.now(),
        ok: false,
        errorCode: "workspace_setup_failed",
        errorMessage: "setup failed",
        type: "environment.provision",
      });

      expect(getThread(harness.db, fixture.threadId)).toMatchObject({
        status: "provisioning",
      });
      expect(
        requireThreadRow(harness, fixture.threadId).stopRequestedAt,
      ).toEqual(expect.any(Number));
      expect(
        getEnvironmentOperation(harness.db, {
          environmentId: fixture.environmentId,
          kind: "provision",
        }),
      ).toMatchObject({ state: "failed" });
      expect(
        listEvents(harness.db, { threadId: fixture.threadId }).map(
          (event) => event.type,
        ),
      ).toEqual(["system/thread/interrupted", "system/thread-provisioning"]);

      const cancelAttemptId = ensureCommandDelivered(harness, {
        commandId: cancelCommand.id,
        hostId: fixture.hostId,
        sessionId: fixture.sessionId,
      });
      await handleCommandResult(harness.deps, {
        attemptId: cancelAttemptId,
        commandId: cancelCommand.id,
        completedAt: Date.now(),
        ok: true,
        result: { aborted: true },
        type: "environment.provision.cancel",
      });

      expect(getThread(harness.db, fixture.threadId)).toMatchObject({
        status: "idle",
        stopRequestedAt: null,
      });
    });
  });
});

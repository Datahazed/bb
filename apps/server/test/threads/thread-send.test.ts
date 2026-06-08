import { describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import {
  clientTurnRequests,
  getThread,
  markClientTurnRequestAcceptedInTransaction,
} from "@bb/db";
import type { PromptInput } from "@bb/domain";
import { sendQueuedMessage } from "../../src/services/threads/queued-messages.js";
import { sendThreadMessage } from "../../src/services/threads/thread-send.js";
import { buildThreadTimeline } from "../../src/services/threads/timeline.js";
import {
  listQueuedThreadCommands,
  reportQueuedCommandError,
  reportQueuedCommandSuccess,
  waitForQueuedCommand,
} from "../helpers/commands.js";
import { createCommandApprovalPayload } from "../helpers/pending-interactions.js";
import { assertPromptHistoryForTurnRequest } from "../helpers/prompt-history.js";
import {
  seedEnvironment,
  seedHostSession,
  seedProjectWithSource,
  seedQueuedMessage,
  seedThread,
  seedThreadRuntimeState,
  seedTurnStarted,
} from "../helpers/seed.js";
import { withTestHarness } from "../helpers/test-app.js";

interface ActiveSendPromptHistoryCase {
  input: PromptInput[];
  label: string;
  mode: "auto" | "steer";
  providerThreadId: string;
  turnId: string;
}

const activeSendPromptHistoryCases: ActiveSendPromptHistoryCase[] = [
  {
    input: [{ type: "text", text: "continue active work" }],
    label: "auto",
    mode: "auto",
    providerThreadId: "provider-thread-send-auto-history",
    turnId: "turn-send-auto-history",
  },
  {
    input: [{ type: "text", text: "adjust active work" }],
    label: "steer",
    mode: "steer",
    providerThreadId: "provider-thread-send-steer-history",
    turnId: "turn-send-steer-history",
  },
];

describe("sendThreadMessage", () => {
  it("rejects user sends while the thread is awaiting interaction", async () => {
    await withTestHarness(async (harness) => {
      const { host, session } = seedHostSession(harness.deps, {
        id: "host-thread-send-awaiting-interaction",
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
      });
      const thread = seedThread(harness.deps, {
        environmentId: environment.id,
        projectId: project.id,
      });
      seedTurnStarted(harness.deps, {
        threadId: thread.id,
        environmentId: environment.id,
        turnId: "turn-send-blocked",
        providerThreadId: "provider-thread-send-blocked",
      });

      const registered =
        harness.deps.pendingInteractions.registerPendingInteraction({
          interaction: {
            threadId: thread.id,
            turnId: "turn-send-blocked",
            providerId: thread.providerId,
            providerThreadId: "provider-thread-send-blocked",
            providerRequestId: "request-send-blocked",
            payload: createCommandApprovalPayload(),
          },
          sessionId: session.id,
        });
      expect(registered.outcome).toBe("created");

      await expect(
        sendThreadMessage(harness.deps, {
          environment,
          payload: {
            input: [{ type: "text", text: "blocked user send" }],
            mode: "auto",
            model: "gpt-5.4",
            permissionMode: "full",
            reasoningLevel: "medium",
            serviceTier: "default",
          },
          thread,
          trigger: "user",
        }),
      ).rejects.toMatchObject({
        status: 409,
        body: {
          code: "awaiting_user_interaction",
        },
      });

      expect(harness.engineRouting.dispatched).toEqual([]);
    });
  });

  it("records thread prompt history for start sends on idle threads", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps, {
        id: "host-thread-send-start-history",
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
      });
      const thread = seedThread(harness.deps, {
        environmentId: environment.id,
        projectId: project.id,
        status: "idle",
      });
      const input: PromptInput[] = [{ type: "text", text: "start idle work" }];

      await sendThreadMessage(harness.deps, {
        environment,
        payload: {
          input,
          mode: "start",
          model: "gpt-5.4",
          permissionMode: "full",
          reasoningLevel: "medium",
          serviceTier: "default",
        },
        thread,
        trigger: "user",
      });

      assertPromptHistoryForTurnRequest({
        db: harness.db,
        threadId: thread.id,
        scope: "thread",
        input,
      });
      const startCommand = await waitForQueuedCommand(
        harness,
        ({ command }) =>
          command.type === "thread.start" && command.threadId === thread.id,
      );
      if (startCommand.command.type !== "thread.start") {
        throw new Error("Expected thread.start command");
      }
      expect(harness.db.select().from(clientTurnRequests).all()).toMatchObject([
        {
          requestId: startCommand.command.requestId,
          status: "pending",
          threadId: thread.id,
        },
      ]);
    });
  });

  it("advances read state when user sends append turn requests", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps, {
        id: "host-thread-send-read-state-notification",
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
      });
      const thread = seedThread(harness.deps, {
        environmentId: environment.id,
        projectId: project.id,
        status: "idle",
      });
      const beforeLastReadAt = getThread(harness.db, thread.id)?.lastReadAt;
      const notifyThreadSpy = vi.spyOn(harness.hub, "notifyThread");

      await sendThreadMessage(harness.deps, {
        environment,
        payload: {
          input: [{ type: "text", text: "advance read state" }],
          mode: "start",
          model: "gpt-5.4",
          permissionMode: "full",
          reasoningLevel: "medium",
          serviceTier: "default",
        },
        thread,
        trigger: "user",
      });

      const updatedThread = getThread(harness.db, thread.id);
      expect(updatedThread?.lastReadAt).toEqual(expect.any(Number));
      expect(updatedThread?.lastReadAt).not.toBe(beforeLastReadAt);
      expect(notifyThreadSpy).toHaveBeenCalledWith(
        thread.id,
        ["events-appended", "read-state-changed"],
        {
          eventTypes: ["client/turn/requested"],
          projectId: thread.projectId,
        },
      );
    });
  });

  it.each(activeSendPromptHistoryCases)(
    "records thread prompt history for $label sends on active threads",
    async ({ input, mode, providerThreadId, turnId }) => {
      await withTestHarness(async (harness) => {
        const { host } = seedHostSession(harness.deps, {
          id: `host-thread-send-${mode}-history`,
        });
        const { project } = seedProjectWithSource(harness.deps, {
          hostId: host.id,
        });
        const environment = seedEnvironment(harness.deps, {
          hostId: host.id,
          projectId: project.id,
        });
        const thread = seedThread(harness.deps, {
          environmentId: environment.id,
          projectId: project.id,
          status: "active",
        });
        seedThreadRuntimeState(harness.deps, {
          threadId: thread.id,
          environmentId: environment.id,
          providerThreadId,
        });
        seedTurnStarted(harness.deps, {
          threadId: thread.id,
          environmentId: environment.id,
          turnId,
          providerThreadId,
        });

        await sendThreadMessage(harness.deps, {
          environment,
          payload: {
            input,
            mode,
            model: "gpt-5.4",
            permissionMode: "full",
            reasoningLevel: "medium",
            serviceTier: "default",
          },
          thread,
          trigger: "user",
        });

        assertPromptHistoryForTurnRequest({
          db: harness.db,
          threadId: thread.id,
          scope: "thread",
          input,
        });
        const turnSubmitCommand = await waitForQueuedCommand(
          harness,
          ({ command }) =>
            command.type === "turn.submit" && command.threadId === thread.id,
        );
        if (turnSubmitCommand.command.type !== "turn.submit") {
          throw new Error("Expected turn.submit command");
        }
        expect(
          harness.db.select().from(clientTurnRequests).all(),
        ).toMatchObject([
          {
            requestId: turnSubmitCommand.command.requestId,
            status: "pending",
            threadId: thread.id,
          },
        ]);
      });
    },
  );

  it.each([
    { providerId: "claude-code", workflowsEnabled: true },
    { providerId: "codex", workflowsEnabled: false },
  ])(
    "fills workflowsEnabled $workflowsEnabled into turn.submit runtime options for $providerId threads",
    async ({ providerId, workflowsEnabled }) => {
      await withTestHarness(async (harness) => {
        const { host } = seedHostSession(harness.deps, {
          id: `host-thread-send-workflows-${providerId}`,
        });
        const { project } = seedProjectWithSource(harness.deps, {
          hostId: host.id,
        });
        const environment = seedEnvironment(harness.deps, {
          hostId: host.id,
          projectId: project.id,
        });
        const thread = seedThread(harness.deps, {
          environmentId: environment.id,
          projectId: project.id,
          providerId,
          status: "active",
        });
        const providerThreadId = `provider-thread-workflows-${providerId}`;
        seedThreadRuntimeState(harness.deps, {
          threadId: thread.id,
          environmentId: environment.id,
          providerThreadId,
        });
        seedTurnStarted(harness.deps, {
          threadId: thread.id,
          environmentId: environment.id,
          turnId: `turn-workflows-${providerId}`,
          providerThreadId,
        });

        await sendThreadMessage(harness.deps, {
          environment,
          payload: {
            input: [{ type: "text", text: "check workflows policy" }],
            mode: "auto",
            model: "gpt-5.4",
            permissionMode: "full",
            reasoningLevel: "medium",
            serviceTier: "default",
          },
          thread,
          trigger: "user",
        });

        const turnSubmits = listQueuedThreadCommands(
          harness,
          "turn.submit",
          thread.id,
        );
        expect(turnSubmits).toHaveLength(1);
        const command = turnSubmits[0];
        if (command?.type !== "turn.submit") {
          throw new Error("Expected a turn.submit command");
        }
        // The server-owned policy is the only writer of this field; it must
        // arrive in the daemon command filled per provider.
        expect(command.options.workflowsEnabled).toBe(workflowsEnabled);
      });
    },
  );

  it("settles successful thread.start requests without native acceptance events", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps, {
        id: "host-thread-send-start-success-settlement",
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
      });
      const thread = seedThread(harness.deps, {
        environmentId: environment.id,
        projectId: project.id,
      });

      await sendThreadMessage(harness.deps, {
        environment,
        payload: {
          input: [{ type: "text", text: "start without native acceptance" }],
          mode: "start",
          model: "gpt-5.4",
          permissionMode: "full",
          reasoningLevel: "medium",
          serviceTier: "default",
        },
        thread,
        trigger: "user",
      });
      const queued = await waitForQueuedCommand(
        harness,
        ({ command, row }) =>
          row.state === "pending" &&
          command.type === "thread.start" &&
          command.threadId === thread.id,
      );
      const response = await reportQueuedCommandSuccess(harness, queued, {
        providerThreadId: "provider-thread-start-success-settlement",
      });
      expect(response.status).toBe(200);

      const lifecycleRow = harness.db
        .select()
        .from(clientTurnRequests)
        .where(eq(clientTurnRequests.threadId, thread.id))
        .get();
      expect(lifecycleRow).toMatchObject({
        reasonCode: "command_succeeded",
        settledAt: expect.any(Number),
        status: "accepted",
        threadId: thread.id,
      });
    });
  });

  it("keeps native acceptance reason when command success settles later", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps, {
        id: "host-thread-send-native-accepted-first",
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
      });
      const thread = seedThread(harness.deps, {
        environmentId: environment.id,
        projectId: project.id,
      });

      await sendThreadMessage(harness.deps, {
        environment,
        payload: {
          input: [{ type: "text", text: "native accepted first" }],
          mode: "start",
          model: "gpt-5.4",
          permissionMode: "full",
          reasoningLevel: "medium",
          serviceTier: "default",
        },
        thread,
        trigger: "user",
      });
      const queued = await waitForQueuedCommand(
        harness,
        ({ command, row }) =>
          row.state === "pending" &&
          command.type === "thread.start" &&
          command.threadId === thread.id,
      );
      const pendingLifecycleRow = harness.db
        .select()
        .from(clientTurnRequests)
        .where(eq(clientTurnRequests.threadId, thread.id))
        .get();
      if (!pendingLifecycleRow) {
        throw new Error("Expected pending lifecycle row");
      }
      harness.db.transaction((tx) => {
        markClientTurnRequestAcceptedInTransaction(tx, {
          requestId: pendingLifecycleRow.requestId,
          settledAt: Date.now(),
          threadId: pendingLifecycleRow.threadId,
        });
      });

      const response = await reportQueuedCommandSuccess(harness, queued, {
        providerThreadId: "provider-thread-native-accepted-first",
      });
      expect(response.status).toBe(200);

      expect(
        harness.db
          .select()
          .from(clientTurnRequests)
          .where(eq(clientTurnRequests.threadId, thread.id))
          .get(),
      ).toMatchObject({
        reasonCode: "accepted",
        status: "accepted",
        threadId: thread.id,
      });
    });
  });

  it("settles successful turn.submit requests without native acceptance events", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps, {
        id: "host-thread-send-submit-success-settlement",
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
      });
      const thread = seedThread(harness.deps, {
        environmentId: environment.id,
        projectId: project.id,
        status: "active",
      });
      seedThreadRuntimeState(harness.deps, {
        threadId: thread.id,
        environmentId: environment.id,
        providerThreadId: "provider-thread-submit-success-settlement",
      });
      seedTurnStarted(harness.deps, {
        threadId: thread.id,
        environmentId: environment.id,
        turnId: "turn-submit-success-settlement",
        providerThreadId: "provider-thread-submit-success-settlement",
      });

      await sendThreadMessage(harness.deps, {
        environment,
        payload: {
          input: [{ type: "text", text: "submit without native acceptance" }],
          mode: "auto",
          model: "gpt-5.4",
          permissionMode: "full",
          reasoningLevel: "medium",
          serviceTier: "default",
        },
        thread,
        trigger: "user",
      });
      const queued = await waitForQueuedCommand(
        harness,
        ({ command, row }) =>
          row.state === "pending" &&
          command.type === "turn.submit" &&
          command.threadId === thread.id,
      );
      const response = await reportQueuedCommandSuccess(harness, queued, {
        appliedAs: "new-turn",
      });
      expect(response.status).toBe(200);

      const lifecycleRow = harness.db
        .select()
        .from(clientTurnRequests)
        .where(eq(clientTurnRequests.threadId, thread.id))
        .get();
      expect(lifecycleRow).toMatchObject({
        reasonCode: "command_succeeded",
        settledAt: expect.any(Number),
        status: "accepted",
        threadId: thread.id,
      });
    });
  });

  it("settles failed turn.submit requests and does not render them as pending", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps, {
        id: "host-thread-send-submit-failure-settlement",
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
      });
      const thread = seedThread(harness.deps, {
        environmentId: environment.id,
        projectId: project.id,
        status: "active",
      });
      seedThreadRuntimeState(harness.deps, {
        threadId: thread.id,
        environmentId: environment.id,
        providerThreadId: "provider-thread-submit-failure-settlement",
      });
      seedTurnStarted(harness.deps, {
        threadId: thread.id,
        environmentId: environment.id,
        turnId: "turn-submit-failure-settlement",
        providerThreadId: "provider-thread-submit-failure-settlement",
      });

      await sendThreadMessage(harness.deps, {
        environment,
        payload: {
          input: [
            {
              type: "text",
              text: "submit failure without native acceptance",
            },
          ],
          mode: "auto",
          model: "gpt-5.4",
          permissionMode: "full",
          reasoningLevel: "medium",
          serviceTier: "default",
        },
        thread,
        trigger: "user",
      });
      const queued = await waitForQueuedCommand(
        harness,
        ({ command, row }) =>
          row.state === "pending" &&
          command.type === "turn.submit" &&
          command.threadId === thread.id,
      );
      const response = await reportQueuedCommandError(harness, queued, {
        errorCode: "provider_error",
        errorMessage: "Provider rejected the turn",
      });
      expect(response.status).toBe(200);

      const lifecycleRow = harness.db
        .select()
        .from(clientTurnRequests)
        .where(eq(clientTurnRequests.threadId, thread.id))
        .get();
      expect(lifecycleRow).toMatchObject({
        message: "Provider rejected the turn",
        reasonCode: "command_failed",
        settledAt: expect.any(Number),
        status: "failed",
        threadId: thread.id,
      });

      const timeline = buildThreadTimeline(harness.db, thread, {
        isDevelopment: false,
        page: {
          kind: "latest",
          segmentLimit: 100,
        },
        timelineViewMode: "standard",
      });
      const pendingRows = timeline.rows.filter(
        (row) =>
          row.kind === "conversation" &&
          row.role === "user" &&
          row.text === "submit failure without native acceptance" &&
          row.turnRequest.status === "pending",
      );
      expect(pendingRows).toHaveLength(0);
    });
  });

  it("records thread prompt history for idle queued message auto-sends", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps, {
        id: "host-thread-send-queued-message-history",
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
      });
      const thread = seedThread(harness.deps, {
        environmentId: environment.id,
        projectId: project.id,
        status: "idle",
      });
      seedThreadRuntimeState(harness.deps, {
        threadId: thread.id,
        environmentId: environment.id,
        providerThreadId: "provider-thread-send-queued-message-history",
      });
      const input: PromptInput[] = [
        { type: "text", text: "send queued message" },
      ];
      const queuedMessage = seedQueuedMessage(harness.deps, {
        threadId: thread.id,
        content: input,
      });

      await sendQueuedMessage(harness.deps, {
        mode: "auto",
        queuedMessageId: queuedMessage.id,
        threadId: thread.id,
      });

      assertPromptHistoryForTurnRequest({
        db: harness.db,
        threadId: thread.id,
        scope: "thread",
        input,
      });
      expect(
        listQueuedThreadCommands(harness, "turn.submit", thread.id),
      ).toHaveLength(1);
    });
  });

  it("allows queued auto-dispatch while the thread is awaiting interaction", async () => {
    await withTestHarness(async (harness) => {
      const { host, session } = seedHostSession(harness.deps, {
        id: "host-thread-send-auto-dispatch",
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
      });
      const thread = seedThread(harness.deps, {
        environmentId: environment.id,
        projectId: project.id,
      });
      seedTurnStarted(harness.deps, {
        threadId: thread.id,
        environmentId: environment.id,
        turnId: "turn-send-auto-dispatch",
        providerThreadId: "provider-thread-send-auto-dispatch",
      });

      const registered =
        harness.deps.pendingInteractions.registerPendingInteraction({
          interaction: {
            threadId: thread.id,
            turnId: "turn-send-auto-dispatch",
            providerId: thread.providerId,
            providerThreadId: "provider-thread-send-auto-dispatch",
            providerRequestId: "request-send-auto-dispatch",
            payload: createCommandApprovalPayload(),
          },
          sessionId: session.id,
        });
      expect(registered.outcome).toBe("created");

      await sendThreadMessage(harness.deps, {
        environment,
        payload: {
          input: [{ type: "text", text: "auto dispatch send" }],
          mode: "auto",
          model: "gpt-5.4",
          permissionMode: "full",
          reasoningLevel: "medium",
          serviceTier: "default",
        },
        thread,
        trigger: "auto-dispatch",
      });

      const queuedCommands = harness.engineRouting.dispatched.map(
        (envelope) => envelope.command,
      );
      expect(queuedCommands).toHaveLength(1);
      expect(["thread.start", "turn.submit"]).toContain(
        queuedCommands[0]?.type,
      );
    });
  });
});

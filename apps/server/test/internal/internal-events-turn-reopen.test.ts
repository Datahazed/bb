import { getThread } from "@bb/db";
import { threadScope, turnScope } from "@bb/domain";
import {
  groupHostDaemonEvents,
  type HostDaemonEventEnvelope,
} from "@bb/host-daemon-contract";
import { describe, expect, it } from "vitest";
import { internalAuthHeaders } from "../helpers/commands.js";
import {
  seedEnvironment,
  seedHostSession,
  seedProjectWithSource,
  seedThread,
} from "../helpers/seed.js";
import { createTestAppHarness } from "../helpers/test-app.js";

const PROVIDER_THREAD_ID = "codex-thread-reopen";

async function setup() {
  const harness = await createTestAppHarness();
  const { host, session } = seedHostSession(harness.deps, {});
  const { project } = seedProjectWithSource(harness.deps, { hostId: host.id });
  const environment = seedEnvironment(harness.deps, {
    hostId: host.id,
    projectId: project.id,
  });
  const thread = seedThread(harness.deps, {
    projectId: project.id,
    environmentId: environment.id,
    status: "active",
  });
  const post = (events: HostDaemonEventEnvelope[]) =>
    harness.app.request("/internal/session/events", {
      method: "POST",
      headers: internalAuthHeaders(harness),
      body: JSON.stringify({
        sessionId: session.id,
        eventGroups: groupHostDaemonEvents(events),
      }),
    });
  const status = () => getThread(harness.db, thread.id)?.status;
  return { harness, thread, post, status };
}

function turnStarted(
  threadId: string,
  turnId: string,
  options: { parentToolCallId?: string } = {},
): HostDaemonEventEnvelope {
  return {
    threadId,
    event: {
      type: "turn/started",
      threadId,
      providerThreadId: PROVIDER_THREAD_ID,
      scope: turnScope(turnId),
      ...(options.parentToolCallId
        ? { parentToolCallId: options.parentToolCallId }
        : {}),
    },
  };
}

function turnCompleted(
  threadId: string,
  turnId: string,
): HostDaemonEventEnvelope {
  return {
    threadId,
    event: {
      type: "turn/completed",
      threadId,
      providerThreadId: PROVIDER_THREAD_ID,
      scope: turnScope(turnId),
      status: "completed",
    },
  };
}

function commandStarted(
  threadId: string,
  turnId: string,
  id: string,
  options: { parentToolCallId?: string } = {},
): HostDaemonEventEnvelope {
  return {
    threadId,
    event: {
      type: "item/started",
      threadId,
      providerThreadId: PROVIDER_THREAD_ID,
      scope: turnScope(turnId),
      item: {
        type: "commandExecution",
        id,
        command: "npm test",
        cwd: "/repo",
        status: "pending",
        approvalStatus: null,
        ...(options.parentToolCallId
          ? { parentToolCallId: options.parentToolCallId }
          : {}),
      },
    },
  };
}

function interrupted(threadId: string): HostDaemonEventEnvelope {
  return {
    threadId,
    event: {
      type: "system/thread/interrupted",
      threadId,
      scope: threadScope(),
      reason: "manual-stop",
    },
  };
}

describe("root provider work on a turn the thread already settled (#1646)", () => {
  it("reactivates the thread when work resumes on a completed turn and settles on its re-completion", async () => {
    const { harness, thread, post, status } = await setup();
    try {
      expect(
        (
          await post([
            turnStarted(thread.id, "turn-x"),
            turnCompleted(thread.id, "turn-x"),
          ])
        ).status,
      ).toBe(200);
      expect(status()).toBe("idle");

      expect(
        (await post([commandStarted(thread.id, "turn-x", "cmd-1")])).status,
      ).toBe(200);
      expect(status()).toBe("active");

      expect((await post([turnCompleted(thread.id, "turn-x")])).status).toBe(
        200,
      );
      expect(status()).toBe("idle");
    } finally {
      await harness.cleanup();
    }
  });

  it("reactivates the thread when an unlinked auxiliary turn settles it while the root turn is still open", async () => {
    const { harness, thread, post, status } = await setup();
    try {
      expect(
        (
          await post([
            turnStarted(thread.id, "turn-a"),
            turnStarted(thread.id, "turn-b"),
            turnCompleted(thread.id, "turn-b"),
          ])
        ).status,
      ).toBe(200);
      expect(status()).toBe("idle");

      expect(
        (await post([commandStarted(thread.id, "turn-a", "cmd-1")])).status,
      ).toBe(200);
      expect(status()).toBe("active");

      expect((await post([turnCompleted(thread.id, "turn-a")])).status).toBe(
        200,
      );
      expect(status()).toBe("idle");
    } finally {
      await harness.cleanup();
    }
  });

  it("keeps a stopped thread idle when late work arrives on the stopped turn", async () => {
    const { harness, thread, post, status } = await setup();
    try {
      expect(
        (
          await post([
            turnStarted(thread.id, "turn-x"),
            turnCompleted(thread.id, "turn-x"),
            interrupted(thread.id),
          ])
        ).status,
      ).toBe(200);
      expect(status()).toBe("idle");

      expect(
        (await post([commandStarted(thread.id, "turn-x", "cmd-1")])).status,
      ).toBe(200);
      expect(status()).toBe("idle");
    } finally {
      await harness.cleanup();
    }
  });

  it("ignores delegated child work and work on a superseded completed turn", async () => {
    const { harness, thread, post, status } = await setup();
    try {
      expect(
        (
          await post([
            turnStarted(thread.id, "turn-1"),
            turnCompleted(thread.id, "turn-1"),
            turnStarted(thread.id, "turn-2"),
            turnCompleted(thread.id, "turn-2"),
          ])
        ).status,
      ).toBe(200);
      expect(status()).toBe("idle");

      // A stale item on turn-1: turn-2 ran after it, so nothing will settle
      // turn-1 again.
      expect(
        (await post([commandStarted(thread.id, "turn-1", "cmd-stale")])).status,
      ).toBe(200);
      expect(status()).toBe("idle");

      // Delegated child work on the latest turn is not root activity.
      expect(
        (
          await post([
            commandStarted(thread.id, "turn-2", "cmd-child", {
              parentToolCallId: "tool-1",
            }),
          ])
        ).status,
      ).toBe(200);
      expect(status()).toBe("idle");
    } finally {
      await harness.cleanup();
    }
  });
});

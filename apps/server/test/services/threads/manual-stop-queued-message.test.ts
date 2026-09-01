import { getThread, listQueuedThreadMessages } from "@bb/db";
import { describe, expect, it } from "vitest";
import { sendNextQueuedMessageIfPresent } from "../../../src/services/threads/queued-messages.js";
import { applyLoggedThreadLifecycleEvent } from "../../../src/services/threads/lifecycle-outcome.js";
import {
  registerHostRpcResponder,
  type HostRpcHandlerResult,
} from "../../helpers/host-rpc.js";
import {
  seedQueuedMessage,
  seedThreadFixture,
  seedThreadRuntimeState,
} from "../../helpers/seed.js";
import { withTestHarness } from "../../helpers/test-app.js";

describe("manual stop queued message delivery", () => {
  it("keeps queued work parked after a user-requested stop", async () => {
    await withTestHarness(async (harness) => {
      const { environment, host, session, thread } = seedThreadFixture(
        harness,
        {
          thread: { status: "active" },
        },
      );
      seedThreadRuntimeState(harness.deps, {
        environmentId: environment.id,
        providerThreadId: "provider-stopped-queue",
        threadId: thread.id,
      });
      seedQueuedMessage(harness.deps, {
        content: [{ type: "text", text: "queued work", mentions: [] }],
        threadId: thread.id,
      });
      const responder = registerHostRpcResponder(harness, {
        hostId: host.id,
        sessionId: session.id,
        handle: ({ command }): HostRpcHandlerResult => {
          if (command.type === "thread.stop") {
            return { ok: true, result: { providerCheckpointId: null } };
          }
          if (command.type === "host.list_files") {
            return { ok: true, result: { files: [], truncated: false } };
          }
          if (command.type === "host.read_file") {
            return {
              ok: false,
              errorCode: "ENOENT",
              errorMessage: "Path does not exist",
            };
          }
          if (command.type === "turn.submit") {
            return { ok: true, result: { appliedAs: "new-turn" } };
          }
          throw new Error(`Unexpected command ${command.type}`);
        },
      });

      const response = await harness.app.request(
        `/api/v1/threads/${thread.id}/stop`,
        { method: "POST" },
      );

      expect(response.status).toBe(200);
      expect(getThread(harness.db, thread.id)?.status).toBe("idle");
      expect(
        await sendNextQueuedMessageIfPresent(harness.deps, {
          threadId: thread.id,
        }),
      ).toBe(false);
      expect(listQueuedThreadMessages(harness.db, thread.id)).toHaveLength(1);
      expect(
        responder.requests.filter(
          ({ command }) => command.type === "turn.submit",
        ),
      ).toHaveLength(0);

      const resumeResponse = await harness.app.request(
        `/api/v1/threads/${thread.id}/send`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            mode: "start",
            input: [{ type: "text", text: "resume", mentions: [] }],
          }),
        },
      );
      expect(resumeResponse.status).toBe(200);
      applyLoggedThreadLifecycleEvent(harness.deps, {
        event: { type: "run.succeeded" },
        threadId: thread.id,
      });
      expect(
        await sendNextQueuedMessageIfPresent(harness.deps, {
          threadId: thread.id,
        }),
      ).toBe(true);
      expect(listQueuedThreadMessages(harness.db, thread.id)).toHaveLength(0);
      expect(
        responder.requests.filter(
          ({ command }) => command.type === "turn.submit",
        ),
      ).toHaveLength(2);
    });
  }, 15_000);
});

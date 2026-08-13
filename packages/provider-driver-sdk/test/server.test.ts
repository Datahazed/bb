import {
  providerDriverEventNotificationSchema,
  providerDriverHostRequestSchema,
  providerDriverRequestSchema,
  providerDriverRpcResponseSchema,
} from "@bb/provider-driver-contract";
import { describe, expect, it, vi } from "vitest";
import { ProviderDriverServer, defineProviderDriver } from "../src/index.js";
import {
  makeInitializeParams,
  makeSessionOpenParams,
  makeTurnSubmitParams,
} from "./fixtures.js";
import { ProviderDriverTestPeer } from "./test-peer.js";

function makeDriver(
  overrides: {
    onSubmit?: () => void;
  } = {},
) {
  return defineProviderDriver({
    identity: { pluginId: "fake", driverId: "fake", providerId: "fake" },
    processCapabilities: { multiplexSessions: true },
    inspect: () => ({
      readiness: { status: "ready" },
      capabilities: {
        multiplexSessions: true,
        supportedSessionOperations: [],
        supportedPermissionModes: ["full"],
        supportsServiceTier: false,
        supportsSteering: true,
        supportsUserQuestions: false,
      },
      models: [],
      selectedOnlyModels: [],
      diagnostics: [],
    }),
    openSession: () => ({
      providerSessionId: "provider-session-1",
      sessionFormatVersion: null,
    }),
    detachSession: () => ({ providerCheckpointId: null }),
    discardSession: () => {},
    submitTurn: (params, context) => {
      overrides.onSubmit?.();
      const turnId =
        params.mode === "start" ? params.turnId : params.expectedTurnId;
      context.events.emit({
        type: "item.started",
        attachmentId: params.attachmentId,
        turnId,
        item: { type: "agentMessage", id: "item-1", text: "" },
      });
      context.events.emit({
        type: "item.completed",
        attachmentId: params.attachmentId,
        turnId,
        item: { type: "agentMessage", id: "item-1", text: "Hello" },
        outcome: "completed",
        error: null,
      });
      context.events.emit({
        type: "turn.settled",
        attachmentId: params.attachmentId,
        turnId,
        outcome: "completed",
        error: null,
        providerCheckpointId: null,
      });
      return {
        outcome: "accepted",
        disposition: params.mode === "start" ? "started" : "steered",
        turnId,
        providerTurnId: null,
      };
    },
    cancelTurn: () => ({ outcome: "cancellation_requested" }),
  });
}

async function initializeAndOpen(peer: ProviderDriverTestPeer): Promise<void> {
  await peer.request(
    providerDriverRequestSchema.parse({
      jsonrpc: "2.0",
      id: 1,
      method: "driver.initialize",
      params: makeInitializeParams(),
    }),
  );
  await peer.request(
    providerDriverRequestSchema.parse({
      jsonrpc: "2.0",
      id: 2,
      method: "session.open",
      params: makeSessionOpenParams(),
    }),
  );
}

describe("ProviderDriverServer", () => {
  it("buffers events until acceptance, sequences them, and replays operations", async () => {
    const peer = new ProviderDriverTestPeer();
    const onSubmit = vi.fn();
    const server = new ProviderDriverServer({
      driver: makeDriver({ onSubmit }),
      readable: peer.driverReadable,
      writable: peer.driverWritable,
    });
    await initializeAndOpen(peer);

    const submitParams = makeTurnSubmitParams();
    const submitResponse = await peer.request(
      providerDriverRequestSchema.parse({
        jsonrpc: "2.0",
        id: 3,
        method: "turn.submit",
        params: submitParams,
      }),
    );
    expect(submitResponse).toMatchObject({
      id: 3,
      result: { outcome: "accepted", turnId: "turn-1" },
    });
    await peer.waitForMessageCount(3);
    const events = peer.messages
      .splice(0, 3)
      .map((message) => providerDriverEventNotificationSchema.parse(message));
    expect(events.map((event) => event.params.sequence)).toEqual([1, 2, 3]);
    expect(events.map((event) => event.params.type)).toEqual([
      "item.started",
      "item.completed",
      "turn.settled",
    ]);

    const replay = await peer.request(
      providerDriverRequestSchema.parse({
        jsonrpc: "2.0",
        id: 4,
        method: "turn.submit",
        params: submitParams,
      }),
    );
    expect(replay).toMatchObject({
      id: 4,
      result: { outcome: "accepted", turnId: "turn-1" },
    });
    expect(onSubmit).toHaveBeenCalledTimes(1);

    const conflictParams = {
      ...submitParams,
      inputGroups: [
        [{ type: "text" as const, text: "Different", mentions: [] }],
      ],
    };
    const conflict = await peer.request(
      providerDriverRequestSchema.parse({
        jsonrpc: "2.0",
        id: 5,
        method: "turn.submit",
        params: conflictParams,
      }),
    );
    expect(conflict).toMatchObject({
      error: { data: { code: "operation_conflict" } },
    });
    expect(onSubmit).toHaveBeenCalledTimes(1);

    await peer.request(
      providerDriverRequestSchema.parse({
        jsonrpc: "2.0",
        id: 6,
        method: "driver.shutdown",
        params: {},
      }),
    );
    await server.finished;
    expect(server.fatalError).toBeNull();
  });

  it("delays host calls made by background work until turn acceptance", async () => {
    const peer = new ProviderDriverTestPeer();
    let workerError: Error | null = null;
    const driver = defineProviderDriver({
      ...makeDriver(),
      submitTurn: (params, context) => {
        if (params.mode !== "start") {
          throw new Error("Expected start turn");
        }
        void context.host
          .callTool({
            attachmentId: params.attachmentId,
            turnId: params.turnId,
            callId: "call-1",
            tool: "read",
            arguments: { path: "README.md" },
          })
          .then(() => {
            context.events.emit({
              type: "turn.settled",
              attachmentId: params.attachmentId,
              turnId: params.turnId,
              outcome: "completed",
              error: null,
              providerCheckpointId: null,
            });
          })
          .catch((error: unknown) => {
            workerError =
              error instanceof Error ? error : new Error(String(error));
          });
        return {
          outcome: "accepted",
          disposition: "started",
          turnId: params.turnId,
          providerTurnId: null,
        };
      },
    });
    const server = new ProviderDriverServer({
      driver,
      readable: peer.driverReadable,
      writable: peer.driverWritable,
    });
    await initializeAndOpen(peer);

    peer.send(
      providerDriverRequestSchema.parse({
        jsonrpc: "2.0",
        id: 3,
        method: "turn.submit",
        params: makeTurnSubmitParams(),
      }),
    );
    await peer.waitForMessageCount(2);
    const submitResponse = providerDriverRpcResponseSchema.parse(
      peer.messages.shift(),
    );
    const hostRequest = providerDriverHostRequestSchema.parse(
      peer.messages.shift(),
    );
    expect(submitResponse).toMatchObject({
      id: 3,
      result: { outcome: "accepted" },
    });
    expect(hostRequest).toMatchObject({
      method: "host.tool.call",
      params: { callId: "call-1", turnId: "turn-1" },
    });

    peer.send({
      jsonrpc: "2.0",
      id: hostRequest.id,
      result: { success: true, content: [{ type: "text", text: "contents" }] },
    });
    await peer.waitForMessageCount(1);
    expect(
      providerDriverEventNotificationSchema.parse(peer.messages.shift()).params,
    ).toMatchObject({ type: "turn.settled", sequence: 1 });
    expect(workerError).toBeNull();

    await peer.request(
      providerDriverRequestSchema.parse({
        jsonrpc: "2.0",
        id: 4,
        method: "driver.shutdown",
        params: {},
      }),
    );
    await server.finished;
  });

  it("contains malformed framed input", async () => {
    const peer = new ProviderDriverTestPeer();
    const onFatalError = vi.fn();
    const server = new ProviderDriverServer({
      driver: makeDriver(),
      onFatalError,
      readable: peer.driverReadable,
      writable: peer.driverWritable,
    });

    peer.driverReadable.write(Buffer.from([0, 0, 0, 0]));
    await server.finished;

    expect(onFatalError).toHaveBeenCalledTimes(1);
    expect(server.fatalError?.message).toContain("cannot be empty");
  });
});

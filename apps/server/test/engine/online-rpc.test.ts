import { describe, expect, it } from "vitest";
import { callEngineOnlineRpc } from "../../src/services/engine/online-rpc.js";
import { ApiError } from "../../src/errors.js";
import { withTestHarness } from "../helpers/test-app.js";

describe("engine online RPC", () => {
  it("returns the engine handler result", async () => {
    await withTestHarness(async (harness) => {
      harness.engineRouting.bindOnlineRpcHandler(async (command) => {
        expect(command.type).toBe("host.list_paths");
        return {
          paths: [
            {
              kind: "directory",
              path: "/tmp/a",
              name: "a",
              score: 1,
              positions: [],
            },
          ],
          truncated: false,
        };
      });

      const result = await callEngineOnlineRpc(harness.deps, {
        command: {
          type: "host.list_paths",
          path: "/tmp",
          limit: 10,
          includeFiles: true,
          includeDirectories: true,
        },
        timeoutMs: 1_000,
      });
      expect(result.paths).toHaveLength(1);
    });
  });

  it("maps engine handler errors to 502 with the handler error code", async () => {
    await withTestHarness(async (harness) => {
      harness.engineRouting.bindOnlineRpcHandler(async () => {
        const error = new Error("boom");
        error.name = "ENOENT";
        throw Object.assign(error, { code: "ENOENT" });
      });

      const call = callEngineOnlineRpc(harness.deps, {
        command: {
          type: "host.list_paths",
          path: "/tmp/missing",
          limit: 10,
          includeFiles: true,
          includeDirectories: true,
        },
        timeoutMs: 1_000,
      });
      const error = await call.then(
        () => null,
        (caught: unknown) => caught,
      );
      if (!(error instanceof ApiError)) {
        throw new Error("Expected an ApiError from the failed RPC");
      }
      expect(error.status).toBe(502);
      expect(error.body.code).toBe("ENOENT");
      expect(error.body.message).toBe("boom");
    });
  });

  it("passes ApiErrors thrown by the engine handler through unchanged", async () => {
    await withTestHarness(async (harness) => {
      harness.engineRouting.bindOnlineRpcHandler(async () => {
        throw new ApiError(
          404,
          "replay_capture_not_found",
          "Replay capture not found",
        );
      });

      const call = callEngineOnlineRpc(harness.deps, {
        command: {
          type: "development.replay",
          operation: "capture-get",
          captureId: "rcap_missing",
        },
        timeoutMs: 1_000,
      });
      const error = await call.then(
        () => null,
        (caught: unknown) => caught,
      );
      if (!(error instanceof ApiError)) {
        throw new Error("Expected the handler ApiError to pass through");
      }
      expect(error.status).toBe(404);
      expect(error.body.code).toBe("replay_capture_not_found");
    });
  });

  it("times out with 504 command_timeout when the handler never resolves", async () => {
    await withTestHarness(async (harness) => {
      harness.engineRouting.bindOnlineRpcHandler(
        () => new Promise(() => undefined),
      );

      const call = callEngineOnlineRpc(harness.deps, {
        command: {
          type: "host.list_paths",
          path: "/tmp/slow",
          limit: 10,
          includeFiles: true,
          includeDirectories: true,
        },
        timeoutMs: 10,
      });
      const error = await call.then(
        () => null,
        (caught: unknown) => caught,
      );
      if (!(error instanceof ApiError)) {
        throw new Error("Expected an ApiError from the timed-out RPC");
      }
      expect(error.status).toBe(504);
      expect(error.body.code).toBe("command_timeout");
    });
  });
});

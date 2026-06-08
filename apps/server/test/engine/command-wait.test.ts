import type { HostDaemonCommand } from "@bb/host-daemon-contract";
import { describe, expect, it } from "vitest";
import { dispatchEngineCommandAndWait } from "../../src/services/engine/command-wait.js";
import { ApiError } from "../../src/errors.js";
import { withTestHarness, type TestAppHarness } from "../helpers/test-app.js";

type ThreadStopCommand = Extract<HostDaemonCommand, { type: "thread.stop" }>;

interface BuildThreadStopCommandArgs {
  threadId: string;
}

interface SettleThreadStopSuccessArgs {
  commandId: string;
  harness: TestAppHarness;
}

interface SettleThreadStopFailureArgs extends SettleThreadStopSuccessArgs {
  errorCode: string;
  errorMessage: string;
}

function buildThreadStopCommand(
  args: BuildThreadStopCommandArgs,
): ThreadStopCommand {
  return {
    type: "thread.stop",
    environmentId: "env-command-wait",
    threadId: args.threadId,
  };
}

async function waitForDispatchCount(
  harness: TestAppHarness,
  count: number,
): Promise<void> {
  while (harness.engineRouting.dispatched.length < count) {
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
}

async function settleThreadStopSuccess(
  args: SettleThreadStopSuccessArgs,
): Promise<void> {
  await args.harness.engineRouting.settle(args.harness.deps.engineDispatch, {
    commandId: args.commandId,
    completedAt: Date.now(),
    ok: true,
    result: {},
    type: "thread.stop",
  });
}

async function settleThreadStopFailure(
  args: SettleThreadStopFailureArgs,
): Promise<void> {
  await args.harness.engineRouting.settle(args.harness.deps.engineDispatch, {
    commandId: args.commandId,
    completedAt: Date.now(),
    errorCode: args.errorCode,
    errorMessage: args.errorMessage,
    ok: false,
    type: "thread.stop",
  });
}

describe("engine command waits", () => {
  it("resolves once the engine settles the dispatched command", async () => {
    await withTestHarness(async (harness) => {
      const wait = dispatchEngineCommandAndWait(harness.deps, {
        command: buildThreadStopCommand({ threadId: "thr-wait-1" }),
        timeoutMs: 5_000,
      });
      await waitForDispatchCount(harness, 1);
      const dispatched = harness.engineRouting.dispatched[0];
      expect(dispatched.command.type).toBe("thread.stop");

      await settleThreadStopSuccess({
        commandId: dispatched.commandId,
        harness,
      });
      await expect(wait).resolves.toEqual({});
    });
  });

  it("allows parallel waits to settle independently and out of order", async () => {
    await withTestHarness(async (harness) => {
      const firstWait = dispatchEngineCommandAndWait(harness.deps, {
        command: buildThreadStopCommand({ threadId: "thr-parallel-1" }),
        timeoutMs: 5_000,
      });
      const secondWait = dispatchEngineCommandAndWait(harness.deps, {
        command: buildThreadStopCommand({ threadId: "thr-parallel-2" }),
        timeoutMs: 5_000,
      });
      await waitForDispatchCount(harness, 2);
      const [first, second] = harness.engineRouting.dispatched;

      // Settle in reverse dispatch order: each waiter is keyed by commandId.
      await settleThreadStopSuccess({ commandId: second.commandId, harness });
      await expect(secondWait).resolves.toEqual({});

      await settleThreadStopSuccess({ commandId: first.commandId, harness });
      await expect(firstWait).resolves.toEqual({});
    });
  });

  it("maps engine command failures to 502 with the reported error code", async () => {
    await withTestHarness(async (harness) => {
      const wait = dispatchEngineCommandAndWait(harness.deps, {
        command: buildThreadStopCommand({ threadId: "thr-fail-1" }),
        timeoutMs: 5_000,
      });
      await waitForDispatchCount(harness, 1);

      await settleThreadStopFailure({
        commandId: harness.engineRouting.dispatched[0].commandId,
        errorCode: "provider_session_error",
        errorMessage: "provider exploded",
        harness,
      });

      const error = await wait.then(
        () => null,
        (caught: unknown) => caught,
      );
      if (!(error instanceof ApiError)) {
        throw new Error("Expected an ApiError from the failed wait");
      }
      expect(error.status).toBe(502);
      expect(error.body.code).toBe("provider_session_error");
    });
  });

  it("times out with 504 command_timeout when the engine never settles", async () => {
    await withTestHarness(async (harness) => {
      const wait = dispatchEngineCommandAndWait(harness.deps, {
        command: buildThreadStopCommand({ threadId: "thr-timeout-1" }),
        timeoutMs: 10,
      });

      const error = await wait.then(
        () => null,
        (caught: unknown) => caught,
      );
      if (!(error instanceof ApiError)) {
        throw new Error("Expected an ApiError from the timed-out wait");
      }
      expect(error.status).toBe(504);
      expect(error.body.code).toBe("command_timeout");

      harness.engineRouting.releaseAll();
    });
  });
});

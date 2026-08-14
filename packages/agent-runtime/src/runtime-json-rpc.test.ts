import { spawn, type ChildProcess } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { describe, expect, it } from "vitest";
import {
  ProviderResponseEncodeError,
  sendJsonRpc,
  sendJsonRpcResult,
} from "./runtime-json-rpc.js";

const EPIPE_PAYLOAD_SIZE = 1024 * 1024;

type ChildStdoutChunk = Buffer | string;

function readChildStdout(child: ChildProcess): Promise<string> {
  if (!child.stdout) {
    throw new Error("Expected child stdout to be readable");
  }
  const stdout = child.stdout;
  return new Promise((resolve) => {
    stdout.once("data", (chunk: ChildStdoutChunk) => {
      resolve(String(chunk));
    });
  });
}

function waitForChildExit(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    child.once("exit", () => resolve());
  });
}

describe("runtime JSON-RPC transport", () => {
  it.each([1n, () => undefined, Symbol("value")])(
    "rejects an unsupported outbound value",
    (value) => {
      const child = {
        stdin: {
          destroyed: false,
          on: () => undefined,
          writable: true,
          write: () => true,
        },
      } as unknown as ChildProcess;
      expect(() =>
        sendJsonRpc(child, {
          jsonrpc: "2.0",
          method: "test",
          params: { value },
        }),
      ).toThrow(ProviderResponseEncodeError);
    },
  );

  it("does not surface closed provider stdin errors as unhandled process errors", async () => {
    const child = spawn(
      process.execPath,
      [
        "-e",
        "process.stdin.destroy(); process.stdout.write('stdin-closed\\n'); setTimeout(() => process.exit(0), 1000);",
      ],
      { stdio: ["pipe", "pipe", "ignore"] },
    );

    try {
      await readChildStdout(child);
      sendJsonRpcResult({
        child,
        id: 1,
        result: { payload: "x".repeat(EPIPE_PAYLOAD_SIZE) },
      });
      await delay(50);
    } finally {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill("SIGKILL");
      }
      await waitForChildExit(child);
    }
  });
});

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { createCodexAppServerConnection } from "./app-server-connection.js";

describe("codex app-server connection", () => {
  const workspaces: string[] = [];

  afterEach(() => {
    for (const workspace of workspaces.splice(0)) {
      rmSync(workspace, { recursive: true, force: true });
    }
  });

  it("contains a broken child stdin instead of crashing the bridge", async () => {
    const workspace = mkdtempSync(join(tmpdir(), "bb-codex-connection-"));
    workspaces.push(workspace);
    let signalReady: () => void = () => undefined;
    const ready = new Promise<void>((resolve) => {
      signalReady = resolve;
    });
    let signalExit: () => void = () => undefined;
    const exited = new Promise<void>((resolve) => {
      signalExit = resolve;
    });
    const connection = createCodexAppServerConnection({
      command: process.execPath,
      args: [
        "-e",
        [
          `require("node:fs").closeSync(0);`,
          `process.stdout.write('${JSON.stringify({ jsonrpc: "2.0", method: "ready", params: {} })}\\n');`,
          "setInterval(() => undefined, 1000);",
        ].join(""),
      ],
      cwd: workspace,
      env: process.env,
      recordThreadId: "t1",
      onNotification: (method) => {
        if (method === "ready") signalReady();
      },
      onRequest: () => undefined,
      onExit: () => signalExit(),
    });

    try {
      await ready;
      await expect(
        connection.request({
          method: "thread/start",
          resultSchema: z.object({}),
          timeoutMs: 1_000,
        }),
      ).rejects.toThrow(/codex app-server stdin failed/i);
      await exited;
      expect(connection.exited).toBe(true);
    } finally {
      connection.kill();
    }
  });
});

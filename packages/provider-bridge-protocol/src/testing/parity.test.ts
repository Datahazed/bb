import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { threadEventSchema, type ThreadEvent } from "@bb/domain";
import { replayRecording } from "./parity.js";

function writeLane(
  dir: string,
  direction:
    | "runtime→bridge"
    | "bridge→runtime"
    | "provider→bridge"
    | "bridge→provider",
  entries: ReadonlyArray<{ seq: number; line: string }>,
  current: boolean,
): void {
  writeFileSync(
    join(dir, `${direction}${current ? ".current" : ""}.ndjson`),
    `${entries
      .map((entry) =>
        JSON.stringify({
          ts: entry.seq,
          run: 1,
          seq: entry.seq,
          dir: direction,
          line: entry.line,
        }),
      )
      .join("\n")}\n`,
  );
}

it("waits for the exact planned tail and a quiet period before closing", async () => {
  const dir = mkdtempSync(join(tmpdir(), "bb-parity-tail-test-"));
  const bridgePath = join(dir, "delayed-tail-bridge.mjs");
  const identity = {
    threadId: "thr_test",
    providerThreadId: "provider_test",
  } as const;
  const scope = { kind: "turn", turnId: "turn_test" } as const;
  const prefixEvents: ThreadEvent[] = [
    { type: "turn/started", ...identity, scope },
    {
      type: "item/started",
      ...identity,
      scope,
      item: { type: "agentMessage", id: "item_test", text: "" },
    },
  ];
  const tailEvents: ThreadEvent[] = [
    {
      type: "item/completed",
      ...identity,
      scope,
      item: { type: "agentMessage", id: "item_test", text: "done" },
    },
    { type: "turn/completed", ...identity, scope, status: "completed" },
  ];
  const extraEvents: ThreadEvent[] = [
    {
      type: "thread/contextWindowUsage/updated",
      ...identity,
      scope: { kind: "thread" },
      contextWindowUsage: {
        usedTokens: 42,
        modelContextWindow: 1_000,
        estimated: false,
      },
    },
  ];
  const delta = (events: readonly ThreadEvent[]): string =>
    JSON.stringify({
      jsonrpc: "2.0",
      method: "thread/delta",
      params: { events },
    });

  try {
    writeLane(dir, "runtime→bridge", [
      {
        seq: 1,
        line: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "thread/start",
          params: {},
        }),
      },
    ], false);
    writeLane(dir, "bridge→runtime", [
      { seq: 1.1, line: delta(prefixEvents) },
      { seq: 1.2, line: delta(tailEvents) },
    ], true);
    writeFileSync(
      bridgePath,
      [
        `const prefix = ${JSON.stringify(prefixEvents)};`,
        `const tail = ${JSON.stringify(tailEvents)};`,
        `const extra = ${JSON.stringify(extraEvents)};`,
        "const delta = (events) => JSON.stringify({ jsonrpc: '2.0', method: 'thread/delta', params: { events } });",
        "let pending = '';",
        "let tailTimer = null;",
        "process.stdin.setEncoding('utf8');",
        "process.stdin.on('data', (chunk) => {",
        "  pending += chunk;",
        "  for (;;) {",
        "    const newline = pending.indexOf('\\n');",
        "    if (newline === -1) break;",
        "    const line = pending.slice(0, newline);",
        "    pending = pending.slice(newline + 1);",
        "    const message = JSON.parse(line);",
        "    if (message.method === 'initialize') {",
        "      process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: message.id, result: {} }) + '\\n');",
        "    } else if (message.method === 'thread/start') {",
        "      process.stdout.write(delta(prefix) + '\\n');",
        "      process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: message.id, result: {} }) + '\\n');",
        "      tailTimer = setTimeout(() => {",
        "        process.stdout.write(delta(tail) + '\\n');",
        "        tailTimer = setTimeout(() => process.stdout.write(delta(extra) + '\\n'), 40);",
        "      }, 100);",
        "    }",
        "  }",
        "});",
        "process.stdin.on('end', () => {",
        "  if (tailTimer !== null) clearTimeout(tailTimer);",
        "  process.exit(0);",
        "});",
        "",
      ].join("\n"),
    );

    const run = await replayRecording({
      recordingDir: dir,
      providerId: "test-provider",
      bridge: {
        command: process.execPath,
        args: [bridgePath],
        cwd: dir,
        env: {},
      },
      createAssembler: () => ({
        assembleMessage: (message) => {
          const params = message.params;
          if (
            typeof params !== "object" ||
            params === null ||
            !("events" in params)
          ) {
            return [];
          }
          return threadEventSchema.array().parse(params.events);
        },
      }),
      planFromCurrentLane: true,
      settleMs: 60,
      timeoutMs: 1_000,
    });

    expect(run.stalls).toEqual([]);
    expect(run.grammarViolations).toEqual([]);
    expect(run.events).toEqual([
      ...prefixEvents,
      ...tailEvents,
      ...extraEvents,
    ]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

it("holds a provider notification for the runtime response recorded before it", async () => {
  const dir = mkdtempSync(join(tmpdir(), "bb-parity-response-gate-test-"));
  const bridgePath = join(dir, "delayed-response-bridge.mjs");
  const event: ThreadEvent = {
    type: "thread/contextWindowUsage/updated",
    threadId: "thr_test",
    providerThreadId: "provider_test",
    scope: { kind: "thread" },
    contextWindowUsage: {
      usedTokens: 42,
      modelContextWindow: 1_000,
      estimated: false,
    },
  };
  const runtimeRequest = JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method: "thread/start",
    params: {},
  });
  const runtimeResponse = JSON.stringify({ jsonrpc: "2.0", id: 1, result: {} });
  const providerRequest = JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {},
  });
  const providerResponse = JSON.stringify({ jsonrpc: "2.0", id: 1, result: {} });
  const providerNotification = JSON.stringify({
    jsonrpc: "2.0",
    method: "update",
    params: {},
  });
  const delta = JSON.stringify({
    jsonrpc: "2.0",
    method: "thread/delta",
    params: { events: [event] },
  });
  const bridgeOutput = [
    { seq: 4, line: runtimeResponse },
    { seq: 6, line: delta },
  ];

  try {
    writeLane(dir, "runtime→bridge", [{ seq: 1, line: runtimeRequest }], false);
    writeLane(dir, "bridge→provider", [{ seq: 2, line: providerRequest }], false);
    writeLane(
      dir,
      "provider→bridge",
      [
        { seq: 3, line: providerResponse },
        { seq: 5, line: providerNotification },
      ],
      false,
    );
    writeLane(dir, "bridge→runtime", bridgeOutput, false);
    writeLane(dir, "bridge→runtime", bridgeOutput, true);
    // The old child advanced after a 50ms sleep. Keep the bridge response
    // pending long enough for that notification to overtake it deterministically.
    writeFileSync(
      bridgePath,
      [
        "import { spawn } from 'node:child_process';",
        "import { createInterface } from 'node:readline';",
        `const event = ${JSON.stringify(event)};`,
        "const provider = spawn(process.env.REPLAY_PROVIDER_COMMAND, [], { stdio: ['pipe', 'pipe', 'inherit'] });",
        "let pendingRuntimeId = null;",
        "const send = (message) => process.stdout.write(JSON.stringify(message) + '\\n');",
        "createInterface({ input: provider.stdout, terminal: false }).on('line', (line) => {",
        "  const message = JSON.parse(line);",
        "  if (message.id !== undefined && message.method === undefined) {",
        "    setTimeout(() => send({ jsonrpc: '2.0', id: pendingRuntimeId, result: {} }), 250);",
        "    return;",
        "  }",
        "  send({ jsonrpc: '2.0', method: 'thread/delta', params: { events: [event] } });",
        "});",
        "createInterface({ input: process.stdin, terminal: false }).on('line', (line) => {",
        "  const message = JSON.parse(line);",
        "  if (message.method === 'initialize') {",
        "    send({ jsonrpc: '2.0', id: message.id, result: {} });",
        "    return;",
        "  }",
        "  pendingRuntimeId = message.id;",
        "  provider.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }) + '\\n');",
        "});",
        "process.stdin.on('end', () => provider.stdin.end());",
        "provider.on('exit', () => process.exit(0));",
        "",
      ].join("\n"),
    );

    const run = await replayRecording({
      recordingDir: dir,
      providerId: "test-provider",
      bridge: {
        command: process.execPath,
        args: [bridgePath],
        cwd: dir,
        env: {},
      },
      profile: {
        dialect: "json-rpc",
        env: ({ wrapperPath }) => ({ REPLAY_PROVIDER_COMMAND: wrapperPath }),
      },
      createAssembler: () => ({
        assembleMessage: (message) => {
          const params = message.params;
          if (
            typeof params !== "object" ||
            params === null ||
            !("events" in params)
          ) {
            return [];
          }
          return threadEventSchema.array().parse(params.events);
        },
      }),
      planFromCurrentLane: true,
      settleMs: 20,
      timeoutMs: 2_000,
    });

    const runtimeResponseIndex = run.lines.indexOf(runtimeResponse);
    const notificationIndex = run.lines.indexOf(delta);
    expect(run.stalls).toEqual([]);
    expect(run.events).toEqual([event]);
    expect(runtimeResponseIndex).toBeGreaterThan(-1);
    expect(notificationIndex).toBeGreaterThan(runtimeResponseIndex);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

import { describe, expect, it, vi } from "vitest";
import type { DesktopAboutFacts } from "../src/desktop-about-panel.js";
import {
  captureRendererHangDiagnostic,
  RENDERER_HANG_DIAGNOSTIC_MAX_CALL_FRAMES,
  RENDERER_HANG_DIAGNOSTIC_TIMEOUT_MS,
  type CaptureRendererHangDiagnosticArgs,
  type RendererHangDebuggerClient,
  type RendererHangReport,
} from "../src/desktop-renderer-hang-diagnostic.js";

type FakeCommandHandler = (
  method: string,
  client: FakeDebuggerClient,
) => Promise<unknown>;

class FakeDebuggerClient implements RendererHangDebuggerClient {
  readonly attachedProtocolVersions: string[] = [];
  readonly commands: string[] = [];
  /** Ordered log of every send and detach, for pinning their relative order. */
  readonly events: string[] = [];
  detachCount = 0;
  private readonly listeners = new Set<
    (method: string, params: unknown) => void
  >();

  constructor(private readonly handleCommand: FakeCommandHandler) {}

  attach(protocolVersion: string): void {
    this.attachedProtocolVersions.push(protocolVersion);
  }

  detach(): void {
    this.detachCount += 1;
    this.events.push("detach");
  }

  emit(method: string, params: unknown): void {
    for (const listener of this.listeners) {
      listener(method, params);
    }
  }

  get listenerCount(): number {
    return this.listeners.size;
  }

  onMessage(listener: (method: string, params: unknown) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  sendCommand(method: string): Promise<unknown> {
    this.commands.push(method);
    this.events.push(method);
    return this.handleCommand(method, this);
  }
}

const BUILD: DesktopAboutFacts = {
  applicationName: "bb",
  buildDate: "2026-08-24T20:00:00.000Z",
  channel: "latest",
  commit: "b33abbff098ac4c857578e7350d492dcaa65d489",
  electronVersion: "41.7.0",
  osArch: "arm64",
  osRelease: "25.0.0",
  osType: "Darwin",
  platform: "darwin",
  pluginSdkVersion: "0.39.0",
  version: "0.39.0",
};
const WINDOW = {
  id: 7,
  rendererPid: 55035,
  url: "http://127.0.0.1:38886/projects/proj_ivbg7bbvgw/threads/thr_n9sh8rhz6t",
  webContentsId: 3,
};
const MEMORY = {
  peakWorkingSetSizeKb: 11_000_000,
  workingSetSizeKb: 10_500_000,
};
const NOW_MS = Date.parse("2026-08-25T04:02:13.250Z");
const EXPECTED_PATH =
  "/home/dan/.bb/logs/renderer-hang-window-7-2026-08-25T04-02-13-250Z.json";
const SCRIPT_URL = "http://127.0.0.1:38886/assets/index-C3k9Zx.js";

function createPausedParams(frameCount: number): unknown {
  return {
    callFrames: Array.from({ length: frameCount }, (_, index) => ({
      callFrameId: `{"ordinal":${index},"injectedScriptId":1}`,
      functionName: index === 0 ? "measureInlineEditorMaxHeight" : `f${index}`,
      location: { columnNumber: index * 10, lineNumber: index, scriptId: "12" },
      scopeChain: [],
      this: { type: "undefined" },
      url: SCRIPT_URL,
    })),
    hitBreakpoints: [],
    reason: "other",
  };
}

const never = (): Promise<unknown> => new Promise(() => {});

function pausingHandler(
  overrides: Partial<Record<string, FakeCommandHandler>> = {},
): FakeCommandHandler {
  return async (method, client) => {
    const override = overrides[method];
    if (override !== undefined) {
      return await override(method, client);
    }
    switch (method) {
      case "Debugger.enable":
        return { debuggerId: "(ABCDEF)" };
      case "Debugger.pause":
        // The response comes first, then the paused event, like the protocol.
        queueMicrotask(() => {
          client.emit("Debugger.scriptParsed", { scriptId: "13" });
          client.emit("Debugger.paused", createPausedParams(3));
        });
        return {};
      case "Runtime.getHeapUsage":
        return {
          backingStorageSize: 4096,
          totalSize: 10_200_000_000,
          usedSize: 9_800_000_000,
        };
      case "Debugger.resume":
        return {};
      default:
        throw new Error(`unexpected command ${method}`);
    }
  };
}

interface Harness {
  args: CaptureRendererHangDiagnosticArgs;
  client: FakeDebuggerClient;
  files: Map<string, string>;
  warnings: string[];
}

function createHarness(
  client: FakeDebuggerClient,
  overrides: Partial<CaptureRendererHangDiagnosticArgs> = {},
): Harness {
  const files = new Map<string, string>();
  const warnings: string[] = [];
  return {
    args: {
      build: BUILD,
      debuggerClient: client,
      isWindowDestroyed: () => false,
      logDirectory: "/home/dan/.bb/logs",
      logger: {
        warn(message) {
          warnings.push(message);
        },
      },
      now: () => NOW_MS,
      readRendererMemory: () => MEMORY,
      timeoutMs: RENDERER_HANG_DIAGNOSTIC_TIMEOUT_MS,
      window: WINDOW,
      async writeFile(path, contents) {
        files.set(path, contents);
      },
      ...overrides,
    },
    client,
    files,
    warnings,
  };
}

function readReport(files: Map<string, string>): RendererHangReport {
  const contents = files.get(EXPECTED_PATH);
  if (contents === undefined) {
    throw new Error(`expected a report at ${EXPECTED_PATH}`);
  }
  return JSON.parse(contents) as RendererHangReport;
}

describe("captureRendererHangDiagnostic", () => {
  it("writes the paused call frames, heap usage, memory and build identity, then resumes and detaches", async () => {
    const frameCount = RENDERER_HANG_DIAGNOSTIC_MAX_CALL_FRAMES + 6;
    const client = new FakeDebuggerClient(
      pausingHandler({
        "Debugger.pause": async (_method, pausingClient) => {
          queueMicrotask(() => {
            pausingClient.emit(
              "Debugger.paused",
              createPausedParams(frameCount),
            );
          });
          return {};
        },
      }),
    );
    const harness = createHarness(client);

    const result = await captureRendererHangDiagnostic(harness.args);

    expect(result).toEqual({ kind: "written", path: EXPECTED_PATH });
    expect([...harness.files.keys()]).toEqual([EXPECTED_PATH]);
    const report = readReport(harness.files);
    expect(report).toEqual({
      build: BUILD,
      capture: {
        callFrames: expect.any(Array),
        droppedCallFrames: 6,
        heapUsage: { totalSize: 10_200_000_000, usedSize: 9_800_000_000 },
        kind: "paused",
        reason: "other",
      },
      capturedAt: "2026-08-25T04:02:13.250Z",
      kind: "bb-desktop-renderer-hang",
      rendererMemory: MEMORY,
      window: WINDOW,
    });
    if (report.capture.kind !== "paused") {
      throw new Error("expected a paused capture");
    }
    expect(report.capture.callFrames).toHaveLength(
      RENDERER_HANG_DIAGNOSTIC_MAX_CALL_FRAMES,
    );
    expect(report.capture.callFrames[0]).toEqual({
      columnNumber: 0,
      functionName: "measureInlineEditorMaxHeight",
      lineNumber: 0,
      url: SCRIPT_URL,
    });
    expect(report.capture.callFrames[1]).toEqual({
      columnNumber: 10,
      functionName: "f1",
      lineNumber: 1,
      url: SCRIPT_URL,
    });

    expect(client.attachedProtocolVersions).toEqual(["1.3"]);
    expect(client.commands).toEqual([
      "Debugger.enable",
      "Debugger.pause",
      "Runtime.getHeapUsage",
      "Debugger.resume",
    ]);
    expect(client.detachCount).toBe(1);
    expect(client.listenerCount).toBe(0);
    // The renderer must be resumed before the session is detached: detach on a
    // still-paused session is a deliberate part of the design, so pin the order.
    expect(client.events).toEqual([
      "Debugger.enable",
      "Debugger.pause",
      "Runtime.getHeapUsage",
      "Debugger.resume",
      "detach",
    ]);
    expect(harness.warnings).toEqual([
      `[desktop] renderer hang diagnostic for window 7: wrote ${EXPECTED_PATH} (paused with 64 call frames, top frame measureInlineEditorMaxHeight at ${SCRIPT_URL}:0:0)`,
    ]);
  });

  it("logs and skips when the debugger cannot attach", async () => {
    const client = new FakeDebuggerClient(pausingHandler());
    client.attach = () => {
      throw new Error("Debugger is already attached to the webContents");
    };
    const harness = createHarness(client);

    const result = await captureRendererHangDiagnostic(harness.args);

    expect(result).toEqual({ kind: "skipped", reason: "attach-failed" });
    expect(harness.files.size).toBe(0);
    expect(client.commands).toEqual([]);
    expect(client.detachCount).toBe(0);
    expect(harness.warnings).toEqual([
      "[desktop] renderer hang diagnostic for window 7: could not attach the debugger: Debugger is already attached to the webContents",
    ]);
  });

  it.each([
    {
      commands: ["Debugger.enable"],
      overrides: { "Debugger.enable": never },
      scenario: "the renderer never processes Debugger.enable",
      step: "Debugger.enable",
    },
    {
      commands: ["Debugger.enable", "Debugger.pause"],
      overrides: { "Debugger.pause": never },
      scenario: "the renderer never acknowledges Debugger.pause",
      step: "Debugger.pause",
    },
    {
      commands: ["Debugger.enable", "Debugger.pause"],
      overrides: { "Debugger.pause": async () => ({}) },
      scenario: "the pause is acknowledged but Debugger.paused never arrives",
      step: "Debugger.paused",
    },
  ])(
    "records the unanswered step and detaches when $scenario",
    async ({ commands, overrides, step }) => {
      vi.useFakeTimers();
      try {
        const client = new FakeDebuggerClient(pausingHandler(overrides));
        const harness = createHarness(client);

        const resultPromise = captureRendererHangDiagnostic(harness.args);
        await vi.advanceTimersByTimeAsync(
          RENDERER_HANG_DIAGNOSTIC_TIMEOUT_MS - 1,
        );
        expect(harness.files.size).toBe(0);
        expect(client.detachCount).toBe(0);
        await vi.advanceTimersByTimeAsync(1);
        const result = await resultPromise;

        expect(result).toEqual({ kind: "written", path: EXPECTED_PATH });
        expect(readReport(harness.files).capture).toEqual({
          kind: "timed-out",
          step,
          timeoutMs: RENDERER_HANG_DIAGNOSTIC_TIMEOUT_MS,
        });
        expect(client.commands).toEqual(commands);
        expect(client.detachCount).toBe(1);
        expect(client.listenerCount).toBe(0);
        expect(harness.warnings).toEqual([
          `[desktop] renderer hang diagnostic for window 7: wrote ${EXPECTED_PATH} (no answer to ${step} within ${RENDERER_HANG_DIAGNOSTIC_TIMEOUT_MS} ms)`,
        ]);
      } finally {
        vi.useRealTimers();
      }
    },
  );

  it("keeps the call frames when the heap usage read does not answer in time", async () => {
    vi.useFakeTimers();
    try {
      const client = new FakeDebuggerClient(
        pausingHandler({ "Runtime.getHeapUsage": never }),
      );
      const harness = createHarness(client);

      const resultPromise = captureRendererHangDiagnostic(harness.args);
      await vi.advanceTimersByTimeAsync(RENDERER_HANG_DIAGNOSTIC_TIMEOUT_MS);
      const result = await resultPromise;

      expect(result).toEqual({ kind: "written", path: EXPECTED_PATH });
      const report = readReport(harness.files);
      expect(report.capture).toEqual({
        callFrames: expect.any(Array),
        droppedCallFrames: 0,
        heapUsage: null,
        kind: "paused",
        reason: "other",
      });
      if (report.capture.kind !== "paused") {
        throw new Error("expected a paused capture");
      }
      expect(report.capture.callFrames).toHaveLength(3);
      expect(client.commands).toEqual([
        "Debugger.enable",
        "Debugger.pause",
        "Runtime.getHeapUsage",
        "Debugger.resume",
      ]);
      expect(client.detachCount).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("skips the report and detaches when the window is destroyed mid-capture", async () => {
    let destroyed = false;
    const client = new FakeDebuggerClient(
      pausingHandler({
        "Debugger.pause": async () => {
          destroyed = true;
          throw new Error("target closed while handling command");
        },
      }),
    );
    const harness = createHarness(client, {
      isWindowDestroyed: () => destroyed,
    });

    const result = await captureRendererHangDiagnostic(harness.args);

    expect(result).toEqual({ kind: "skipped", reason: "window-destroyed" });
    expect(harness.files.size).toBe(0);
    expect(client.commands).toEqual(["Debugger.enable", "Debugger.pause"]);
    expect(client.detachCount).toBe(1);
    expect(client.listenerCount).toBe(0);
    expect(harness.warnings).toEqual([
      "[desktop] renderer hang diagnostic for window 7: the window was destroyed during the capture",
    ]);
  });

  it("records a failed capture without resuming when a command rejects while the window is alive", async () => {
    const client = new FakeDebuggerClient(
      pausingHandler({
        "Debugger.pause": async () => {
          throw new Error("Debugger agent is not enabled");
        },
      }),
    );
    const harness = createHarness(client);

    const result = await captureRendererHangDiagnostic(harness.args);

    expect(result).toEqual({ kind: "written", path: EXPECTED_PATH });
    expect(readReport(harness.files).capture).toEqual({
      error: "Debugger agent is not enabled",
      kind: "failed",
      step: "Debugger.pause",
    });
    // A failed capture never paused the renderer, so it must not send resume.
    expect(client.commands).toEqual(["Debugger.enable", "Debugger.pause"]);
    expect(client.events).toEqual([
      "Debugger.enable",
      "Debugger.pause",
      "detach",
    ]);
    expect(client.detachCount).toBe(1);
    expect(client.listenerCount).toBe(0);
    expect(harness.warnings).toEqual([
      `[desktop] renderer hang diagnostic for window 7: wrote ${EXPECTED_PATH} (Debugger.pause failed: Debugger agent is not enabled)`,
    ]);
  });

  it("logs and skips when the report cannot be written", async () => {
    const client = new FakeDebuggerClient(pausingHandler());
    const harness = createHarness(client, {
      async writeFile() {
        throw new Error("EACCES: permission denied");
      },
    });

    const result = await captureRendererHangDiagnostic(harness.args);

    expect(result).toEqual({ kind: "skipped", reason: "write-failed" });
    expect(client.detachCount).toBe(1);
    expect(harness.warnings).toEqual([
      `[desktop] renderer hang diagnostic for window 7: could not write ${EXPECTED_PATH}: EACCES: permission denied`,
    ]);
  });
});

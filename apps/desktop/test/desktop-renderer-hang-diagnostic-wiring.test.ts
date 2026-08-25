import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DesktopAboutFacts } from "../src/desktop-about-panel.js";
import {
  registerRendererHangDiagnostic,
  RENDERER_HANG_DIAGNOSTIC_TIMEOUT_MS,
  type RendererHangReport,
} from "../src/desktop-renderer-hang-diagnostic.js";

const RENDERER_PID = 4242;

const fsState = vi.hoisted(() => ({
  writes: [] as { contents: string; path: string }[],
}));

vi.mock("node:fs/promises", () => ({
  async mkdir() {},
  async writeFile(path: string, contents: string) {
    fsState.writes.push({ contents, path });
  },
}));

vi.mock("electron", () => ({
  app: {
    getAppMetrics: () => [
      {
        memory: { peakWorkingSetSize: 200, workingSetSize: 100 },
        pid: RENDERER_PID,
      },
    ],
  },
}));

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

function pausedParams(): unknown {
  return {
    callFrames: [
      {
        functionName: "spin",
        location: { columnNumber: 4, lineNumber: 1 },
        url: "http://127.0.0.1/assets/index.js",
      },
    ],
    reason: "other",
  };
}

class FakeDebugger extends EventEmitter {
  /** Every attach call, including one that throws because it is a re-attach. */
  attachAttempts = 0;
  attachCount = 0;
  detachCount = 0;
  emitPausedOnPause = true;
  /** Models a pinned main thread: Debugger.enable is never processed. */
  stallEnable = false;
  private attached = false;

  attach(_protocolVersion: string): void {
    this.attachAttempts += 1;
    if (this.attached) {
      throw new Error("Debugger is already attached to the target");
    }
    this.attached = true;
    this.attachCount += 1;
  }

  detach(): void {
    this.attached = false;
    this.detachCount += 1;
  }

  sendCommand(method: string): Promise<unknown> {
    switch (method) {
      case "Debugger.enable":
        return this.stallEnable ? new Promise(() => {}) : Promise.resolve({});
      case "Debugger.pause":
        if (this.emitPausedOnPause) {
          queueMicrotask(() => {
            this.emit("message", {}, "Debugger.paused", pausedParams());
          });
        }
        return Promise.resolve({});
      case "Runtime.getHeapUsage":
        return Promise.resolve({ totalSize: 1, usedSize: 1 });
      case "Debugger.resume":
        return Promise.resolve({});
      default:
        return Promise.reject(new Error(`unexpected command ${method}`));
    }
  }
}

class FakeWindow extends EventEmitter {
  readonly id = 3;
  readonly webContents: {
    debugger: FakeDebugger;
    getOSProcessId(): number;
    getURL(): string;
    id: number;
    isDestroyed(): boolean;
  };

  constructor(readonly dbg: FakeDebugger) {
    super();
    this.webContents = {
      debugger: dbg,
      getOSProcessId: () => RENDERER_PID,
      getURL: () => "http://127.0.0.1/thread",
      id: 9,
      isDestroyed: () => false,
    };
  }
}

function register(win: FakeWindow): void {
  registerRendererHangDiagnostic({
    // The fake matches the shape the wiring reads; the Electron types are wider.
    browserWindow: win as never,
    build: BUILD,
    logDirectory: "/logs",
    logger: { warn() {} },
  });
}

/** Drains the capture's promise chain without advancing the deadline timer. */
async function settle(): Promise<void> {
  for (let i = 0; i < 12; i += 1) {
    await vi.advanceTimersByTimeAsync(0);
  }
}

describe("registerRendererHangDiagnostic", () => {
  afterEach(() => {
    fsState.writes.length = 0;
    vi.useRealTimers();
  });

  it("captures once per hang and re-arms only after 'responsive'", async () => {
    vi.useFakeTimers();
    const dbg = new FakeDebugger();
    const win = new FakeWindow(dbg);
    register(win);

    win.emit("unresponsive");
    await settle();
    expect(dbg.attachCount).toBe(1);
    expect(dbg.detachCount).toBe(1);
    expect(fsState.writes).toHaveLength(1);

    // A renderer that stays hung fires "unresponsive" again; without a
    // "responsive" in between it must not be captured a second time.
    win.emit("unresponsive");
    await settle();
    expect(dbg.attachCount).toBe(1);
    expect(fsState.writes).toHaveLength(1);

    // A fresh hang after the window recovered gets its own capture.
    vi.advanceTimersByTime(5);
    win.emit("responsive");
    win.emit("unresponsive");
    await settle();
    expect(dbg.attachCount).toBe(2);
    expect(dbg.detachCount).toBe(2);
    expect(fsState.writes).toHaveLength(2);
  });

  it("ignores 'unresponsive' during an in-flight capture and re-arms when it finishes", async () => {
    vi.useFakeTimers();
    const dbg = new FakeDebugger();
    // The renderer's main thread is pinned, so Debugger.enable is never
    // processed and capture 1 stays in flight until the deadline.
    dbg.stallEnable = true;
    const win = new FakeWindow(dbg);
    register(win);

    win.emit("unresponsive");
    await settle();
    expect(dbg.attachCount).toBe(1);
    expect(fsState.writes).toHaveLength(0);

    // "responsive" then "unresponsive" while capture 1 is still running must not
    // even attempt a second attach on the same (already attached) session.
    win.emit("responsive");
    win.emit("unresponsive");
    await settle();
    expect(dbg.attachAttempts).toBe(1);
    expect(dbg.attachCount).toBe(1);
    expect(fsState.writes).toHaveLength(0);

    // Capture 1 hits its deadline, writes a timed-out report and detaches; the
    // "responsive" seen mid-capture then re-arms the window.
    await vi.advanceTimersByTimeAsync(RENDERER_HANG_DIAGNOSTIC_TIMEOUT_MS);
    expect(fsState.writes).toHaveLength(1);
    expect(dbg.detachCount).toBe(1);
    const [firstWrite] = fsState.writes;
    if (firstWrite === undefined) {
      throw new Error("expected a report to be written");
    }
    const report = JSON.parse(firstWrite.contents) as RendererHangReport;
    expect(report.capture).toEqual({
      kind: "timed-out",
      step: "Debugger.enable",
      timeoutMs: RENDERER_HANG_DIAGNOSTIC_TIMEOUT_MS,
    });

    dbg.stallEnable = false;
    win.emit("unresponsive");
    await settle();
    expect(dbg.attachCount).toBe(2);
    expect(fsState.writes).toHaveLength(2);
  });
});

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { app, type BrowserWindow, type Debugger } from "electron";
import { z } from "zod";
import type { DesktopAboutFacts } from "./desktop-about-panel.js";

/**
 * Captures diagnostics when a window's renderer becomes unresponsive.
 *
 * Issue #2401 reports a renderer pinned at ~100% CPU with an RSS past 10 GiB
 * after Edit on a queued message. A process sample of the renderer bottoms
 * out in V8 microtask execution and never names the application callback, so
 * the hang cannot be attributed from the report. The main process can reach
 * the renderer's inspector through the webContents debugger and ask V8 to
 * break with Debugger.pause. A pause takes effect only when V8 next checks
 * for an interrupt, which a renderer that yields between tasks reaches
 * promptly, so for a long-but-yielding hang this module writes the top call
 * frames, the JS heap usage, the renderer's working set and the build
 * identity (so minified frames can be mapped) to a JSON file, then resumes
 * the renderer and detaches.
 *
 * A renderer executing a single never-returning synchronous or microtask loop
 * -- the #2401 class, where Cmd+R is also dead -- never reaches an interrupt
 * check, so the pause is acknowledged but no Debugger.paused ever arrives and
 * the capture times out. Measured on Electron 41.7.0: with the Debugger domain
 * pre-enabled, Debugger.pause is acked in ~1 ms yet no break is delivered to a
 * for(;;) or self-rescheduling-microtask loop within seconds. The capture is
 * bounded by a single deadline; on expiry it records which protocol step went
 * unanswered ("Debugger.enable" for a loop that never yields at all, since
 * attach and Debugger.enable are ordinary main-thread messages) together with
 * the renderer's working set. That timeout report is itself diagnostic: it
 * confirms a fully pinned main thread and captures memory + build identity
 * even when no JavaScript stack can be obtained.
 */

export const RENDERER_HANG_DIAGNOSTIC_TIMEOUT_MS = 5_000;
export const RENDERER_HANG_DIAGNOSTIC_MAX_CALL_FRAMES = 64;
const DEVTOOLS_PROTOCOL_VERSION = "1.3";

export interface RendererHangDebuggerClient {
  attach(protocolVersion: string): void;
  detach(): void;
  /** Subscribes to protocol events; the returned function unsubscribes. */
  onMessage(listener: (method: string, params: unknown) => void): () => void;
  sendCommand(method: string): Promise<unknown>;
}

export interface RendererHangDiagnosticLogger {
  warn(message: string): void;
}

export interface RendererHangWindowInfo {
  id: number;
  rendererPid: number;
  url: string;
  webContentsId: number;
}

export interface RendererHangProcessMemory {
  peakWorkingSetSizeKb: number;
  workingSetSizeKb: number;
}

export interface RendererHangCallFrame {
  columnNumber?: number;
  functionName: string;
  lineNumber: number;
  url: string;
}

interface RendererHangHeapUsage {
  totalSize: number;
  usedSize: number;
}

type RendererHangStep =
  | "Debugger.enable"
  | "Debugger.pause"
  | "Debugger.paused"
  | "Runtime.getHeapUsage";

interface RendererHangPausedCapture {
  callFrames: RendererHangCallFrame[];
  droppedCallFrames: number;
  heapUsage: RendererHangHeapUsage | null;
  kind: "paused";
  reason: string;
}

export type RendererHangCapture =
  | RendererHangPausedCapture
  | { kind: "timed-out"; step: RendererHangStep; timeoutMs: number }
  | { error: string; kind: "failed"; step: RendererHangStep };

export interface RendererHangReport {
  build: DesktopAboutFacts;
  capture: RendererHangCapture;
  capturedAt: string;
  kind: "bb-desktop-renderer-hang";
  rendererMemory: RendererHangProcessMemory | null;
  window: RendererHangWindowInfo;
}

export type RendererHangDiagnosticResult =
  | { kind: "written"; path: string }
  | {
      kind: "skipped";
      reason: "attach-failed" | "window-destroyed" | "write-failed";
    };

export interface CaptureRendererHangDiagnosticArgs {
  build: DesktopAboutFacts;
  debuggerClient: RendererHangDebuggerClient;
  isWindowDestroyed(): boolean;
  logDirectory: string;
  logger: RendererHangDiagnosticLogger;
  now(): number;
  readRendererMemory(): RendererHangProcessMemory | null;
  timeoutMs: number;
  window: RendererHangWindowInfo;
  writeFile(path: string, contents: string): Promise<void>;
}

const debuggerPausedSchema = z.object({
  callFrames: z.array(
    z.object({
      functionName: z.string(),
      location: z.object({
        columnNumber: z.number().optional(),
        lineNumber: z.number(),
      }),
      url: z.string(),
    }),
  ),
  reason: z.string(),
});

const heapUsageSchema = z.object({
  totalSize: z.number(),
  usedSize: z.number(),
});

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function createPausedCapture(
  data: z.infer<typeof debuggerPausedSchema>,
): RendererHangPausedCapture {
  const callFrames = data.callFrames
    .slice(0, RENDERER_HANG_DIAGNOSTIC_MAX_CALL_FRAMES)
    .map((frame) => ({
      columnNumber: frame.location.columnNumber,
      functionName: frame.functionName,
      lineNumber: frame.location.lineNumber,
      url: frame.url,
    }));
  return {
    callFrames,
    droppedCallFrames: data.callFrames.length - callFrames.length,
    heapUsage: null,
    kind: "paused",
    reason: data.reason,
  };
}

async function readHeapUsage(
  client: RendererHangDebuggerClient,
): Promise<RendererHangHeapUsage | null> {
  try {
    const parsed = heapUsageSchema.safeParse(
      await client.sendCommand("Runtime.getHeapUsage"),
    );
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

interface CaptureRendererStackArgs {
  client: RendererHangDebuggerClient;
  timeoutMs: number;
}

async function captureRendererStack(
  args: CaptureRendererStackArgs,
): Promise<RendererHangCapture> {
  const { client, timeoutMs } = args;
  let step: RendererHangStep = "Debugger.enable";
  let pausedCapture: RendererHangPausedCapture | null = null;
  let removeListener = (): void => {};
  let resolveTimedOut = (_capture: RendererHangCapture): void => {};

  const paused = new Promise<unknown>((resolvePaused) => {
    removeListener = client.onMessage((method, params) => {
      if (method === "Debugger.paused") {
        resolvePaused(params);
      }
    });
  });
  const timedOut = new Promise<RendererHangCapture>((resolve) => {
    resolveTimedOut = resolve;
  });
  const timer = setTimeout(() => {
    // The frames are the point of the capture: a pause that answered but a
    // heap read that did not is still a capture, without the heap usage.
    resolveTimedOut(pausedCapture ?? { kind: "timed-out", step, timeoutMs });
  }, timeoutMs);

  const run = async (): Promise<RendererHangCapture> => {
    try {
      await client.sendCommand("Debugger.enable");
      step = "Debugger.pause";
      await client.sendCommand("Debugger.pause");
      step = "Debugger.paused";
      const parsed = debuggerPausedSchema.safeParse(await paused);
      if (!parsed.success) {
        return {
          error: `unrecognised Debugger.paused payload: ${parsed.error.message}`,
          kind: "failed",
          step,
        };
      }
      pausedCapture = createPausedCapture(parsed.data);
      step = "Runtime.getHeapUsage";
      return { ...pausedCapture, heapUsage: await readHeapUsage(client) };
    } catch (error) {
      return { error: describeError(error), kind: "failed", step };
    }
  };

  try {
    return await Promise.race([run(), timedOut]);
  } finally {
    clearTimeout(timer);
    removeListener();
  }
}

function describeCapture(capture: RendererHangCapture): string {
  switch (capture.kind) {
    case "paused": {
      const top = capture.callFrames[0];
      const topFrame =
        top === undefined
          ? "no call frames"
          : `top frame ${top.functionName || "(anonymous)"} at ${top.url}:${top.lineNumber}:${top.columnNumber ?? 0}`;
      return `paused with ${capture.callFrames.length} call frames, ${topFrame}`;
    }
    case "timed-out":
      return `no answer to ${capture.step} within ${capture.timeoutMs} ms`;
    case "failed":
      return `${capture.step} failed: ${capture.error}`;
  }
}

function formatReportFileName(args: {
  capturedAt: string;
  windowId: number;
}): string {
  const timestamp = args.capturedAt.replace(/[:.]/g, "-");
  return `renderer-hang-window-${args.windowId}-${timestamp}.json`;
}

function detachQuietly(client: RendererHangDebuggerClient): void {
  try {
    client.detach();
  } catch {
    // The target is already gone; there is nothing left to detach from.
  }
}

function readRendererMemoryQuietly(
  read: () => RendererHangProcessMemory | null,
): RendererHangProcessMemory | null {
  try {
    return read();
  } catch {
    // The report is still worth writing without the memory numbers.
    return null;
  }
}

/**
 * Pure core: attaches the debugger, breaks into the renderer, writes the
 * report and always leaves the debugger detached. Never throws. The renderer
 * is resumed by Debugger.resume (interrupt-safe) and by the detach itself,
 * which disposes the inspector session; Debugger.disable is not sent because
 * it is a main-thread message that a resumed loop would never answer.
 */
export async function captureRendererHangDiagnostic(
  args: CaptureRendererHangDiagnosticArgs,
): Promise<RendererHangDiagnosticResult> {
  const { debuggerClient: client, logger } = args;
  const label = `[desktop] renderer hang diagnostic for window ${args.window.id}`;
  if (args.isWindowDestroyed()) {
    return { kind: "skipped", reason: "window-destroyed" };
  }

  const rendererMemory = readRendererMemoryQuietly(args.readRendererMemory);
  try {
    client.attach(DEVTOOLS_PROTOCOL_VERSION);
  } catch (error) {
    logger.warn(
      `${label}: could not attach the debugger: ${describeError(error)}`,
    );
    return { kind: "skipped", reason: "attach-failed" };
  }

  const capture = await captureRendererStack({
    client,
    timeoutMs: args.timeoutMs,
  });
  if (args.isWindowDestroyed()) {
    detachQuietly(client);
    logger.warn(`${label}: the window was destroyed during the capture`);
    return { kind: "skipped", reason: "window-destroyed" };
  }
  if (capture.kind === "paused") {
    client.sendCommand("Debugger.resume").catch(() => {
      // Detaching below resumes the renderer as well.
    });
  }
  detachQuietly(client);

  const capturedAt = new Date(args.now()).toISOString();
  const report: RendererHangReport = {
    build: args.build,
    capture,
    capturedAt,
    kind: "bb-desktop-renderer-hang",
    rendererMemory,
    window: args.window,
  };
  const path = join(
    args.logDirectory,
    formatReportFileName({ capturedAt, windowId: args.window.id }),
  );
  try {
    await args.writeFile(path, `${JSON.stringify(report, null, 2)}\n`);
  } catch (error) {
    logger.warn(`${label}: could not write ${path}: ${describeError(error)}`);
    return { kind: "skipped", reason: "write-failed" };
  }
  logger.warn(`${label}: wrote ${path} (${describeCapture(capture)})`);
  return { kind: "written", path };
}

function createElectronDebuggerClient(
  electronDebugger: Debugger,
): RendererHangDebuggerClient {
  return {
    attach(protocolVersion) {
      electronDebugger.attach(protocolVersion);
    },
    detach() {
      electronDebugger.detach();
    },
    onMessage(listener) {
      const handler = (
        _event: unknown,
        method: string,
        params: unknown,
      ): void => {
        listener(method, params);
      };
      electronDebugger.on("message", handler);
      return () => {
        electronDebugger.off("message", handler);
      };
    },
    sendCommand(method) {
      return electronDebugger.sendCommand(method);
    },
  };
}

function readRendererProcessMemory(
  rendererPid: number,
): RendererHangProcessMemory | null {
  const metric = app
    .getAppMetrics()
    .find((candidate) => candidate.pid === rendererPid);
  if (metric === undefined) {
    return null;
  }
  return {
    peakWorkingSetSizeKb: metric.memory.peakWorkingSetSize,
    workingSetSizeKb: metric.memory.workingSetSize,
  };
}

async function writeReportFile(path: string, contents: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, contents, "utf8");
}

export interface RegisterRendererHangDiagnosticArgs {
  browserWindow: BrowserWindow;
  build: DesktopAboutFacts;
  logDirectory: string;
  logger: RendererHangDiagnosticLogger;
}

/**
 * Electron wiring: one capture per hang, and never two on the same debugger at
 * once. A single webContents.debugger session backs every capture, so a second
 * capture started while the first is in flight would fail to attach ("Debugger
 * is already attached"). "responsive" that lands mid-capture therefore only
 * marks the window to re-arm when that capture finishes rather than opening the
 * gate immediately; a renderer that stays hung is not paused again on every
 * repeated "unresponsive", and a later, separate hang still gets its own
 * report.
 */
export function registerRendererHangDiagnostic(
  args: RegisterRendererHangDiagnosticArgs,
): void {
  const { browserWindow, logger } = args;
  const { webContents } = browserWindow;
  const debuggerClient = createElectronDebuggerClient(webContents.debugger);
  let state: "armed" | "capturing" | "captured" = "armed";
  let rearmAfterCapture = false;

  browserWindow.on("unresponsive", () => {
    if (state !== "armed" || webContents.isDestroyed()) {
      return;
    }
    state = "capturing";
    rearmAfterCapture = false;
    const windowId = browserWindow.id;
    const rendererPid = webContents.getOSProcessId();
    void captureRendererHangDiagnostic({
      build: args.build,
      debuggerClient,
      isWindowDestroyed: () => webContents.isDestroyed(),
      logDirectory: args.logDirectory,
      logger,
      now: Date.now,
      readRendererMemory: () => readRendererProcessMemory(rendererPid),
      timeoutMs: RENDERER_HANG_DIAGNOSTIC_TIMEOUT_MS,
      window: {
        id: windowId,
        rendererPid,
        url: webContents.getURL(),
        webContentsId: webContents.id,
      },
      writeFile: writeReportFile,
    })
      .catch((error: unknown) => {
        logger.warn(
          `[desktop] renderer hang diagnostic for window ${windowId} failed: ${describeError(error)}`,
        );
      })
      .finally(() => {
        state = rearmAfterCapture ? "armed" : "captured";
        rearmAfterCapture = false;
      });
  });
  browserWindow.on("responsive", () => {
    if (state === "capturing") {
      rearmAfterCapture = true;
      return;
    }
    state = "armed";
  });
}

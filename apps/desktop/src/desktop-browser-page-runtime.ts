import {
  BB_DESKTOP_BROWSER_PAGE_SCRIPT_MAX_RESULT_BYTES,
  bbDesktopBrowserJsonValueSchema,
  type BbDesktopBrowserJsonValue,
  type BbDesktopBrowserPageScriptRequest,
  type BbDesktopBrowserPageScriptResult,
} from "@bb/desktop-contract";

/** Electron reserves 0 for the page and 999 for extensions. */
export const BB_BROWSER_PAGE_ISOLATED_WORLD_ID = 1_004;
const PAGE_RUNTIME_REGISTRY_KEY = "__bbBrowserPageRuntimeV1";

interface PageRuntimeWebContents {
  debugger: {
    attach(protocolVersion?: string): void;
    detach(): void;
    isAttached(): boolean;
    sendCommand(method: string): Promise<unknown>;
  };
  executeJavaScriptInIsolatedWorld(
    worldId: number,
    scripts: Array<{ code: string; url?: string }>,
    userGesture?: boolean,
  ): Promise<unknown>;
  executeJavaScript(code: string, userGesture?: boolean): Promise<unknown>;
  isDestroyed(): boolean;
}

function executeInRequestedWorld(
  webContents: PageRuntimeWebContents,
  world: "isolated" | "main" | undefined,
  code: string,
  url?: string,
): Promise<unknown> {
  return world === "main"
    ? webContents.executeJavaScript(code, true)
    : webContents.executeJavaScriptInIsolatedWorld(
        BB_BROWSER_PAGE_ISOLATED_WORLD_ID,
        [{ code, ...(url === undefined ? {} : { url }) }],
        true,
      );
}

async function terminateUnresponsiveExecution(
  webContents: PageRuntimeWebContents,
): Promise<void> {
  if (webContents.isDestroyed()) return;
  let attachedHere = false;
  try {
    if (!webContents.debugger.isAttached()) {
      webContents.debugger.attach("1.3");
      attachedHere = true;
    }
    await webContents.debugger.sendCommand("Runtime.terminateExecution");
  } catch {
    // The request is already rejected locally. Termination is a best-effort
    // backstop for scripts that do not yield to their cooperative AbortSignal.
  } finally {
    if (attachedHere && webContents.debugger.isAttached()) {
      webContents.debugger.detach();
    }
  }
}

interface PageRuntimeEnvelope {
  ok: boolean;
  value?: unknown;
  error?: { code?: unknown; message?: unknown };
}

export interface DesktopBrowserPageScriptSession {
  readonly navigationEpoch: number;
  readonly requestId: string;
  readonly promise: Promise<BbDesktopBrowserPageScriptResult>;
  cancel(reason?: string): void;
}

export interface StartDesktopBrowserPageScriptArgs {
  navigationEpoch: number;
  request: BbDesktopBrowserPageScriptRequest;
  webContents: PageRuntimeWebContents;
}

function runtimeInvocationCode(
  request: BbDesktopBrowserPageScriptRequest,
): string {
  return `void (async () => {
    const registryKey = ${JSON.stringify(PAGE_RUNTIME_REGISTRY_KEY)};
    const requestId = ${JSON.stringify(request.requestId)};
    const source = ${JSON.stringify(request.source)};
    const input = ${JSON.stringify(request.input)};
    const maxResultBytes = ${BB_DESKTOP_BROWSER_PAGE_SCRIPT_MAX_RESULT_BYTES};
    const root = globalThis;
    const registry = root[registryKey] instanceof Map ? root[registryKey] : new Map();
    root[registryKey] = registry;
    registry.get(requestId)?.abort("replaced");
    const controller = new AbortController();
    registry.set(requestId, controller);
    try {
      const run = (0, eval)("(" + source + ")");
      if (typeof run !== "function") throw new Error("Browser page script source must evaluate to a function");
      const value = await run(Object.freeze({ input, signal: controller.signal }));
      if (controller.signal.aborted) throw Object.assign(new Error("Browser page script was cancelled"), { code: "aborted" });
      const normalized = value === undefined ? null : value;
      const serializedValue = JSON.stringify(normalized);
      if (serializedValue === undefined) throw new Error("Browser page script returned a non-JSON value");
      if (new TextEncoder().encode(serializedValue).byteLength > maxResultBytes) {
        throw Object.assign(new Error("Browser page script result exceeds the byte limit"), { code: "result_too_large" });
      }
      return JSON.stringify({ ok: true, value: JSON.parse(serializedValue) });
    } catch (error) {
      const aborted = controller.signal.aborted;
      return JSON.stringify({
        ok: false,
        error: {
          code: aborted ? "aborted" : (typeof error?.code === "string" ? error.code : "script_failed"),
          message: aborted ? "Browser page script was cancelled" : String(error?.message ?? error ?? "Browser page script failed").slice(0, 1024)
        }
      });
    } finally {
      if (registry.get(requestId) === controller) registry.delete(requestId);
    }
  })()`;
}

function runtimeCancellationCode(requestId: string, reason: string): string {
  return `globalThis[${JSON.stringify(PAGE_RUNTIME_REGISTRY_KEY)}]?.get(${JSON.stringify(requestId)})?.abort(${JSON.stringify(reason)});`;
}

function safeErrorMessage(value: unknown): string {
  return typeof value === "string" && value.length > 0
    ? value.slice(0, 1_024)
    : "Browser page script failed";
}

function parseEnvelope(value: unknown): PageRuntimeEnvelope {
  if (typeof value !== "string") {
    throw new Error("Browser page runtime returned an invalid envelope");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error("Browser page runtime returned invalid JSON");
  }
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    typeof (parsed as PageRuntimeEnvelope).ok !== "boolean"
  ) {
    throw new Error("Browser page runtime returned an invalid envelope");
  }
  return parsed as PageRuntimeEnvelope;
}

export function startDesktopBrowserPageScript(
  args: StartDesktopBrowserPageScriptArgs,
): DesktopBrowserPageScriptSession {
  const { request, webContents } = args;
  let settled = false;
  let rejectPromise: ((error: Error) => void) | null = null;
  let timeout: ReturnType<typeof setTimeout> | null = null;

  const cancelInPage = (reason: string): void => {
    if (webContents.isDestroyed()) return;
    void executeInRequestedWorld(
      webContents,
      request.world,
      runtimeCancellationCode(request.requestId, reason),
    ).catch(() => undefined);
  };

  const promise = new Promise<BbDesktopBrowserPageScriptResult>(
    (resolve, reject) => {
      rejectPromise = reject;
      timeout = setTimeout(() => {
        if (settled) return;
        settled = true;
        cancelInPage("timeout");
        void terminateUnresponsiveExecution(webContents);
        reject(new Error("Browser page script timed out"));
      }, request.timeoutMs);

      void executeInRequestedWorld(
        webContents,
        request.world,
        runtimeInvocationCode(request),
        `bb-browser-page-runtime://${encodeURIComponent(request.requestId)}`,
      )
        .then((rawEnvelope) => {
          if (settled) return;
          const envelope = parseEnvelope(rawEnvelope);
          if (!envelope.ok) {
            const error = new Error(safeErrorMessage(envelope.error?.message));
            error.name =
              envelope.error?.code === "aborted"
                ? "AbortError"
                : "BrowserPageScriptError";
            throw error;
          }
          const value = bbDesktopBrowserJsonValueSchema.parse(
            envelope.value ?? null,
          ) as BbDesktopBrowserJsonValue;
          settled = true;
          resolve({
            requestId: request.requestId,
            navigationEpoch: args.navigationEpoch,
            value,
          });
        })
        .catch((error: unknown) => {
          if (settled) return;
          settled = true;
          reject(error instanceof Error ? error : new Error(String(error)));
        })
        .finally(() => {
          if (timeout !== null) clearTimeout(timeout);
        });
    },
  );

  return {
    navigationEpoch: args.navigationEpoch,
    requestId: request.requestId,
    promise,
    cancel(reason = "cancelled") {
      if (settled) return;
      settled = true;
      if (timeout !== null) clearTimeout(timeout);
      cancelInPage(reason);
      const error = new Error(
        reason === "navigation"
          ? "Browser page changed while the script was running"
          : "Browser page script was cancelled",
      );
      error.name = reason === "navigation" ? "NavigationError" : "AbortError";
      rejectPromise?.(error);
    },
  };
}

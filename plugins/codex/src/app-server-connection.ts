import { spawn, type ChildProcess } from "node:child_process";
import { createInterface } from "node:readline";
import type { z } from "zod";
import { withoutBridgeRuntimeEnv } from "@bb/provider-driver-helpers/bridge-runtime-env";

const CODEX_STDERR_MAX_LINES = 40;
const CODEX_STDERR_MAX_LINE_BYTES = 16 * 1024;
const CODEX_MAX_PENDING_REQUESTS = 2_048;
const CODEX_REQUEST_TIMEOUT_MS = 120_000;

export interface CodexAppServerResponder {
  result(value: unknown): void;
  error(code: number, message: string): void;
}

export interface CodexAppServerExitInfo {
  code: number | null;
  signal: NodeJS.Signals | null;
  stderrTail: string;
}

export interface CodexAppServerConnection {
  readonly exited: boolean;
  request<Result>(args: {
    method: string;
    params?: unknown;
    resultSchema: z.ZodType<Result>;
    timeoutMs?: number;
  }): Promise<Result>;
  notify(method: string, params?: unknown): void;
  stop(): Promise<void>;
}

interface PendingRequest {
  reject(error: Error): void;
  resolve(value: unknown): void;
  timeout: ReturnType<typeof setTimeout>;
}

interface ParsedMessage {
  id?: string | number;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: { code?: number; message?: string };
}

function parseLine(line: string): ParsedMessage | null {
  try {
    const parsed: unknown = JSON.parse(line);
    return parsed !== null &&
      typeof parsed === "object" &&
      !Array.isArray(parsed)
      ? (parsed as ParsedMessage)
      : null;
  } catch {
    return null;
  }
}

export function createCodexAppServerConnection(args: {
  command?: string;
  processArgs?: string[];
  cwd: string;
  env?: Record<string, string>;
  onNotification(method: string, params: unknown): void;
  onRequest(
    method: string,
    params: unknown,
    responder: CodexAppServerResponder,
  ): void;
  onExit(info: CodexAppServerExitInfo): void;
}): CodexAppServerConnection {
  const command = args.command ?? "codex";
  const processArgs = args.processArgs ?? ["app-server"];
  const child: ChildProcess = spawn(command, processArgs, {
    cwd: args.cwd,
    env: {
      ...withoutBridgeRuntimeEnv(process.env),
      ...args.env,
    },
    stdio: ["pipe", "pipe", "pipe"],
  });
  const pending = new Map<number, PendingRequest>();
  const activeInboundRequestIds = new Set<string>();
  const stderrLines: string[] = [];
  let nextRequestId = 1;
  let exited = false;
  let exitPromise: Promise<void> | null = null;

  function write(message: object): void {
    const stdin = child.stdin;
    if (!stdin || stdin.destroyed || !stdin.writable) return;
    stdin.write(`${JSON.stringify(message)}\n`);
  }

  function rejectPending(error: Error): void {
    for (const request of pending.values()) {
      clearTimeout(request.timeout);
      request.reject(error);
    }
    pending.clear();
  }

  if (!child.stdout || !child.stderr) {
    child.kill("SIGKILL");
    throw new Error("Codex app-server did not expose stdio pipes");
  }

  createInterface({ input: child.stdout }).on("line", (line) => {
    const message = parseLine(line);
    if (!message) return;
    const id = message.id;
    if (
      (typeof id === "number" || typeof id === "string") &&
      message.method === undefined
    ) {
      const numericId = typeof id === "number" ? id : Number(id);
      const request = pending.get(numericId);
      if (!request) return;
      pending.delete(numericId);
      clearTimeout(request.timeout);
      if (message.error) {
        request.reject(
          new Error(
            message.error.message ??
              `Codex app-server returned error ${message.error.code ?? "unknown"}`,
          ),
        );
      } else {
        request.resolve(message.result);
      }
      return;
    }
    if (typeof message.method !== "string") return;
    if (typeof id === "number" || typeof id === "string") {
      const requestId = `${typeof id}:${String(id)}`;
      if (activeInboundRequestIds.has(requestId)) {
        write({
          jsonrpc: "2.0",
          id,
          error: { code: -32600, message: "Duplicate active Codex request id" },
        });
        return;
      }
      activeInboundRequestIds.add(requestId);
      let settled = false;
      const settle = (): boolean => {
        if (settled) return false;
        settled = true;
        activeInboundRequestIds.delete(requestId);
        return true;
      };
      args.onRequest(message.method, message.params, {
        result(value) {
          if (!settle()) return;
          write({ jsonrpc: "2.0", id, result: value ?? null });
        },
        error(code, messageText) {
          if (!settle()) return;
          write({
            jsonrpc: "2.0",
            id,
            error: { code, message: messageText },
          });
        },
      });
      return;
    }
    args.onNotification(message.method, message.params);
  });

  createInterface({ input: child.stderr }).on("line", (line) => {
    const boundedLine =
      Buffer.byteLength(line, "utf8") > CODEX_STDERR_MAX_LINE_BYTES
        ? `${Buffer.from(line).subarray(0, CODEX_STDERR_MAX_LINE_BYTES).toString("utf8")}…`
        : line;
    stderrLines.push(boundedLine);
    if (stderrLines.length > CODEX_STDERR_MAX_LINES) stderrLines.shift();
  });

  function handleExit(
    code: number | null,
    signal: NodeJS.Signals | null,
  ): void {
    if (exited) return;
    exited = true;
    const stderrTail = stderrLines.join("\n");
    rejectPending(
      new Error(
        `Codex app-server exited (code ${code ?? "null"}, signal ${signal ?? "null"})${stderrTail ? `: ${stderrTail}` : ""}`,
      ),
    );
    args.onExit({ code, signal, stderrTail });
  }

  child.on("error", (error) => {
    stderrLines.push(error.message);
    handleExit(null, null);
  });
  child.on("exit", (code, signal) => handleExit(code, signal));

  return {
    get exited() {
      return exited;
    },
    request({ method, params, resultSchema, timeoutMs }) {
      if (exited) {
        return Promise.reject(new Error("Codex app-server is not running"));
      }
      if (pending.size >= CODEX_MAX_PENDING_REQUESTS) {
        return Promise.reject(
          new Error("Codex app-server pending request limit exceeded"),
        );
      }
      const id = nextRequestId++;
      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          pending.delete(id);
          const error = new Error(
            `Codex app-server request timed out: ${method}`,
          );
          reject(error);
          // A timed-out mutation may already have been accepted. Kill this
          // connection so the canonical driver cannot race a retry against a
          // late provider response.
          rejectPending(error);
          child.kill("SIGKILL");
        }, timeoutMs ?? CODEX_REQUEST_TIMEOUT_MS);
        pending.set(id, {
          timeout,
          reject,
          resolve(value) {
            const parsed = resultSchema.safeParse(value);
            if (parsed.success) resolve(parsed.data);
            else {
              reject(
                new Error(
                  `Codex app-server returned an invalid ${method} result: ${parsed.error.message}`,
                ),
              );
            }
          },
        });
        write({
          jsonrpc: "2.0",
          id,
          method,
          ...(params === undefined ? {} : { params }),
        });
      });
    },
    notify(method, params) {
      if (exited) return;
      write({
        jsonrpc: "2.0",
        method,
        ...(params === undefined ? {} : { params }),
      });
    },
    stop() {
      if (exited) return Promise.resolve();
      if (exitPromise) return exitPromise;
      exitPromise = new Promise<void>((resolve) => {
        const timer = setTimeout(() => {
          child.kill("SIGKILL");
        }, 4_000);
        child.once("exit", () => {
          clearTimeout(timer);
          resolve();
        });
        child.kill("SIGTERM");
      });
      return exitPromise;
    },
  };
}

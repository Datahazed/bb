import type { ChildProcess } from "node:child_process";
import { Readable, Writable } from "node:stream";
import type {
  ProviderDriverInitializeParams,
  ProviderDriverInitializeResult,
} from "@bb/provider-driver-contract";
import {
  sanitizeInheritedChildProcessEnv,
  spawnPortableProcess,
} from "@bb/process-utils";
import {
  ProcessProviderDriverConnection,
  type ProcessProviderDriverConnectionRequestTimeouts,
  type ProcessProviderDriverHostHandlers,
  type ProviderDriverProcessExit,
} from "./process-connection.js";

const PROVIDER_DRIVER_DIAGNOSTIC_LINE_MAX_BYTES = 16 * 1024;
const PROVIDER_DRIVER_DIAGNOSTIC_MAX_LINES = 1_000;
const PROVIDER_DRIVER_STOP_TIMEOUT_MS = 5_000;

export interface ProviderDriverLaunchSpec {
  readonly args: readonly string[];
  readonly command: string;
  readonly cwd: string;
  readonly env: Readonly<Record<string, string>>;
  readonly release?: () => void;
}

export interface ProviderDriverDiagnostic {
  line: string;
  stream: "stderr" | "stdout";
}

export interface ProviderDriverSupervisorLaunchArgs {
  hostHandlers?: ProcessProviderDriverHostHandlers;
  initialize: ProviderDriverInitializeParams;
  launch: ProviderDriverLaunchSpec;
  onDiagnostic?: (diagnostic: ProviderDriverDiagnostic) => void;
  onExit?: (exit: ProviderDriverProcessExit) => void;
  onProtocolError?: (error: Error) => void;
  processKey: string;
  requestTimeoutMs?: number;
  requestTimeouts?: ProcessProviderDriverConnectionRequestTimeouts;
}

export interface SupervisedProviderDriver {
  readonly child: ChildProcess;
  readonly connection: ProcessProviderDriverConnection;
  readonly initialization: ProviderDriverInitializeResult;
  readonly processKey: string;
  stop(): Promise<void>;
}

function requireReadable(value: unknown, label: string): Readable {
  if (!(value instanceof Readable)) {
    throw new Error(`Provider driver did not attach readable ${label}`);
  }
  return value;
}

function requireWritable(value: unknown, label: string): Writable {
  if (!(value instanceof Writable)) {
    throw new Error(`Provider driver did not attach writable ${label}`);
  }
  return value;
}

function appendBounded(current: Buffer, chunk: Buffer): Buffer {
  if (chunk.length >= PROVIDER_DRIVER_DIAGNOSTIC_LINE_MAX_BYTES) {
    return Buffer.from(
      chunk.subarray(chunk.length - PROVIDER_DRIVER_DIAGNOSTIC_LINE_MAX_BYTES),
    );
  }
  const currentBytesToKeep = Math.min(
    current.length,
    PROVIDER_DRIVER_DIAGNOSTIC_LINE_MAX_BYTES - chunk.length,
  );
  return Buffer.concat([
    current.subarray(current.length - currentBytesToKeep),
    chunk,
  ]);
}

function observeDiagnosticStream(args: {
  onDiagnostic: ((diagnostic: ProviderDriverDiagnostic) => void) | undefined;
  source: Readable;
  stream: ProviderDriverDiagnostic["stream"];
}): void {
  let tail: Buffer<ArrayBufferLike> = Buffer.alloc(0);
  let emittedLines = 0;
  let truncated = false;
  const emit = (line: string): void => {
    if (truncated) return;
    if (emittedLines >= PROVIDER_DRIVER_DIAGNOSTIC_MAX_LINES) {
      truncated = true;
      args.onDiagnostic?.({
        line: `[provider driver ${args.stream} diagnostics truncated]`,
        stream: args.stream,
      });
      return;
    }
    emittedLines += 1;
    args.onDiagnostic?.({ line, stream: args.stream });
  };

  args.source.on("data", (chunk: Buffer) => {
    if (truncated) return;
    let remaining = chunk;
    while (remaining.length > 0 && !truncated) {
      const newlineIndex = remaining.indexOf(0x0a);
      if (newlineIndex === -1) {
        tail = appendBounded(tail, remaining);
        return;
      }
      tail = appendBounded(tail, remaining.subarray(0, newlineIndex));
      emit(tail.toString("utf8").replace(/\r$/u, ""));
      tail = Buffer.alloc(0);
      remaining = remaining.subarray(newlineIndex + 1);
    }
  });
  args.source.on("end", () => {
    if (tail.length > 0 && !truncated) {
      emit(tail.toString("utf8").replace(/\r$/u, ""));
      tail = Buffer.alloc(0);
    }
  });
}

async function terminateChild(
  child: ChildProcess,
  timeoutMs = PROVIDER_DRIVER_STOP_TIMEOUT_MS,
): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) {
    return;
  }
  await new Promise<void>((resolve) => {
    const softTimer = setTimeout(() => {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill("SIGKILL");
      }
    }, timeoutMs);
    const hardTimer = setTimeout(resolve, timeoutMs + 1_000);
    child.once("exit", () => {
      clearTimeout(softTimer);
      clearTimeout(hardTimer);
      resolve();
    });
    child.kill("SIGTERM");
  });
}

/** Launches, deduplicates, and terminates canonical provider driver processes. */
export class ProviderDriverSupervisor {
  private readonly drivers = new Map<
    string,
    Promise<SupervisedProviderDriver>
  >();
  private shuttingDown = false;

  async launch(
    args: ProviderDriverSupervisorLaunchArgs,
  ): Promise<SupervisedProviderDriver> {
    if (this.shuttingDown) {
      throw new Error("Provider driver supervisor is shutting down");
    }
    const existing = this.drivers.get(args.processKey);
    if (existing) {
      return existing;
    }

    const launchPromise = this.launchNew(args);
    this.drivers.set(args.processKey, launchPromise);
    try {
      return await launchPromise;
    } catch (error) {
      if (this.drivers.get(args.processKey) === launchPromise) {
        this.drivers.delete(args.processKey);
      }
      throw error;
    }
  }

  async shutdown(): Promise<void> {
    this.shuttingDown = true;
    const drivers = await Promise.allSettled(this.drivers.values());
    await Promise.all(
      drivers.flatMap((result) =>
        result.status === "fulfilled" ? [result.value.stop()] : [],
      ),
    );
    this.drivers.clear();
  }

  private async launchNew(
    args: ProviderDriverSupervisorLaunchArgs,
  ): Promise<SupervisedProviderDriver> {
    let released = false;
    const release = (): void => {
      if (released) return;
      released = true;
      args.launch.release?.();
    };
    const child = (() => {
      try {
        return spawnPortableProcess({
          command: args.launch.command,
          args: [...args.launch.args],
          cwd: args.launch.cwd,
          env: {
            ...sanitizeInheritedChildProcessEnv({ env: process.env }),
            ...args.launch.env,
          },
          // fd 3: host -> driver; fd 4: driver -> host. stdout and stderr are
          // diagnostics only and can never corrupt protocol framing.
          stdio: ["ignore", "pipe", "pipe", "pipe", "pipe"],
        });
      } catch (error) {
        release();
        throw error;
      }
    })();

    try {
      const stdout = requireReadable(child.stdout, "stdout");
      const stderr = requireReadable(child.stderr, "stderr");
      const protocolWritable = requireWritable(
        child.stdio[3],
        "protocol input fd 3",
      );
      const protocolReadable = requireReadable(
        child.stdio[4],
        "protocol output fd 4",
      );
      observeDiagnosticStream({
        onDiagnostic: args.onDiagnostic,
        source: stdout,
        stream: "stdout",
      });
      observeDiagnosticStream({
        onDiagnostic: args.onDiagnostic,
        source: stderr,
        stream: "stderr",
      });

      const connection = new ProcessProviderDriverConnection({
        hostHandlers: args.hostHandlers,
        onProtocolError: (error) => {
          args.onProtocolError?.(error);
          if (child.exitCode === null && child.signalCode === null) {
            child.kill("SIGKILL");
          }
        },
        readable: protocolReadable,
        requestTimeoutMs: args.requestTimeoutMs,
        writable: protocolWritable,
      });
      if (args.requestTimeouts) {
        connection.configureRequestTimeouts(args.requestTimeouts);
      }
      let stopped = false;
      let handle: SupervisedProviderDriver | null = null;

      connection.onExit((exit) => {
        release();
        args.onExit?.(exit);
        const current = this.drivers.get(args.processKey);
        if (current !== undefined) {
          void current.then(
            (resolved) => {
              if (handle !== null && resolved === handle) {
                this.drivers.delete(args.processKey);
              }
            },
            () => {
              // Startup failure removes the promise in launch().
            },
          );
        }
      });
      child.once("error", () => {
        connection.recordProcessExit({ code: null, signal: null });
      });
      child.once("exit", (code, signal) => {
        connection.recordProcessExit({
          code: code ?? null,
          signal: signal ?? null,
        });
      });

      const initialization = await connection.initialize(args.initialize);
      handle = {
        child,
        connection,
        initialization,
        processKey: args.processKey,
        stop: async () => {
          if (stopped) return;
          stopped = true;
          try {
            await connection.shutdown();
          } catch {
            // Process termination below is authoritative during shutdown.
          }
          await terminateChild(child);
          release();
          const current = this.drivers.get(args.processKey);
          if (current !== undefined) {
            await current.then(
              (resolved) => {
                if (resolved === handle) {
                  this.drivers.delete(args.processKey);
                }
              },
              () => {
                // Startup failure removes the promise in launch().
              },
            );
          }
        },
      };
      return handle;
    } catch (error) {
      await terminateChild(child);
      release();
      throw error;
    }
  }
}

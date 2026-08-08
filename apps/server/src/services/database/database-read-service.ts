import type {
  DbConnection,
  ListThreadsForProjectsOptions,
  ListThreadsOptions,
} from "@bb/db";
import {
  listThreadsWithPendingInteractionState,
  listThreadsWithPendingInteractionStateForProjects,
} from "@bb/db";
import type { ThreadListEntry } from "@bb/domain";
import { Worker } from "node:worker_threads";
import { ApiError, ClientClosedRequestError } from "../../errors.js";
import type { ServerLogger } from "../../types.js";
import type { NotificationHub } from "../../ws/hub.js";
import { toThreadListEntryResponses } from "../threads/thread-runtime-display.js";
import {
  databaseReadWorkerMessageSchema,
  type DatabaseReadWorkerData,
  type DatabaseReadWorkerRequest,
} from "./database-read-worker-contract.js";

const DEFAULT_MAX_PENDING_DATABASE_READS = 32;
const DEFAULT_DATABASE_READ_TIMEOUT_MS = 30_000;

interface PendingDatabaseRead {
  abortHandler?: () => void;
  createRequest(id: number): DatabaseReadWorkerRequest;
  id: number;
  reject(error: Error): void;
  resolve(entries: ThreadListEntry[]): void;
  settled: boolean;
  signal?: AbortSignal;
  timeout: NodeJS.Timeout;
}

interface DatabaseReadWorkerState {
  failed: boolean;
  ready: Promise<void>;
  rejectReady(error: Error): void;
  resolveReady(): void;
  wasReady: boolean;
  worker: Worker;
}

export interface DatabaseReadRequestContext {
  signal?: AbortSignal;
}

export class DatabaseReadAbortedError extends ClientClosedRequestError {
  constructor() {
    super("The database read request stopped");
    this.name = "DatabaseReadAbortedError";
  }
}

export class DatabaseReadUnavailableError extends ApiError {
  constructor(message: string) {
    super(503, "database_read_unavailable", message, { retryable: true });
    this.name = "DatabaseReadUnavailableError";
  }
}

export class DatabaseReadTimeoutError extends ApiError {
  constructor() {
    super(
      503,
      "database_read_unavailable",
      "The database read timed out. Try again later.",
      { retryable: false },
    );
    this.name = "DatabaseReadTimeoutError";
  }
}

export interface DatabaseReadService {
  close(): Promise<void>;
  listThreadEntries(
    options: ListThreadsOptions,
    context?: DatabaseReadRequestContext,
  ): Promise<ThreadListEntry[]>;
  listThreadEntriesForProjects(
    options: ListThreadsForProjectsOptions,
    context?: DatabaseReadRequestContext,
  ): Promise<ThreadListEntry[]>;
}

interface CreateDirectDatabaseReadServiceArgs {
  db: DbConnection;
  hub: NotificationHub;
}

export function createDirectDatabaseReadService(
  args: CreateDirectDatabaseReadServiceArgs,
): DatabaseReadService {
  function toEntries(
    threads: Parameters<typeof toThreadListEntryResponses>[1]["threads"],
  ) {
    return toThreadListEntryResponses(args, { threads });
  }

  return {
    async close(): Promise<void> {},
    async listThreadEntries(
      options: ListThreadsOptions,
    ): Promise<ThreadListEntry[]> {
      return toEntries(
        listThreadsWithPendingInteractionState(args.db, options),
      );
    },
    async listThreadEntriesForProjects(
      options: ListThreadsForProjectsOptions,
    ): Promise<ThreadListEntry[]> {
      return toEntries(
        listThreadsWithPendingInteractionStateForProjects(args.db, options),
      );
    },
  };
}

interface CreateWorkerDatabaseReadServiceArgs {
  databasePath: string;
  hub: NotificationHub;
  logger: ServerLogger;
  maxPendingReads?: number;
  onWorkerCreated?: (worker: Worker) => void;
  requestTimeoutMs?: number;
}

function resolveWorkerEntryUrl(): URL {
  const sourceFile = import.meta.url.endsWith(".ts");
  return new URL(
    sourceFile
      ? "./database-read-worker-entry.ts"
      : "./database-read-worker-entry.js",
    import.meta.url,
  );
}

function requireNonnegativeInteger(value: number, name: string): number {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${name} must be a nonnegative integer`);
  }
  return value;
}

export async function createWorkerDatabaseReadService(
  args: CreateWorkerDatabaseReadServiceArgs,
): Promise<DatabaseReadService> {
  const workerData: DatabaseReadWorkerData = {
    databasePath: args.databasePath,
  };
  const maxPendingReads = requireNonnegativeInteger(
    args.maxPendingReads ?? DEFAULT_MAX_PENDING_DATABASE_READS,
    "maxPendingReads",
  );
  const requestTimeoutMs = requireNonnegativeInteger(
    args.requestTimeoutMs ?? DEFAULT_DATABASE_READ_TIMEOUT_MS,
    "requestTimeoutMs",
  );
  const sourceFile = import.meta.url.endsWith(".ts");
  const queue: PendingDatabaseRead[] = [];
  const workers = new Set<Worker>();
  let activeRead: PendingDatabaseRead | null = null;
  let activeWorker: DatabaseReadWorkerState | null = null;
  let closed = false;
  let dispatching = false;
  let hasReadyWorker = false;
  let nextRequestId = 0;
  let preparingRead: PendingDatabaseRead | null = null;

  function clearReadResources(read: PendingDatabaseRead): void {
    clearTimeout(read.timeout);
    if (read.abortHandler !== undefined) {
      read.signal?.removeEventListener("abort", read.abortHandler);
    }
  }

  function rejectRead(read: PendingDatabaseRead, error: Error): void {
    if (read.settled) {
      return;
    }
    read.settled = true;
    clearReadResources(read);
    read.reject(error);
  }

  function resolveRead(
    read: PendingDatabaseRead,
    entries: ThreadListEntry[],
  ): void {
    if (read.settled) {
      return;
    }
    read.settled = true;
    clearReadResources(read);
    read.resolve(entries);
  }

  function removeQueuedRead(read: PendingDatabaseRead): void {
    const index = queue.indexOf(read);
    if (index !== -1) {
      queue.splice(index, 1);
    }
  }

  function rejectAllReads(error: Error): void {
    if (preparingRead !== null) {
      rejectRead(preparingRead, error);
      preparingRead = null;
    }
    if (activeRead !== null) {
      rejectRead(activeRead, error);
      activeRead = null;
    }
    for (const read of queue.splice(0)) {
      rejectRead(read, error);
    }
  }

  function pendingReadCount(): number {
    return (
      queue.length +
      (preparingRead === null ? 0 : 1) +
      (activeRead === null ? 0 : 1)
    );
  }

  function startWorker(): DatabaseReadWorkerState {
    const worker = new Worker(resolveWorkerEntryUrl(), {
      ...(sourceFile
        ? { execArgv: ["--conditions=source", "--import", "tsx"] }
        : {}),
      name: "bb-database-read-worker",
      workerData,
    });
    let rejectReady!: (error: Error) => void;
    let resolveReady!: () => void;
    const ready = new Promise<void>((resolve, reject) => {
      rejectReady = reject;
      resolveReady = resolve;
    });
    const state: DatabaseReadWorkerState = {
      failed: false,
      ready,
      rejectReady,
      resolveReady,
      wasReady: false,
      worker,
    };
    workers.add(worker);
    args.onWorkerCreated?.(worker);

    function fail(error: Error): void {
      if (state.failed || closed) {
        return;
      }
      state.failed = true;
      args.logger.warn(
        { err: error, workerWasReady: state.wasReady },
        "Database read worker failed",
      );
      const requestError = hasReadyWorker
        ? new DatabaseReadUnavailableError(
            "The database read worker stopped. Try again later.",
          )
        : error;
      state.rejectReady(requestError);
      rejectAllReads(requestError);
      if (activeWorker !== state) {
        return;
      }
      activeWorker = null;
      if (state.wasReady) {
        activeWorker = startWorker();
        void activeWorker.ready.catch(() => {});
      }
    }

    worker.on("message", (value: unknown) => {
      const parsedMessage = databaseReadWorkerMessageSchema.safeParse(value);
      if (!parsedMessage.success) {
        fail(new Error("The database read worker sent an invalid message"));
        void worker.terminate();
        return;
      }
      const message = parsedMessage.data;
      if (message.kind === "ready") {
        state.wasReady = true;
        hasReadyWorker = true;
        state.resolveReady();
        return;
      }
      if (message.kind === "log") {
        args.logger.debug(message.fields, message.message);
        return;
      }
      if (activeWorker !== state || activeRead?.id !== message.id) {
        return;
      }

      const read = activeRead;
      activeRead = null;
      if (message.kind === "error") {
        const error = new Error(message.error.message);
        error.stack = message.error.stack;
        rejectRead(read, error);
      } else {
        if (message.droppedEntryCount > 0) {
          args.logger.warn(
            {
              droppedEntryCount: message.droppedEntryCount,
              requestId: message.id,
            },
            "Dropped an invalid thread entry from a database read worker result",
          );
        }
        resolveRead(read, message.entries);
      }
      scheduleDispatch();
    });
    worker.on("error", (error) => {
      fail(error);
    });
    worker.on("exit", (code) => {
      workers.delete(worker);
      fail(
        new Error(`The database read worker stopped with exit code ${code}`),
      );
    });

    return state;
  }

  function replaceWorker(error: Error): void {
    if (activeWorker === null) {
      return;
    }
    const replacedWorker = activeWorker;
    replacedWorker.failed = true;
    replacedWorker.rejectReady(error);
    activeWorker = startWorker();
    void activeWorker.ready.catch(() => {});
    void replacedWorker.worker.terminate();
  }

  async function requireReadyWorker(): Promise<DatabaseReadWorkerState> {
    if (closed) {
      throw new Error("The database read service stopped");
    }
    const state = activeWorker ?? startWorker();
    activeWorker = state;
    await state.ready;
    if (closed) {
      throw new Error("The database read service stopped");
    }
    return state;
  }

  function scheduleDispatch(): void {
    if (closed || dispatching || activeRead !== null || queue.length === 0) {
      return;
    }
    void dispatchNext();
  }

  async function dispatchNext(): Promise<void> {
    if (dispatching || closed || activeRead !== null) {
      return;
    }
    const read = queue.shift();
    if (read === undefined) {
      return;
    }
    if (read.settled) {
      scheduleDispatch();
      return;
    }

    dispatching = true;
    preparingRead = read;
    try {
      const state = await requireReadyWorker();
      if (read.settled || closed) {
        return;
      }
      preparingRead = null;
      activeRead = read;
      try {
        state.worker.postMessage(read.createRequest(read.id));
      } catch (error) {
        activeRead = null;
        rejectRead(
          read,
          error instanceof Error ? error : new Error(String(error)),
        );
      }
    } catch (error) {
      rejectRead(
        read,
        error instanceof Error ? error : new Error(String(error)),
      );
    } finally {
      if (preparingRead === read) {
        preparingRead = null;
      }
      dispatching = false;
      scheduleDispatch();
    }
  }

  function sendRequest(
    createRequest: (id: number) => DatabaseReadWorkerRequest,
    context: DatabaseReadRequestContext | undefined,
  ): Promise<ThreadListEntry[]> {
    if (closed) {
      return Promise.reject(new Error("The database read service stopped"));
    }
    if (context?.signal?.aborted === true) {
      return Promise.reject(new DatabaseReadAbortedError());
    }
    if (pendingReadCount() >= maxPendingReads) {
      return Promise.reject(
        new DatabaseReadUnavailableError(
          "The database read queue is full. Try again later.",
        ),
      );
    }

    const id = nextRequestId;
    nextRequestId += 1;
    return new Promise((resolve, reject) => {
      const read: PendingDatabaseRead = {
        createRequest,
        id,
        reject,
        resolve,
        settled: false,
        timeout: setTimeout(() => {
          const timedOutWhileActive = activeRead === read;
          removeQueuedRead(read);
          if (timedOutWhileActive) {
            activeRead = null;
          }
          const error = new DatabaseReadTimeoutError();
          rejectRead(read, error);
          if (timedOutWhileActive) {
            replaceWorker(error);
          }
          scheduleDispatch();
        }, requestTimeoutMs),
      };
      if (context?.signal !== undefined) {
        read.signal = context.signal;
        read.abortHandler = (): void => {
          const abortedWhileActive = activeRead === read;
          removeQueuedRead(read);
          if (abortedWhileActive) {
            activeRead = null;
          }
          const error = new DatabaseReadAbortedError();
          rejectRead(read, error);
          if (abortedWhileActive) {
            replaceWorker(error);
          }
          scheduleDispatch();
        };
        context.signal.addEventListener("abort", read.abortHandler, {
          once: true,
        });
      }
      queue.push(read);
      scheduleDispatch();
    });
  }

  async function close(): Promise<void> {
    if (closed) {
      return;
    }
    const error = new Error("The database read service stopped");
    const workerState = activeWorker;
    closed = true;
    activeWorker = null;
    workerState?.rejectReady(error);
    rejectAllReads(error);
    await Promise.all([...workers].map((worker) => worker.terminate()));
  }

  activeWorker = startWorker();
  try {
    await activeWorker.ready;
  } catch (error) {
    await close();
    throw error;
  }

  return {
    close,
    listThreadEntries(
      options: ListThreadsOptions,
      context?: DatabaseReadRequestContext,
    ): Promise<ThreadListEntry[]> {
      return sendRequest(
        (id) => ({
          daemonSessions: args.hub.listDaemonSessions(),
          id,
          operation: "listThreadEntries",
          options,
        }),
        context,
      );
    },
    listThreadEntriesForProjects(
      options: ListThreadsForProjectsOptions,
      context?: DatabaseReadRequestContext,
    ): Promise<ThreadListEntry[]> {
      return sendRequest(
        (id) => ({
          daemonSessions: args.hub.listDaemonSessions(),
          id,
          operation: "listThreadEntriesForProjects",
          options: {
            ...options,
            projectIds: [...options.projectIds],
          },
        }),
        context,
      );
    },
  };
}

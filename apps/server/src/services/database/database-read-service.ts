import type {
  DbConnection,
  ListThreadsForProjectsOptions,
  ListThreadsOptions,
} from "@bb/db";
import type { ThreadListEntry } from "@bb/domain";
import type {
  ProjectWithThreadsResponse,
  SidebarBootstrapResponse,
} from "@bb/server-contract";
import { Worker } from "node:worker_threads";
import { ApiError, ClientClosedRequestError } from "../../errors.js";
import type { ServerLogger } from "../../types.js";
import type { NotificationHub } from "../../ws/hub.js";
import { executeDatabaseReadOperation } from "./database-read-operations.js";
import {
  databaseReadWorkerMessageSchema,
  type DatabaseReadWorkerData,
  type DatabaseReadWorkerRequest,
  type DatabaseReadWorkerResult,
} from "./database-read-worker-contract.js";

const DEFAULT_MAX_PENDING_DATABASE_READS = 32;
const DEFAULT_DATABASE_READ_TIMEOUT_MS = 30_000;
const DEFAULT_SLOW_DATABASE_READ_LOG_THRESHOLD_MS = 100;
const DEFAULT_DATABASE_READ_WORKER_STARTUP_TIMEOUT_MS = 10_000;

interface PendingDatabaseRead {
  abortHandler?: () => void;
  createRequest(id: number): DatabaseReadWorkerRequest;
  id: number;
  reject(error: Error): void;
  resolve(result: DatabaseReadWorkerResult): void;
  settled: boolean;
  signal?: AbortSignal;
  timeout: NodeJS.Timeout;
}

interface DatabaseReadWorkerState {
  clearReadyTimeout(): void;
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
  listProjectsWithThreads(
    options: { includePersonal: boolean },
    context?: DatabaseReadRequestContext,
  ): Promise<ProjectWithThreadsResponse[]>;
  getSidebarBootstrap(
    context?: DatabaseReadRequestContext,
  ): Promise<SidebarBootstrapResponse>;
}

function applyLiveDaemonStateToEntry(
  hub: NotificationHub,
  entry: ThreadListEntry,
): ThreadListEntry {
  if (
    entry.status !== "active" ||
    entry.environmentHostId === null ||
    hub.getDaemonSessionIdForHost(entry.environmentHostId) === null
  ) {
    return entry;
  }
  return {
    ...entry,
    runtime: {
      displayStatus: "active",
      hostReconnectGraceExpiresAt: null,
    },
  };
}

function applyLiveDaemonStateToEntries(
  hub: NotificationHub,
  entries: ThreadListEntry[],
): ThreadListEntry[] {
  return entries.map((entry) => applyLiveDaemonStateToEntry(hub, entry));
}

function applyLiveDaemonStateToProjects(
  hub: NotificationHub,
  projects: ProjectWithThreadsResponse[],
): ProjectWithThreadsResponse[] {
  return projects.map((project) => applyLiveDaemonStateToProject(hub, project));
}

function applyLiveDaemonStateToProject(
  hub: NotificationHub,
  project: ProjectWithThreadsResponse,
): ProjectWithThreadsResponse {
  return {
    ...project,
    threads: applyLiveDaemonStateToEntries(hub, project.threads),
  };
}

interface CreateDirectDatabaseReadServiceArgs {
  db: DbConnection;
  hub: NotificationHub;
}

export function createDirectDatabaseReadService(
  args: CreateDirectDatabaseReadServiceArgs,
): DatabaseReadService {
  function run(request: DatabaseReadWorkerRequest): DatabaseReadWorkerResult {
    return executeDatabaseReadOperation({ db: args.db }, request);
  }

  return {
    async close(): Promise<void> {},
    async listThreadEntries(
      options: ListThreadsOptions,
    ): Promise<ThreadListEntry[]> {
      const result = run({
        id: 0,
        operation: "listThreadEntries",
        options,
      });
      if (result.operation !== "listThreadEntries") {
        throw new Error("The direct database read returned an invalid result");
      }
      return applyLiveDaemonStateToEntries(args.hub, result.entries);
    },
    async listThreadEntriesForProjects(
      options: ListThreadsForProjectsOptions,
    ): Promise<ThreadListEntry[]> {
      const result = run({
        id: 0,
        operation: "listThreadEntriesForProjects",
        options: { ...options, projectIds: [...options.projectIds] },
      });
      if (result.operation !== "listThreadEntriesForProjects") {
        throw new Error("The direct database read returned an invalid result");
      }
      return applyLiveDaemonStateToEntries(args.hub, result.entries);
    },
    async listProjectsWithThreads(options: {
      includePersonal: boolean;
    }): Promise<ProjectWithThreadsResponse[]> {
      const result = run({
        id: 0,
        operation: "listProjectsWithThreads",
        options,
      });
      if (result.operation !== "listProjectsWithThreads") {
        throw new Error("The direct database read returned an invalid result");
      }
      return applyLiveDaemonStateToProjects(args.hub, result.projects);
    },
    async getSidebarBootstrap(): Promise<SidebarBootstrapResponse> {
      const result = run({
        id: 0,
        operation: "sidebarBootstrap",
      });
      if (result.operation !== "sidebarBootstrap") {
        throw new Error("The direct database read returned an invalid result");
      }
      return {
        ...result.response,
        projects: applyLiveDaemonStateToProjects(
          args.hub,
          result.response.projects,
        ),
        personalProject: applyLiveDaemonStateToProject(
          args.hub,
          result.response.personalProject,
        ),
      };
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
  slowQueryThresholdMs?: number;
  workerStartupTimeoutMs?: number;
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
  const maxPendingReads = requireNonnegativeInteger(
    args.maxPendingReads ?? DEFAULT_MAX_PENDING_DATABASE_READS,
    "maxPendingReads",
  );
  const requestTimeoutMs = requireNonnegativeInteger(
    args.requestTimeoutMs ?? DEFAULT_DATABASE_READ_TIMEOUT_MS,
    "requestTimeoutMs",
  );
  const slowQueryThresholdMs = requireNonnegativeInteger(
    args.slowQueryThresholdMs ?? DEFAULT_SLOW_DATABASE_READ_LOG_THRESHOLD_MS,
    "slowQueryThresholdMs",
  );
  const workerStartupTimeoutMs = requireNonnegativeInteger(
    args.workerStartupTimeoutMs ??
      DEFAULT_DATABASE_READ_WORKER_STARTUP_TIMEOUT_MS,
    "workerStartupTimeoutMs",
  );
  const workerData: DatabaseReadWorkerData = {
    databasePath: args.databasePath,
    slowQueryThresholdMs,
  };
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
    clearReadResources(read);
    if (read.settled) {
      return;
    }
    read.settled = true;
    read.reject(error);
  }

  function resolveRead(
    read: PendingDatabaseRead,
    result: DatabaseReadWorkerResult,
  ): void {
    clearReadResources(read);
    if (read.settled) {
      return;
    }
    read.settled = true;
    read.resolve(result);
  }

  function rejectCallerWhileReadContinues(
    read: PendingDatabaseRead,
    error: Error,
  ): void {
    if (read.settled) {
      return;
    }
    read.settled = true;
    if (read.abortHandler !== undefined) {
      read.signal?.removeEventListener("abort", read.abortHandler);
    }
    read.reject(error);
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
    let readyTimeout: NodeJS.Timeout | null = null;
    const state: DatabaseReadWorkerState = {
      clearReadyTimeout(): void {
        if (readyTimeout !== null) {
          clearTimeout(readyTimeout);
          readyTimeout = null;
        }
      },
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
      state.clearReadyTimeout();
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
        activeWorker = startRecoveryWorker();
      }
    }

    worker.on("message", (value: unknown) => {
      if (state.failed) {
        return;
      }
      const parsedMessage = databaseReadWorkerMessageSchema.safeParse(value);
      if (!parsedMessage.success) {
        fail(new Error("The database read worker sent an invalid message"));
        void worker.terminate();
        return;
      }
      const message = parsedMessage.data;
      if (message.kind === "ready") {
        state.clearReadyTimeout();
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
        if (message.result.droppedEntryCount > 0) {
          args.logger.warn(
            {
              droppedEntryCount: message.result.droppedEntryCount,
              requestId: message.id,
            },
            "Dropped an invalid thread entry from a database read worker result",
          );
        }
        resolveRead(read, message.result);
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

    readyTimeout = setTimeout(() => {
      const error = new DatabaseReadUnavailableError(
        "The database read worker did not start. Try again later.",
      );
      fail(error);
      void worker.terminate();
    }, workerStartupTimeoutMs);

    return state;
  }

  function startRecoveryWorker(): DatabaseReadWorkerState | null {
    try {
      const state = startWorker();
      void state.ready.catch(() => {});
      return state;
    } catch (error) {
      args.logger.warn(
        { err: error },
        "Database read worker replacement could not start",
      );
      return null;
    }
  }

  function replaceWorker(error: Error): void {
    if (activeWorker === null) {
      return;
    }
    const replacedWorker = activeWorker;
    replacedWorker.failed = true;
    replacedWorker.clearReadyTimeout();
    replacedWorker.rejectReady(error);
    activeWorker = startRecoveryWorker();
    void replacedWorker.worker.terminate();
  }

  async function requireReadyWorker(): Promise<DatabaseReadWorkerState> {
    if (closed) {
      throw new Error("The database read service stopped");
    }
    let state = activeWorker;
    if (state === null) {
      try {
        state = startWorker();
      } catch (error) {
        args.logger.warn(
          { err: error },
          "Database read worker could not start",
        );
        throw new DatabaseReadUnavailableError(
          "The database read worker could not start. Try again later.",
        );
      }
    }
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
  ): Promise<DatabaseReadWorkerResult> {
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
            rejectCallerWhileReadContinues(
              read,
              new DatabaseReadAbortedError(),
            );
            return;
          }
          rejectRead(read, new DatabaseReadAbortedError());
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
    workerState?.clearReadyTimeout();
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
          id,
          operation: "listThreadEntries",
          options,
        }),
        context,
      ).then((result) => {
        if (result.operation !== "listThreadEntries") {
          throw new Error(
            "The database read worker returned an invalid result",
          );
        }
        return applyLiveDaemonStateToEntries(args.hub, result.entries);
      });
    },
    listThreadEntriesForProjects(
      options: ListThreadsForProjectsOptions,
      context?: DatabaseReadRequestContext,
    ): Promise<ThreadListEntry[]> {
      return sendRequest(
        (id) => ({
          id,
          operation: "listThreadEntriesForProjects",
          options: {
            ...options,
            projectIds: [...options.projectIds],
          },
        }),
        context,
      ).then((result) => {
        if (result.operation !== "listThreadEntriesForProjects") {
          throw new Error(
            "The database read worker returned an invalid result",
          );
        }
        return applyLiveDaemonStateToEntries(args.hub, result.entries);
      });
    },
    listProjectsWithThreads(
      options: { includePersonal: boolean },
      context?: DatabaseReadRequestContext,
    ): Promise<ProjectWithThreadsResponse[]> {
      return sendRequest(
        (id) => ({
          id,
          operation: "listProjectsWithThreads",
          options,
        }),
        context,
      ).then((result) => {
        if (result.operation !== "listProjectsWithThreads") {
          throw new Error(
            "The database read worker returned an invalid result",
          );
        }
        return applyLiveDaemonStateToProjects(args.hub, result.projects);
      });
    },
    getSidebarBootstrap(
      context?: DatabaseReadRequestContext,
    ): Promise<SidebarBootstrapResponse> {
      return sendRequest(
        (id) => ({
          id,
          operation: "sidebarBootstrap",
        }),
        context,
      ).then((result) => {
        if (result.operation !== "sidebarBootstrap") {
          throw new Error(
            "The database read worker returned an invalid result",
          );
        }
        const projects = applyLiveDaemonStateToProjects(
          args.hub,
          result.response.projects,
        );
        return {
          ...result.response,
          projects,
          personalProject: applyLiveDaemonStateToProject(
            args.hub,
            result.response.personalProject,
          ),
        };
      });
    },
  };
}

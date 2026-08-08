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
import type { ServerLogger } from "../../types.js";
import type { NotificationHub } from "../../ws/hub.js";
import { toThreadListEntryResponses } from "../threads/thread-runtime-display.js";
import {
  databaseReadWorkerMessageSchema,
  type DatabaseReadWorkerData,
  type DatabaseReadWorkerRequest,
} from "./database-read-worker-contract.js";

interface PendingDatabaseRead {
  reject(error: Error): void;
  resolve(entries: ThreadListEntry[]): void;
}

interface DatabaseReadWorkerState {
  failed: boolean;
  ready: Promise<void>;
  rejectReady(error: Error): void;
  resolveReady(): void;
  wasReady: boolean;
  worker: Worker;
}

export interface DatabaseReadService {
  close(): Promise<void>;
  listThreadEntries(options: ListThreadsOptions): Promise<ThreadListEntry[]>;
  listThreadEntriesForProjects(
    options: ListThreadsForProjectsOptions,
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
  onWorkerCreated?: (worker: Worker) => void;
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

export async function createWorkerDatabaseReadService(
  args: CreateWorkerDatabaseReadServiceArgs,
): Promise<DatabaseReadService> {
  const workerData: DatabaseReadWorkerData = {
    databasePath: args.databasePath,
  };
  const sourceFile = import.meta.url.endsWith(".ts");
  const pending = new Map<number, PendingDatabaseRead>();
  const workers = new Set<Worker>();
  let activeWorker: DatabaseReadWorkerState | null = null;
  let closed = false;
  let nextRequestId = 0;

  function rejectPending(error: Error): void {
    for (const read of pending.values()) {
      read.reject(error);
    }
    pending.clear();
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
      state.rejectReady(error);
      rejectPending(error);
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
        state.resolveReady();
        return;
      }
      if (message.kind === "log") {
        args.logger.debug(message.fields, message.message);
        return;
      }

      const read = pending.get(message.id);
      if (read === undefined) {
        return;
      }
      pending.delete(message.id);
      if (message.kind === "error") {
        const error = new Error(message.error.message);
        error.stack = message.error.stack;
        read.reject(error);
        return;
      }
      read.resolve(message.entries);
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

  async function sendRequest(
    createRequest: (id: number) => DatabaseReadWorkerRequest,
  ): Promise<ThreadListEntry[]> {
    const state = await requireReadyWorker();
    const id = nextRequestId;
    nextRequestId += 1;
    return new Promise((resolve, reject) => {
      if (state.failed) {
        reject(new Error("The database read worker stopped"));
        return;
      }
      pending.set(id, { reject, resolve });
      try {
        state.worker.postMessage(createRequest(id));
      } catch (error) {
        pending.delete(id);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  async function close(): Promise<void> {
    if (closed) {
      return;
    }
    closed = true;
    activeWorker = null;
    rejectPending(new Error("The database read service stopped"));
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
    listThreadEntries(options: ListThreadsOptions): Promise<ThreadListEntry[]> {
      return sendRequest((id) => ({
        daemonSessions: args.hub.listDaemonSessions(),
        id,
        operation: "listThreadEntries",
        options,
      }));
    },
    listThreadEntriesForProjects(
      options: ListThreadsForProjectsOptions,
    ): Promise<ThreadListEntry[]> {
      return sendRequest((id) => ({
        daemonSessions: args.hub.listDaemonSessions(),
        id,
        operation: "listThreadEntriesForProjects",
        options: {
          ...options,
          projectIds: [...options.projectIds],
        },
      }));
    },
  };
}

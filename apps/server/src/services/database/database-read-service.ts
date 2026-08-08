import type { DbConnection, ListThreadsOptions } from "@bb/db";
import { listThreadsWithPendingInteractionState } from "@bb/db";
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

export interface DatabaseReadService {
  close(): Promise<void>;
  listThreadEntries(options: ListThreadsOptions): Promise<ThreadListEntry[]>;
}

interface CreateDirectDatabaseReadServiceArgs {
  db: DbConnection;
  hub: NotificationHub;
}

export function createDirectDatabaseReadService(
  args: CreateDirectDatabaseReadServiceArgs,
): DatabaseReadService {
  return {
    async close(): Promise<void> {},
    async listThreadEntries(
      options: ListThreadsOptions,
    ): Promise<ThreadListEntry[]> {
      const threads = listThreadsWithPendingInteractionState(args.db, options);
      return toThreadListEntryResponses(args, { threads });
    },
  };
}

interface CreateWorkerDatabaseReadServiceArgs {
  databasePath: string;
  hub: NotificationHub;
  logger: ServerLogger;
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

export function createWorkerDatabaseReadService(
  args: CreateWorkerDatabaseReadServiceArgs,
): DatabaseReadService {
  const workerData: DatabaseReadWorkerData = {
    databasePath: args.databasePath,
  };
  const sourceFile = import.meta.url.endsWith(".ts");
  const worker = new Worker(resolveWorkerEntryUrl(), {
    ...(sourceFile
      ? { execArgv: ["--conditions=source", "--import", "tsx"] }
      : {}),
    name: "bb-database-read-worker",
    workerData,
  });
  const pending = new Map<number, PendingDatabaseRead>();
  let closed = false;
  let failure: Error | null = null;
  let nextRequestId = 0;

  function rejectPending(error: Error): void {
    for (const read of pending.values()) {
      read.reject(error);
    }
    pending.clear();
  }

  function fail(error: Error): void {
    if (failure !== null || closed) {
      return;
    }
    failure = error;
    rejectPending(error);
  }

  worker.on("message", (value: unknown) => {
    const parsedMessage = databaseReadWorkerMessageSchema.safeParse(value);
    if (!parsedMessage.success) {
      fail(new Error("The database read worker sent an invalid message"));
      return;
    }
    const message = parsedMessage.data;
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
    fail(new Error(`The database read worker stopped with exit code ${code}`));
  });

  return {
    async close(): Promise<void> {
      if (closed) {
        return;
      }
      closed = true;
      rejectPending(new Error("The database read service stopped"));
      await worker.terminate();
    },
    listThreadEntries(options: ListThreadsOptions): Promise<ThreadListEntry[]> {
      if (closed) {
        return Promise.reject(new Error("The database read service stopped"));
      }
      if (failure !== null) {
        return Promise.reject(failure);
      }
      const id = nextRequestId;
      nextRequestId += 1;
      const request: DatabaseReadWorkerRequest = {
        daemonSessions: args.hub.listDaemonSessions(),
        id,
        operation: "listThreadEntries",
        options,
      };
      return new Promise((resolve, reject) => {
        pending.set(id, { reject, resolve });
        try {
          worker.postMessage(request);
        } catch (error) {
          pending.delete(id);
          reject(error instanceof Error ? error : new Error(String(error)));
        }
      });
    },
  };
}

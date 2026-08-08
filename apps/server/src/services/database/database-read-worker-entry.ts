import {
  createReadOnlyConnection,
  listThreadsWithPendingInteractionState,
  listThreadsWithPendingInteractionStateForProjects,
  type SlowDbQueryLogger,
} from "@bb/db";
import { parentPort, workerData } from "node:worker_threads";
import { toThreadListEntryResponses } from "../threads/thread-runtime-display.js";
import { threadListEntrySchema, type ThreadListEntry } from "@bb/domain";
import {
  databaseReadWorkerDataSchema,
  databaseReadWorkerRequestIdSchema,
  databaseReadWorkerRequestSchema,
  type DatabaseReadWorkerMessage,
} from "./database-read-worker-contract.js";

if (parentPort === null) {
  throw new Error("The database read worker requires a parent port");
}

const port = parentPort;
const config = databaseReadWorkerDataSchema.parse(workerData);
const slowQueryLogger: SlowDbQueryLogger = {
  debug(fields, message): void {
    port.postMessage({
      fields,
      kind: "log",
      message,
    } satisfies DatabaseReadWorkerMessage);
  },
};
const db = createReadOnlyConnection(config.databasePath, {
  slowQueryLogger,
});

function serializeError(error: unknown): { message: string; stack?: string } {
  if (error instanceof Error) {
    return {
      message: error.message,
      ...(error.stack === undefined ? {} : { stack: error.stack }),
    };
  }
  return { message: String(error) };
}

function isThreadListEntry(value: unknown): value is ThreadListEntry {
  return threadListEntrySchema.safeParse(value).success;
}

port.on("message", (value: unknown) => {
  const requestIdResult = databaseReadWorkerRequestIdSchema.safeParse(value);
  if (!requestIdResult.success) {
    throw new Error("The database read worker received an invalid request ID");
  }
  const requestId = requestIdResult.data.id;
  try {
    const request = databaseReadWorkerRequestSchema.parse(value);
    const threads =
      request.operation === "listThreadEntries"
        ? listThreadsWithPendingInteractionState(db, request.options)
        : listThreadsWithPendingInteractionStateForProjects(
            db,
            request.options,
          );
    const daemonSessionIdByHostId = new Map(
      request.daemonSessions.map((session) => [
        session.hostId,
        session.sessionId,
      ]),
    );
    const rawEntries = toThreadListEntryResponses(
      {
        db,
        hub: {
          getDaemonSessionIdForHost(hostId): string | null {
            return daemonSessionIdByHostId.get(hostId) ?? null;
          },
        },
      },
      { threads },
    );
    const entries = rawEntries.filter(isThreadListEntry);
    port.postMessage({
      droppedEntryCount: rawEntries.length - entries.length,
      entries,
      id: request.id,
      kind: "result",
    } satisfies DatabaseReadWorkerMessage);
  } catch (error) {
    port.postMessage({
      error: serializeError(error),
      id: requestId,
      kind: "error",
    } satisfies DatabaseReadWorkerMessage);
  }
});

port.postMessage({ kind: "ready" } satisfies DatabaseReadWorkerMessage);

import {
  createReadOnlyConnection,
  listThreadsWithPendingInteractionState,
  type SlowDbQueryLogger,
} from "@bb/db";
import { parentPort, workerData } from "node:worker_threads";
import { toThreadListEntryResponses } from "../threads/thread-runtime-display.js";
import {
  databaseReadWorkerDataSchema,
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

port.on("message", (value: unknown) => {
  let request;
  try {
    request = databaseReadWorkerRequestSchema.parse(value);
    const threads = listThreadsWithPendingInteractionState(db, request.options);
    const daemonSessionIdByHostId = new Map(
      request.daemonSessions.map((session) => [
        session.hostId,
        session.sessionId,
      ]),
    );
    const entries = toThreadListEntryResponses(
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
    port.postMessage({
      entries,
      id: request.id,
      kind: "result",
    } satisfies DatabaseReadWorkerMessage);
  } catch (error) {
    const requestId = request?.id;
    if (requestId === undefined) {
      throw error;
    }
    port.postMessage({
      error: serializeError(error),
      id: requestId,
      kind: "error",
    } satisfies DatabaseReadWorkerMessage);
  }
});

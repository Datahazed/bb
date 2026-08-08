import { createReadOnlyConnection, type SlowDbQueryLogger } from "@bb/db";
import { parentPort, workerData } from "node:worker_threads";
import {
  databaseReadWorkerDataSchema,
  databaseReadWorkerRequestIdSchema,
  databaseReadWorkerRequestSchema,
  type DatabaseReadWorkerMessage,
} from "./database-read-worker-contract.js";
import { executeDatabaseReadOperation } from "./database-read-operations.js";

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
  slowQueryThresholdMs: config.slowQueryThresholdMs,
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
  const requestIdResult = databaseReadWorkerRequestIdSchema.safeParse(value);
  if (!requestIdResult.success) {
    throw new Error("The database read worker received an invalid request ID");
  }
  const requestId = requestIdResult.data.id;
  try {
    const request = databaseReadWorkerRequestSchema.parse(value);
    const result = executeDatabaseReadOperation({ db }, request);
    port.postMessage({
      id: request.id,
      kind: "result",
      result,
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

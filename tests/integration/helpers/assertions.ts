import fs from "node:fs/promises";
import type {
  Environment,
  EnvironmentStatus,
  Host,
  Thread,
  ThreadEventRow,
  ThreadStatus,
} from "@bb/domain";
import { createPublicApiClient } from "@bb/server-contract";
import type {
  DispatchedEngineCommand,
  RecordingEngineCommandDispatcher,
} from "./engine-commands.js";
import {
  describeThreadEvent,
  previewThreadText,
  stringifyThreadEventData,
} from "./thread-diagnostics.js";

const POLL_INTERVAL_MS = 100;

type PublicApiClient = ReturnType<typeof createPublicApiClient>;

interface ThreadStatusFailureContext {
  currentStatus: ThreadStatus | "unknown";
  expectedStatus: ThreadStatus;
  threadId: string;
}

async function pollUntil<T>(
  check: () => Promise<T | null>,
  expectation: string,
  timeoutMs: number,
  getCurrentState: () => string,
): Promise<T> {
  const startedAt = Date.now();

  while (Date.now() - startedAt <= timeoutMs) {
    const value = await check();
    if (value) {
      return value;
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }

  throw new Error(`${expectation}. Current state: ${getCurrentState()}`);
}

async function readThread(
  api: PublicApiClient,
  threadId: string,
): Promise<Thread> {
  const response = await api.threads[":id"].$get({
    param: { id: threadId },
  });
  if (response.status !== 200) {
    throw new Error(
      `Expected thread ${threadId} to exist, got ${response.status}`,
    );
  }
  return response.json();
}

async function readThreadEvents(
  api: PublicApiClient,
  threadId: string,
): Promise<ThreadEventRow[]> {
  const response = await api.threads[":id"].events.$get({
    param: { id: threadId },
    query: { limit: "10000" },
  });
  if (response.status !== 200) {
    throw new Error(
      `Expected thread events for ${threadId}, got ${response.status}`,
    );
  }
  return response.json();
}

async function readThreadOutput(
  api: PublicApiClient,
  threadId: string,
): Promise<string | null> {
  const response = await api.threads[":id"].output.$get({
    param: { id: threadId },
  });
  if (response.status !== 200) {
    throw new Error(
      `Expected thread output for ${threadId}, got ${response.status}`,
    );
  }
  const payload = await response.json();
  return payload.output;
}

async function readEnvironment(
  api: PublicApiClient,
  environmentId: string,
): Promise<Environment> {
  const response = await api.environments[":id"].$get({
    param: { id: environmentId },
  });
  if (response.status !== 200) {
    throw new Error(
      `Expected environment ${environmentId} to exist, got ${response.status}`,
    );
  }
  return response.json();
}

async function buildThreadStatusFailureMessage(
  api: PublicApiClient,
  context: ThreadStatusFailureContext,
): Promise<string> {
  const [events, output] = await Promise.all([
    readThreadEvents(api, context.threadId),
    readThreadOutput(api, context.threadId).catch(() => null),
  ]);
  const recentEvents = events.slice(-12).map(describeThreadEvent).join(" | ");
  const lastError = [...events]
    .reverse()
    .find(
      (event) =>
        event.type === "provider/error" || event.type === "system/error",
    );
  const lastTurnStarted = [...events]
    .reverse()
    .find((event) => event.type === "turn/started");
  const lastTurnCompleted = [...events]
    .reverse()
    .find((event) => event.type === "turn/completed");

  return [
    `Thread ${context.threadId} entered ${context.currentStatus} while waiting for ${context.expectedStatus}`,
    `events=${events.length}`,
    `recentEvents=[${recentEvents || "none"}]`,
    `lastError=${stringifyThreadEventData(lastError)}`,
    `lastTurnStarted=${stringifyThreadEventData(lastTurnStarted)}`,
    `lastTurnCompleted=${stringifyThreadEventData(lastTurnCompleted)}`,
    `outputPreview=${JSON.stringify(previewThreadText(output))}`,
  ].join("; ");
}

export async function waitForThreadStatus(
  api: PublicApiClient,
  threadId: string,
  status: ThreadStatus,
  timeoutMs = 10_000,
): Promise<Thread> {
  let currentStatus: ThreadStatus | "unknown" = "unknown";
  try {
    return await pollUntil(
      async () => {
        const thread = await readThread(api, threadId);
        currentStatus = thread.status;
        if (thread.status === "error" && status !== "error") {
          throw new Error(
            await buildThreadStatusFailureMessage(api, {
              currentStatus: thread.status,
              expectedStatus: status,
              threadId,
            }),
          );
        }
        if (
          thread.status === status &&
          (status !== "idle" || thread.stopRequestedAt === null)
        ) {
          return thread;
        }
        return null;
      },
      `Timed out waiting for thread ${threadId} to reach status ${status}`,
      timeoutMs,
      () => currentStatus,
    );
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.startsWith(`Timed out waiting for thread ${threadId}`)
    ) {
      throw new Error(
        await buildThreadStatusFailureMessage(api, {
          currentStatus,
          expectedStatus: status,
          threadId,
        }),
      );
    }
    throw error;
  }
}

export async function waitForThreadOutputContaining(
  api: PublicApiClient,
  threadId: string,
  expectedText: string,
  timeoutMs = 10_000,
): Promise<string> {
  let currentOutput = "";
  return pollUntil(
    async () => {
      const output = await readThreadOutput(api, threadId);
      currentOutput = previewThreadText(output);
      return output?.includes(expectedText) ? output : null;
    },
    `Timed out waiting for thread ${threadId} output to contain ${JSON.stringify(expectedText)}`,
    timeoutMs,
    () => JSON.stringify(currentOutput),
  );
}

export async function waitForEvents(
  api: PublicApiClient,
  threadId: string,
  minCount: number,
  timeoutMs = 10_000,
): Promise<ThreadEventRow[]> {
  let currentCount = 0;
  return pollUntil(
    async () => {
      const events = await readThreadEvents(api, threadId);
      currentCount = events.length;
      return events.length >= minCount ? events : null;
    },
    `Timed out waiting for ${minCount} events on thread ${threadId}`,
    timeoutMs,
    () => `${currentCount} events`,
  );
}

export async function waitForEventType(
  api: PublicApiClient,
  threadId: string,
  eventType: string,
  timeoutMs = 10_000,
): Promise<ThreadEventRow> {
  let lastTypes = "none";
  return pollUntil(
    async () => {
      const events = await readThreadEvents(api, threadId);
      lastTypes = events.map((event) => event.type).join(", ") || "none";
      return events.find((event) => event.type === eventType) ?? null;
    },
    `Timed out waiting for event ${eventType} on thread ${threadId}`,
    timeoutMs,
    () => lastTypes,
  );
}

export async function waitForHostConnected(
  api: PublicApiClient,
  timeoutMs = 10_000,
): Promise<Host> {
  let currentHosts = "none";
  return pollUntil(
    async () => {
      const response = await api.hosts.$get({});
      if (response.status !== 200) {
        throw new Error(`Expected hosts list, got ${response.status}`);
      }
      const hosts: Host[] = await response.json();
      currentHosts =
        hosts.map((host) => `${host.id}:${host.status}`).join(", ") || "none";
      return hosts.find((host) => host.status === "connected") ?? null;
    },
    "Timed out waiting for a connected host",
    timeoutMs,
    () => currentHosts,
  );
}

export async function waitForEnvironmentStatus(
  api: PublicApiClient,
  environmentId: string,
  status: EnvironmentStatus,
  timeoutMs = 10_000,
): Promise<Environment> {
  let currentStatus = "unknown";
  return pollUntil(
    async () => {
      const environment = await readEnvironment(api, environmentId);
      currentStatus = environment.status;
      return environment.status === status ? environment : null;
    },
    `Timed out waiting for environment ${environmentId} to reach ${status}`,
    timeoutMs,
    () => currentStatus,
  );
}

export async function waitForPathRemoval(
  pathToCheck: string,
  timeoutMs = 10_000,
): Promise<void> {
  await pollUntil(
    async () => {
      try {
        await fs.access(pathToCheck);
        return null;
      } catch {
        return true;
      }
    },
    `Timed out waiting for ${pathToCheck} to be removed`,
    timeoutMs,
    () => "path still exists",
  );
}

export async function waitForDispatchedCommand(
  dispatcher: RecordingEngineCommandDispatcher,
  predicate: (entry: DispatchedEngineCommand) => boolean,
  timeoutMs = 10_000,
): Promise<DispatchedEngineCommand> {
  let currentCommands = "none";
  return pollUntil(
    async () => {
      currentCommands =
        dispatcher.dispatched.map((entry) => entry.command.type).join(", ") ||
        "none";
      return dispatcher.dispatched.find(predicate) ?? null;
    },
    "Timed out waiting for a matching engine command dispatch",
    timeoutMs,
    () => currentCommands,
  );
}

export async function waitForDispatchedCommandsSettled(
  dispatcher: RecordingEngineCommandDispatcher,
  timeoutMs = 10_000,
): Promise<void> {
  let inFlight: DispatchedEngineCommand[] = [];
  await pollUntil(
    async () => {
      inFlight = dispatcher.dispatched.filter((entry) =>
        dispatcher.isCommandInFlight(entry.commandId),
      );
      return inFlight.length === 0 ? true : null;
    },
    "Timed out waiting for dispatched engine commands to settle",
    timeoutMs,
    () =>
      `${inFlight.length} in flight: ${inFlight
        .map((entry) => entry.command.type)
        .join(", ")}`,
  );
}

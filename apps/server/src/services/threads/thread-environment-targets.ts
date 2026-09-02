import {
  getThread,
  getThreadPendingStartContext,
  setThreadPendingStartContext,
  updateThread,
} from "@bb/db";
import {
  QUEUED_MESSAGE_WAIT_REASON_MAX_LENGTH,
  type ProvisioningTranscriptEntry,
  type Thread,
  type ThreadQueuedMessage,
} from "@bb/domain";
import { environmentArgsSchema } from "@bb/server-contract";
import { z } from "zod";
import { ApiError } from "../../errors.js";
import type { LoggedPendingInteractionWorkSessionDeps } from "../../types.js";
import { requirePublicProject } from "../lib/entity-lookup.js";
import { NotificationBuffer } from "../lib/notification-buffer.js";
import { pluginEnvironmentTargetProvider } from "../plugins/plugin-environment-target-registry.js";
import {
  pendingThreadStartContextSchema,
  type PendingThreadStartContext,
} from "./dispatch-attempt.js";
import { resolveThreadEnvironmentPlacement } from "./thread-environment-placement.js";
import { toThreadResponseFromThread } from "./thread-runtime-display.js";

type TargetDeps = LoggedPendingInteractionWorkSessionDeps;

/**
 * How long an unanswerable ask waits before the due sweep re-poses it: the
 * target's plugin is not running, or no longer offers the target. Nothing
 * releases these waits eagerly — the plugin registering again answers the
 * next attempt — so the row polls on this backoff instead of spinning.
 */
const TARGET_UNAVAILABLE_RETRY_MS = 30_000;

const provisionDecisionSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("ready"),
    environment: environmentArgsSchema,
    log: z.string().optional(),
  }),
  z.object({
    action: z.literal("wait"),
    reason: z.string().min(1).max(QUEUED_MESSAGE_WAIT_REASON_MAX_LENGTH),
    sendAt: z.number().int().nonnegative().nullable().optional(),
    log: z.string().optional(),
  }),
  z.object({ action: z.literal("reject"), message: z.string().min(1) }),
]);

const LAUNCH_LOG_MAX_ENTRIES = 120;
const LAUNCH_LOG_MAX_TEXT = 24_576;
const LAUNCH_LOG_CHUNK_MAX_TEXT = 16_384;

function launchLogSize(entries: readonly ProvisioningTranscriptEntry[]): number {
  return entries.reduce((total, entry) => total + entry.text.length, 0);
}

/**
 * The launch log a target writes while it provisions, capped so a chatty
 * launch cannot bloat the pending start context: oldest output lines fall
 * away first, steps last, because the step sequence is the story and the
 * output is its detail.
 */
function appendLaunchEntries(
  existing: readonly ProvisioningTranscriptEntry[],
  additions: readonly ProvisioningTranscriptEntry[],
): ProvisioningTranscriptEntry[] {
  const merged = [...existing, ...additions];
  while (
    merged.length > LAUNCH_LOG_MAX_ENTRIES ||
    launchLogSize(merged) > LAUNCH_LOG_MAX_TEXT
  ) {
    const oldestOutput = merged.findIndex((entry) => entry.type === "output");
    merged.splice(oldestOutput === -1 ? 0 : oldestOutput, 1);
  }
  return merged;
}

function launchAdditionsForDecision(args: {
  existing: readonly ProvisioningTranscriptEntry[];
  reason: string | null;
  log: string | undefined;
}): ProvisioningTranscriptEntry[] {
  const additions: ProvisioningTranscriptEntry[] = [];
  const lastStep = [...args.existing]
    .reverse()
    .find((entry) => entry.type === "step");
  if (args.reason !== null && lastStep?.text !== args.reason) {
    additions.push({
      type: "step",
      key: `launch-step-${args.existing.length + additions.length}`,
      text: args.reason,
      status: "completed",
      startedAt: Date.now(),
    });
  }
  if (args.log !== undefined && args.log.length > 0) {
    additions.push({
      type: "output",
      key: `launch-output-${args.existing.length + additions.length}`,
      text: args.log.slice(-LAUNCH_LOG_CHUNK_MAX_TEXT),
    });
  }
  return additions;
}

function persistLaunchLog(
  deps: TargetDeps,
  args: { threadId: string; launchLog: ProvisioningTranscriptEntry[] },
): void {
  deps.db.transaction(
    (tx) => {
      const stored = getThreadPendingStartContext(tx, args.threadId);
      if (stored === null) {
        return;
      }
      const storedContext = pendingThreadStartContextSchema.parse(
        JSON.parse(stored),
      );
      if (storedContext.environmentIntent.type !== "plugin-target") {
        return;
      }
      setThreadPendingStartContext(tx, {
        threadId: args.threadId,
        pendingStartContext: JSON.stringify({
          ...storedContext,
          launchLog: args.launchLog,
        }),
      });
    },
    { behavior: "immediate" },
  );
}

export type PluginTargetDispatchResolution =
  | {
      kind: "resolved";
      thread: Thread;
      startContext: PendingThreadStartContext;
    }
  | { kind: "wait"; pluginId: string; reason: string; sendAt: number | null };

function targetFailure(
  pluginId: string,
  targetId: string,
  detail: string,
): ApiError {
  return new ApiError(
    502,
    "environment_target_failed",
    `The "${pluginId}" plugin's "${targetId}" environment target failed: ${detail}`,
    { details: { pluginId } },
  );
}

function unavailableWait(intent: {
  pluginId: string;
  targetId: string;
}): PluginTargetDispatchResolution {
  return {
    kind: "wait",
    pluginId: intent.pluginId,
    reason: `Waiting for the "${intent.pluginId}" plugin, which offers this thread's "${intent.targetId}" environment and is not available`,
    sendAt: Date.now() + TARGET_UNAVAILABLE_RETRY_MS,
  };
}

interface ResolvePluginTargetEnvironmentArgs {
  thread: Thread;
  startContext: PendingThreadStartContext;
  queuedMessage: ThreadQueuedMessage | null;
}

/**
 * Asks the target the thread's start intent names where the thread should
 * run, and on `ready` rewrites the intent — the one moment a `plugin-target`
 * intent becomes an ordinary one. The write is transactional against the
 * stored context still being a `plugin-target`: two attempts may ask
 * concurrently (provision is idempotent by contract), but only one rewrite
 * lands, and the loser re-reads what the winner wrote.
 */
export async function resolvePluginTargetEnvironment(
  deps: TargetDeps,
  args: ResolvePluginTargetEnvironmentArgs,
): Promise<PluginTargetDispatchResolution> {
  const intent = args.startContext.environmentIntent;
  if (intent.type !== "plugin-target") {
    return { kind: "resolved", thread: args.thread, startContext: args.startContext };
  }
  const provider = pluginEnvironmentTargetProvider();
  const record = provider?.getEnvironmentTarget(intent.pluginId, intent.targetId);
  if (provider === undefined || record === undefined) {
    return unavailableWait(intent);
  }

  const context = {
    thread: toThreadResponseFromThread(deps, { thread: args.thread }),
    project: requirePublicProject(deps.db, args.thread.projectId),
    configuration: intent.configuration,
    queuedMessage: args.queuedMessage,
  };
  const invocation = await provider.invokeTarget(
    intent.pluginId,
    `"${intent.targetId}" environment target`,
    async () => {
      let timer: NodeJS.Timeout | undefined;
      try {
        return await Promise.race([
          Promise.resolve(record.target.provision(context)).then(
            (value) => ({ ok: true, value }) as const,
            (error: unknown) =>
              ({
                ok: false,
                error: error instanceof Error ? error.message : String(error),
              }) as const,
          ),
          new Promise<{ ok: false; error: string }>((resolveTimeout) => {
            timer = setTimeout(
              () =>
                resolveTimeout({
                  ok: false,
                  error: `did not decide within ${provider.decisionTimeoutMs}ms`,
                }),
              provider.decisionTimeoutMs,
            );
            timer.unref?.();
          }),
        ]);
      } finally {
        if (timer !== undefined) clearTimeout(timer);
      }
    },
  );
  if (!invocation.ok) {
    throw targetFailure(intent.pluginId, intent.targetId, invocation.error);
  }
  if (!invocation.value.ok) {
    throw targetFailure(intent.pluginId, intent.targetId, invocation.value.error);
  }
  const parsed = provisionDecisionSchema.safeParse(invocation.value.value);
  if (!parsed.success) {
    throw targetFailure(
      intent.pluginId,
      intent.targetId,
      `returned an invalid decision: ${parsed.error.issues
        .map((issue) => `${issue.path.join(".")} ${issue.message}`)
        .join("; ")}`,
    );
  }
  const decision = parsed.data;
  if (decision.action === "reject") {
    throw new ApiError(409, "dispatch_rejected", decision.message, {
      details: { pluginId: intent.pluginId },
    });
  }
  if (decision.action === "wait") {
    const additions = launchAdditionsForDecision({
      existing: args.startContext.launchLog,
      reason: decision.reason,
      log: decision.log,
    });
    if (additions.length > 0) {
      persistLaunchLog(deps, {
        threadId: args.thread.id,
        launchLog: appendLaunchEntries(args.startContext.launchLog, additions),
      });
    }
    return {
      kind: "wait",
      pluginId: intent.pluginId,
      reason: decision.reason,
      sendAt: decision.sendAt ?? null,
    };
  }

  const placement = await resolveThreadEnvironmentPlacement(deps, {
    projectId: args.thread.projectId,
    requestedEnvironment: decision.environment,
  });
  const nextContext: PendingThreadStartContext = {
    ...args.startContext,
    environmentIntent: placement.environmentIntent,
    launchLog: appendLaunchEntries(
      args.startContext.launchLog,
      launchAdditionsForDecision({
        existing: args.startContext.launchLog,
        reason: null,
        log: decision.log,
      }),
    ),
  };
  const buffer = new NotificationBuffer();
  const applied = deps.db.transaction(
    (tx) => {
      const stored = getThreadPendingStartContext(tx, args.thread.id);
      if (stored === null) {
        return false;
      }
      const storedContext = pendingThreadStartContextSchema.parse(
        JSON.parse(stored),
      );
      if (storedContext.environmentIntent.type !== "plugin-target") {
        return false;
      }
      setThreadPendingStartContext(tx, {
        threadId: args.thread.id,
        pendingStartContext: JSON.stringify(nextContext),
      });
      if (placement.environmentId !== null) {
        updateThread(tx, buffer, args.thread.id, {
          environmentId: placement.environmentId,
        });
      }
      return true;
    },
    { behavior: "immediate" },
  );
  buffer.flushInto(deps.hub);

  const currentThread = getThread(deps.db, args.thread.id);
  if (currentThread === null) {
    throw new ApiError(404, "thread_not_found", "Thread not found");
  }
  if (applied) {
    return { kind: "resolved", thread: currentThread, startContext: nextContext };
  }
  const stored = getThreadPendingStartContext(deps.db, args.thread.id);
  const storedContext =
    stored === null
      ? null
      : pendingThreadStartContextSchema.parse(JSON.parse(stored));
  return {
    kind: "resolved",
    thread: currentThread,
    startContext: storedContext ?? nextContext,
  };
}

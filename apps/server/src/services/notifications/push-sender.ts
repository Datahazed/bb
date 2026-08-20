import {
  deletePushSubscriptionByToken,
  getActivePendingInteractionForThread,
  getThread,
  listPushSubscriptions,
  type DbConnection,
} from "@bb/db";
import type {
  ChangedMessage,
  PendingInteraction,
  PushNotificationData,
  PushNotificationKind,
  PushSubscription,
} from "@bb/domain";
import { z } from "zod";
import type { ServerLogger } from "../../types.js";
import type { NotificationHub } from "../../ws/hub.js";
import { toPendingInteraction } from "../interactions/pending-interaction-serialization.js";
import {
  getLastThreadErrorMessage,
  getLastThreadOutput,
} from "../threads/thread-data.js";

type ThreadRow = NonNullable<ReturnType<typeof getThread>>;

/** Expo accepts at most 100 messages per request. */
const EXPO_PUSH_BATCH_SIZE = 100;
/** Burst window per thread: later triggers merge into one push, and two pushes for one thread are never closer than this. */
const DEFAULT_COALESCE_MS = 2_000;
const PUSH_TITLE_MAX_LENGTH = 80;
const PUSH_BODY_MAX_LENGTH = 180;
const ATTENTION_MEMORY_LIMIT = 10_000;
/** Most actionable first: one push per flush carries the top kind. */
const PUSH_KIND_PRIORITY: readonly PushNotificationKind[] = [
  "pending-interaction",
  "thread-error",
  "turn-finished",
];

/**
 * Expo Push API ticket response. Tickets line up with the request messages;
 * a `DeviceNotRegistered` ticket means the token is dead and must be dropped.
 */
const expoPushTicketSchema = z.union([
  z.object({ status: z.literal("ok"), id: z.string().optional() }),
  z.object({
    status: z.literal("error"),
    message: z.string().optional(),
    details: z
      .object({ error: z.string().optional() })
      .passthrough()
      .optional(),
  }),
]);
const expoPushResponseSchema = z.object({
  data: z.array(expoPushTicketSchema).optional(),
  errors: z
    .array(
      z.object({ code: z.string().optional(), message: z.string().optional() }),
    )
    .optional(),
});

export interface ExpoPushMessage {
  to: string;
  title: string;
  body: string;
  data: PushNotificationData;
  sound: "default";
  channelId: "default";
  priority: "high";
}

export type PushSenderFetch = (
  url: string,
  init: { method: "POST"; headers: Record<string, string>; body: string },
) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>;

export interface CreatePushSenderArgs {
  db: DbConnection;
  hub: Pick<NotificationHub, "onChangedMessage">;
  logger: ServerLogger;
  /** `BB_PUSH_NOTIFICATIONS`: when false the sender never subscribes. */
  enabled: boolean;
  /** `BB_EXPO_PUSH_URL`. */
  expoPushUrl: string;
  fetch?: PushSenderFetch;
  coalesceMs?: number;
  now?: () => number;
}

export interface PushSender {
  start(): void;
  stop(): void;
  /** Test hook: wait for every in-flight Expo request to settle. */
  settle(): Promise<void>;
}

interface PendingThreadPush {
  kinds: Set<PushNotificationKind>;
  /** When the newest trigger landed; a read after it cancels the push. */
  eventAt: number;
  timer: ReturnType<typeof setTimeout>;
}

function firstLine(text: string): string {
  for (const line of text.split(/\r?\n/u)) {
    const trimmed = line.trim();
    if (trimmed.length > 0) {
      return trimmed;
    }
  }
  return "";
}

function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, maxLength - 1).trimEnd()}…`;
}

function threadDisplayTitle(thread: ThreadRow): string {
  const title = thread.title?.trim();
  if (title) {
    return title;
  }
  const fallback = thread.titleFallback?.trim();
  if (fallback) {
    return fallback;
  }
  return `Thread ${thread.id.slice(0, 8)}`;
}

function isThreadRead(thread: ThreadRow): boolean {
  return (thread.lastReadAt ?? 0) >= thread.latestAttentionAt;
}

function describePendingInteraction(interaction: PendingInteraction): string {
  const payload = interaction.payload;
  switch (payload.kind) {
    case "user_question": {
      const prompt = firstLine(payload.questions[0]?.prompt ?? "");
      return prompt.length > 0 ? prompt : "The agent has a question for you";
    }
    case "approval": {
      const subject = payload.subject;
      switch (subject.kind) {
        case "command":
          return `Approve command: ${firstLine(subject.command)}`;
        case "file_change":
          return "Approve file changes";
        case "permission_grant":
          return subject.toolName
            ? `Grant permissions to ${subject.toolName}`
            : "Grant additional permissions";
        case "plan":
          return "Review the plan before the agent continues";
      }
      break;
    }
    case "plugin":
      return payload.title;
  }
  return "Waiting for your input";
}

function pickKind(
  kinds: ReadonlySet<PushNotificationKind>,
): PushNotificationKind | null {
  for (const kind of PUSH_KIND_PRIORITY) {
    if (kinds.has(kind)) {
      return kind;
    }
  }
  return null;
}

function chunk<T>(items: readonly T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

/**
 * Fans push-worthy thread changes out to every registered mobile device.
 *
 * Triggers (from the hub's change stream): a new pending interaction
 * (`interactions-changed` with `hasPendingInteraction`), a root thread's
 * turn finishing or a run failing (any change that advanced
 * `latestAttentionAt`). Triggers coalesce per thread for `coalesceMs`; at
 * flush the thread is re-read and the push is dropped when a client already
 * read it, the interaction was answered, the agent is working again, or the
 * thread was archived/deleted.
 */
export function createPushSender(args: CreatePushSenderArgs): PushSender {
  const {
    db,
    hub,
    logger,
    enabled,
    expoPushUrl,
    coalesceMs = DEFAULT_COALESCE_MS,
    now = () => Date.now(),
  } = args;
  const fetchImpl: PushSenderFetch =
    args.fetch ?? ((url, init) => globalThis.fetch(url, init));
  const pending = new Map<string, PendingThreadPush>();
  /** Last `latestAttentionAt` seen per thread, to spot a fresh bump. */
  const seenAttentionAt = new Map<string, number>();
  const inFlight = new Set<Promise<void>>();
  let startedAt = 0;
  let unsubscribe: (() => void) | null = null;

  function rememberAttention(threadId: string, attentionAt: number): void {
    seenAttentionAt.delete(threadId);
    seenAttentionAt.set(threadId, attentionAt);
    if (seenAttentionAt.size > ATTENTION_MEMORY_LIMIT) {
      const oldest = seenAttentionAt.keys().next().value;
      if (oldest !== undefined) {
        seenAttentionAt.delete(oldest);
      }
    }
  }

  function cancel(threadId: string): void {
    const entry = pending.get(threadId);
    if (!entry) {
      return;
    }
    clearTimeout(entry.timer);
    pending.delete(threadId);
  }

  function schedule(
    threadId: string,
    kind: PushNotificationKind,
    eventAt: number,
  ): void {
    const existing = pending.get(threadId);
    if (existing) {
      existing.kinds.add(kind);
      existing.eventAt = Math.max(existing.eventAt, eventAt);
      return;
    }
    // Every flush waits out the window, so two pushes for one thread are
    // always at least `coalesceMs` apart.
    const timer = setTimeout(() => {
      const entry = pending.get(threadId);
      pending.delete(threadId);
      if (!entry) {
        return;
      }
      const flush = flushThread(threadId, entry).catch((error: unknown) => {
        logger.error(
          { err: error, threadId },
          "Push notification flush failed",
        );
      });
      inFlight.add(flush);
      void flush.finally(() => {
        inFlight.delete(flush);
      });
    }, coalesceMs);
    timer.unref?.();
    pending.set(threadId, { kinds: new Set([kind]), eventAt, timer });
  }

  function onThreadAttentionChange(threadId: string): void {
    const thread = getThread(db, threadId);
    if (!thread) {
      cancel(threadId);
      return;
    }
    // First sighting: attention older than this sender (or as old as the
    // thread itself, which is born read) is history, not a trigger.
    const previous =
      seenAttentionAt.get(threadId) ??
      Math.max(thread.createdAt, startedAt - 1);
    rememberAttention(threadId, thread.latestAttentionAt);
    if (isThreadRead(thread)) {
      const entry = pending.get(threadId);
      if (entry && (thread.lastReadAt ?? 0) >= entry.eventAt) {
        cancel(threadId);
      }
      return;
    }
    if (thread.latestAttentionAt <= previous) {
      return;
    }
    schedule(
      threadId,
      thread.status === "error" ? "thread-error" : "turn-finished",
      thread.latestAttentionAt,
    );
  }

  function onChangedMessage(message: ChangedMessage): void {
    if (message.entity !== "thread" || message.id === undefined) {
      return;
    }
    const threadId = message.id;
    if (message.changes.includes("thread-deleted")) {
      cancel(threadId);
      return;
    }
    if (
      message.changes.includes("interactions-changed") &&
      message.metadata?.hasPendingInteraction === true
    ) {
      schedule(threadId, "pending-interaction", now());
    }
    if (
      message.changes.includes("status-changed") ||
      message.changes.includes("read-state-changed")
    ) {
      onThreadAttentionChange(threadId);
    }
  }

  function resolveKind(
    thread: ThreadRow,
    entry: PendingThreadPush,
  ): { kind: PushNotificationKind; body: string } | null {
    const kinds = new Set(entry.kinds);
    let interaction: PendingInteraction | null = null;
    if (kinds.has("pending-interaction")) {
      const row = getActivePendingInteractionForThread(db, thread.id);
      if (row && row.status === "pending") {
        try {
          interaction = toPendingInteraction(row);
        } catch (error) {
          logger.warn(
            { err: error, threadId: thread.id, interactionId: row.id },
            "Push notification could not decode the pending interaction",
          );
          interaction = null;
        }
      }
      if (!interaction) {
        kinds.delete("pending-interaction");
      }
    }
    if (isThreadRead(thread) && (thread.lastReadAt ?? 0) >= entry.eventAt) {
      // A client showed the thread after the trigger: nothing to announce.
      kinds.delete("turn-finished");
      kinds.delete("thread-error");
    }
    if (kinds.has("turn-finished") && thread.status !== "idle") {
      kinds.delete("turn-finished");
    }
    if (kinds.has("thread-error") && thread.status !== "error") {
      kinds.delete("thread-error");
    }
    const kind = pickKind(kinds);
    if (kind === null) {
      return null;
    }
    switch (kind) {
      case "pending-interaction":
        return {
          kind,
          body: interaction
            ? describePendingInteraction(interaction)
            : "Waiting for your input",
        };
      case "thread-error": {
        const message = getLastThreadErrorMessage(db, thread.id);
        return {
          kind,
          body: message
            ? firstLine(message) || "The thread hit an error"
            : "The thread hit an error",
        };
      }
      case "turn-finished": {
        const output = getLastThreadOutput(db, thread.id);
        return {
          kind,
          body: output
            ? firstLine(output) || "Finished and waiting for you"
            : "Finished and waiting for you",
        };
      }
    }
  }

  async function flushThread(
    threadId: string,
    entry: PendingThreadPush,
  ): Promise<void> {
    const thread = getThread(db, threadId);
    if (
      !thread ||
      thread.deletedAt !== null ||
      thread.archivedAt !== null ||
      thread.visibility !== "visible"
    ) {
      return;
    }
    const resolved = resolveKind(thread, entry);
    if (resolved === null) {
      return;
    }
    const subscriptions = listPushSubscriptions(db);
    if (subscriptions.length === 0) {
      return;
    }
    const title = truncate(threadDisplayTitle(thread), PUSH_TITLE_MAX_LENGTH);
    const body = truncate(resolved.body, PUSH_BODY_MAX_LENGTH);
    const data: PushNotificationData = {
      kind: resolved.kind,
      projectId: thread.projectId,
      threadId: thread.id,
    };
    const messages: ExpoPushMessage[] = subscriptions.map((subscription) => ({
      to: subscription.expoPushToken,
      title,
      body,
      data,
      sound: "default",
      channelId: "default",
      priority: "high",
    }));
    for (const batch of chunk(messages, EXPO_PUSH_BATCH_SIZE)) {
      await sendBatch(batch, subscriptions);
    }
  }

  async function sendBatch(
    batch: readonly ExpoPushMessage[],
    subscriptions: readonly PushSubscription[],
  ): Promise<void> {
    let responseText: string;
    let status: number;
    try {
      const response = await fetchImpl(expoPushUrl, {
        method: "POST",
        headers: {
          accept: "application/json",
          "content-type": "application/json",
        },
        body: JSON.stringify(batch),
      });
      status = response.status;
      responseText = await response.text();
    } catch (error) {
      logger.warn(
        { err: error, count: batch.length },
        "Expo push request failed",
      );
      return;
    }
    let parsed: z.infer<typeof expoPushResponseSchema>;
    try {
      parsed = expoPushResponseSchema.parse(JSON.parse(responseText));
    } catch {
      logger.warn(
        { status, count: batch.length },
        "Expo push response was not understood",
      );
      return;
    }
    if (parsed.errors && parsed.errors.length > 0) {
      logger.warn(
        { status, errors: parsed.errors },
        "Expo push request was rejected",
      );
      return;
    }
    const tickets = parsed.data ?? [];
    tickets.forEach((ticket, index) => {
      if (ticket.status === "ok") {
        return;
      }
      const message = batch[index];
      if (!message) {
        return;
      }
      if (ticket.details?.error === "DeviceNotRegistered") {
        const removed = deletePushSubscriptionByToken(db, message.to);
        const subscription = subscriptions.find(
          (candidate) => candidate.expoPushToken === message.to,
        );
        logger.info(
          {
            pushSubscriptionId: subscription?.id ?? null,
            removed,
          },
          "Removed push subscription: device no longer registered",
        );
        return;
      }
      logger.warn(
        {
          error: ticket.details?.error ?? null,
          message: ticket.message ?? null,
        },
        "Expo push ticket reported an error",
      );
    });
  }

  return {
    start() {
      if (!enabled || unsubscribe !== null) {
        return;
      }
      startedAt = now();
      unsubscribe = hub.onChangedMessage(onChangedMessage);
    },
    stop() {
      unsubscribe?.();
      unsubscribe = null;
      for (const threadId of [...pending.keys()]) {
        cancel(threadId);
      }
    },
    async settle() {
      while (inFlight.size > 0) {
        await Promise.allSettled([...inFlight]);
      }
    },
  };
}

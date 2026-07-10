import {
  requireThreadEventScopeTurnId,
  turnScope,
  type ThreadEvent,
} from "@bb/domain";
import { z } from "zod";
import type { ThreadEventWithMeta } from "./group-event-projection-turns.js";

const legacyCodexSubagentActivitySchema = z.object({
  jsonrpc: z.literal("2.0"),
  method: z.literal("item/completed"),
  params: z.object({
    threadId: z.string().min(1),
    turnId: z.string().min(1),
    item: z.object({
      type: z.literal("subAgentActivity"),
      id: z.string().min(1),
      kind: z.enum(["started", "interacted", "interrupted"]),
      agentThreadId: z.string().min(1),
      agentPath: z.string().min(1),
    }),
  }),
});

interface LegacyCodexSubagent {
  agentPath: string;
  agentThreadId: string;
  callId: string;
  logicalThreadId: string;
  parentProviderThreadId: string;
  parentTurnId: string;
}

function parseLegacyCodexSubagentActivity(
  event: ThreadEvent,
):
  | (LegacyCodexSubagent & { kind: "started" | "interacted" | "interrupted" })
  | null {
  if (event.type !== "provider/unhandled" || event.providerId !== "codex") {
    return null;
  }
  const parsed = legacyCodexSubagentActivitySchema.safeParse(event.rawEvent);
  if (
    !parsed.success ||
    parsed.data.params.threadId !== event.providerThreadId
  ) {
    return null;
  }
  const { item, threadId, turnId } = parsed.data.params;
  return {
    agentPath: item.agentPath,
    agentThreadId: item.agentThreadId,
    callId: item.id,
    kind: item.kind,
    logicalThreadId: event.threadId,
    parentProviderThreadId: threadId,
    parentTurnId: turnId,
  };
}

function buildSyntheticSubagentEvent(
  tracked: LegacyCodexSubagent,
  status: "pending" | "completed" | "failed" | "interrupted",
): ThreadEvent {
  const item = {
    type: "toolCall" as const,
    id: tracked.callId,
    tool: "spawnAgent",
    arguments: {
      senderThreadId: tracked.parentProviderThreadId,
      // Legacy Codex multiplexed child turns onto the parent provider thread.
      // The recovered child turn gets an explicit parent below; this receiver
      // is metadata for the rendered delegation, not a FIFO correlation hint.
      receiverThreadIds: [tracked.agentThreadId],
      description: tracked.agentPath,
    },
    status,
    ...(status === "pending"
      ? {}
      : {
          result: {
            agentPath: tracked.agentPath,
            agentThreadId: tracked.agentThreadId,
          },
        }),
  };
  return {
    type: status === "pending" ? "item/started" : "item/completed",
    threadId: tracked.logicalThreadId,
    providerThreadId: tracked.parentProviderThreadId,
    scope: turnScope(tracked.parentTurnId),
    item,
  };
}

function buildAcceptedRootTurnIds(
  events: readonly ThreadEventWithMeta[],
): ReadonlySet<string> {
  const requestTargetById = new Map<
    string,
    Extract<ThreadEvent, { type: "client/turn/requested" }>["target"]
  >();
  for (const { event } of events) {
    if (event.type === "client/turn/requested") {
      requestTargetById.set(event.requestId, event.target);
    }
  }

  const acceptedRootTurnIds = new Set<string>();
  for (const { event } of events) {
    if (event.type !== "turn/input/accepted") {
      continue;
    }
    const target = requestTargetById.get(event.clientRequestId);
    if (target?.kind !== "new-turn" && target?.kind !== "thread-start") {
      continue;
    }
    acceptedRootTurnIds.add(
      requireThreadEventScopeTurnId({
        type: event.type,
        scope: event.scope,
      }),
    );
  }
  return acceptedRootTurnIds;
}

function collectMaterializedToolCallIds(
  events: readonly ThreadEventWithMeta[],
): ReadonlySet<string> {
  const callIds = new Set<string>();
  for (const { event } of events) {
    if (
      (event.type === "item/started" || event.type === "item/completed") &&
      event.item.type === "toolCall"
    ) {
      callIds.add(event.item.id);
    }
  }
  return callIds;
}

/**
 * Repairs the event shape emitted before Codex subagent activity was
 * materialized at ingestion. The stored rows stay immutable; only the replay
 * projection receives synthetic delegation lifecycle events.
 */
export function repairLegacyCodexSubagentProjection(
  events: readonly ThreadEventWithMeta[],
): ThreadEventWithMeta[] {
  const acceptedRootTurnIds = buildAcceptedRootTurnIds(events);
  const materializedCallIds = collectMaterializedToolCallIds(events);
  const seenStartedCallIds = new Set<string>();
  const pendingByProviderThreadId = new Map<string, LegacyCodexSubagent[]>();
  const openByAgentThreadId = new Map<string, LegacyCodexSubagent>();
  const openByChildTurnId = new Map<string, LegacyCodexSubagent>();
  const repaired: ThreadEventWithMeta[] = [];

  const removePending = (tracked: LegacyCodexSubagent): void => {
    const pending = pendingByProviderThreadId.get(
      tracked.parentProviderThreadId,
    );
    if (!pending) {
      return;
    }
    const remaining = pending.filter(
      (candidate) => candidate.callId !== tracked.callId,
    );
    if (remaining.length === 0) {
      pendingByProviderThreadId.delete(tracked.parentProviderThreadId);
    } else if (remaining.length !== pending.length) {
      pendingByProviderThreadId.set(
        tracked.parentProviderThreadId,
        remaining,
      );
    }
  };

  const completeTracked = (
    tracked: LegacyCodexSubagent,
    status: "completed" | "failed" | "interrupted",
    meta: ThreadEventWithMeta["meta"],
  ): void => {
    openByAgentThreadId.delete(tracked.agentThreadId);
    removePending(tracked);
    for (const [turnId, candidate] of openByChildTurnId) {
      if (candidate.callId === tracked.callId) {
        openByChildTurnId.delete(turnId);
      }
    }
    repaired.push({
      event: buildSyntheticSubagentEvent(tracked, status),
      meta: {
        ...meta,
        id: `${meta.id}:legacy-subagent:${tracked.callId}:completed`,
      },
    });
  };

  for (const eventWithMeta of events) {
    const { event, meta } = eventWithMeta;
    const activity = parseLegacyCodexSubagentActivity(event);
    if (activity) {
      if (materializedCallIds.has(activity.callId)) {
        repaired.push(eventWithMeta);
        continue;
      }
      if (activity.kind === "interacted") {
        continue;
      }
      if (activity.kind === "interrupted") {
        const tracked = openByAgentThreadId.get(activity.agentThreadId);
        if (tracked) {
          completeTracked(tracked, "interrupted", meta);
        }
        continue;
      }

      if (seenStartedCallIds.has(activity.callId)) {
        continue;
      }
      seenStartedCallIds.add(activity.callId);
      const tracked: LegacyCodexSubagent = activity;
      openByAgentThreadId.set(tracked.agentThreadId, tracked);
      const pending =
        pendingByProviderThreadId.get(tracked.parentProviderThreadId) ?? [];
      pending.push(tracked);
      pendingByProviderThreadId.set(tracked.parentProviderThreadId, pending);
      repaired.push({
        event: buildSyntheticSubagentEvent(tracked, "pending"),
        meta: {
          ...meta,
          id: `${meta.id}:legacy-subagent:${tracked.callId}:started`,
        },
      });
      continue;
    }

    if (event.type === "turn/started") {
      const turnId = requireThreadEventScopeTurnId({
        type: event.type,
        scope: event.scope,
      });
      if (acceptedRootTurnIds.has(turnId)) {
        repaired.push(eventWithMeta);
        continue;
      }
      const pending = pendingByProviderThreadId.get(event.providerThreadId);
      const pendingIndex = event.parentToolCallId
        ? pending?.findIndex(
            (candidate) => candidate.callId === event.parentToolCallId,
          )
        : pending?.findIndex((candidate) => candidate.parentTurnId !== turnId);
      if (pending && pendingIndex !== undefined && pendingIndex >= 0) {
        const [tracked] = pending.splice(pendingIndex, 1);
        if (pending.length === 0) {
          pendingByProviderThreadId.delete(event.providerThreadId);
        }
        if (tracked) {
          openByChildTurnId.set(turnId, tracked);
          repaired.push({
            ...eventWithMeta,
            event: event.parentToolCallId
              ? event
              : { ...event, parentToolCallId: tracked.callId },
          });
          continue;
        }
      }
      repaired.push(eventWithMeta);
      continue;
    }

    repaired.push(eventWithMeta);

    if (event.type === "turn/completed") {
      const turnId = requireThreadEventScopeTurnId({
        type: event.type,
        scope: event.scope,
      });
      const tracked = openByChildTurnId.get(turnId);
      if (tracked) {
        completeTracked(tracked, event.status, meta);
      }
    }
  }

  return repaired;
}

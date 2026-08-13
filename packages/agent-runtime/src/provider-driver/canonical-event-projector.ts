import {
  threadEventSchema,
  threadScope,
  turnScope,
  type ProviderErrorCategory,
  type ThreadEvent,
} from "@bb/domain";
import type {
  ProviderDriverError,
  ProviderDriverEvent,
} from "@bb/provider-driver-contract";

export interface ProjectProviderDriverEventArgs {
  readonly bbThreadId: string;
  readonly event: ProviderDriverEvent;
  readonly providerSessionId: string;
}

function providerErrorCategory(
  category: ProviderDriverError["category"],
): ProviderErrorCategory {
  switch (category) {
    case "rate_limit":
      return "rate-limit";
    case "authentication":
      return "unauthorized";
    case "configuration":
      return "bad-request";
    case "context_limit":
      return "context-window-exceeded";
    case "permission":
      return "policy";
    case "provider_unavailable":
      return "overloaded";
    case "driver":
      return "internal";
    case "provider":
      return "unknown";
  }
}

function projectError(args: {
  bbThreadId: string;
  error: ProviderDriverError;
  providerSessionId: string;
  turnId: string;
}): ThreadEvent {
  return threadEventSchema.parse({
    type: "provider/error",
    threadId: args.bbThreadId,
    providerThreadId: args.providerSessionId,
    scope: turnScope(args.turnId),
    message: args.error.message,
    ...(args.error.detail !== undefined ? { detail: args.error.detail } : {}),
    errorInfo: {
      category: providerErrorCategory(args.error.category),
      providerCode: args.error.code,
      httpStatusCode: null,
    },
  });
}

/** Projects one bounded canonical driver event into persisted runtime facts. */
export function projectProviderDriverEvent(
  args: ProjectProviderDriverEventArgs,
): ThreadEvent[] {
  const thread = {
    threadId: args.bbThreadId,
    providerThreadId: args.providerSessionId,
  };
  const event = args.event;

  switch (event.type) {
    case "turn.settled": {
      const events: ThreadEvent[] = [];
      if (event.outcome === "failed" && event.error !== null) {
        events.push(
          projectError({
            bbThreadId: args.bbThreadId,
            providerSessionId: args.providerSessionId,
            error: event.error,
            turnId: event.turnId,
          }),
        );
      }
      events.push(
        threadEventSchema.parse({
          type: "turn/completed",
          ...thread,
          scope: turnScope(event.turnId),
          status:
            event.outcome === "completed"
              ? "completed"
              : event.outcome === "cancelled"
                ? "interrupted"
                : "failed",
          ...(event.error !== null
            ? { error: { message: event.error.message } }
            : {}),
          ...(event.providerCheckpointId !== null
            ? { providerCheckpointId: event.providerCheckpointId }
            : {}),
        }),
      );
      return events;
    }
    case "turn.retrying":
      return [
        threadEventSchema.parse({
          type: "provider/error",
          ...thread,
          scope: turnScope(event.turnId),
          message: "Provider retrying",
          detail: event.retryAt
            ? `${event.message} (attempt ${event.attempt}, retry at ${event.retryAt})`
            : `${event.message} (attempt ${event.attempt})`,
          willRetry: true,
        }),
      ];
    case "item.started":
      return [
        threadEventSchema.parse({
          type: "item/started",
          ...thread,
          scope: turnScope(event.turnId),
          item: event.item,
        }),
      ];
    case "item.completed":
      return [
        threadEventSchema.parse({
          type: "item/completed",
          ...thread,
          scope: turnScope(event.turnId),
          item: event.item,
        }),
      ];
    case "item.delta": {
      const base = {
        ...thread,
        scope: turnScope(event.turnId),
        itemId: event.itemId,
        delta: event.delta,
      };
      switch (event.channel) {
        case "assistant_text":
          return [
            threadEventSchema.parse({
              type: "item/agentMessage/delta",
              ...base,
            }),
          ];
        case "reasoning_text":
          return [
            threadEventSchema.parse({
              type: "item/reasoning/textDelta",
              ...base,
            }),
          ];
        case "reasoning_summary":
          return [
            threadEventSchema.parse({
              type: "item/reasoning/summaryTextDelta",
              ...base,
            }),
          ];
        case "command_output":
          return [
            threadEventSchema.parse({
              type: "item/commandExecution/outputDelta",
              ...base,
              ...(event.reset ? { reset: true } : {}),
            }),
          ];
        case "file_change_output":
          return [
            threadEventSchema.parse({
              type: "item/fileChange/outputDelta",
              ...base,
            }),
          ];
        case "plan_text":
          return [
            threadEventSchema.parse({
              type: "item/plan/delta",
              ...base,
            }),
          ];
        case "tool_output":
          return [
            threadEventSchema.parse({
              type: "item/toolCall/progress",
              ...thread,
              scope: turnScope(event.turnId),
              itemId: event.itemId,
              message: event.delta,
            }),
          ];
      }
    }
    case "turn.token_usage_changed":
      return [
        threadEventSchema.parse({
          type: "thread/tokenUsage/updated",
          ...thread,
          scope: turnScope(event.turnId),
          tokenUsage: event.tokenUsage,
        }),
      ];
    case "turn.compacted":
      return [
        threadEventSchema.parse({
          type: "thread/compacted",
          ...thread,
          scope: turnScope(event.turnId),
        }),
      ];
    case "session.context_window_usage_changed":
      return [
        threadEventSchema.parse({
          type: "thread/contextWindowUsage/updated",
          ...thread,
          scope: threadScope(),
          contextWindowUsage: event.contextWindowUsage,
        }),
      ];
    case "provider.rate_limits_changed":
      return [
        threadEventSchema.parse({
          type: "provider/rateLimits/updated",
          ...thread,
          scope: threadScope(),
          rateLimits: event.rateLimits,
        }),
      ];
    case "provider.warning":
      return [
        threadEventSchema.parse({
          type: "provider/warning",
          ...thread,
          scope: threadScope(),
          category: "general",
          summary: event.message,
          details: `Driver warning code: ${event.code}`,
        }),
      ];
    case "session.checkpoint_changed":
      // Current persisted events carry checkpoints only on turn completion.
      return [];
  }
}

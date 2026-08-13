import {
  providerRateLimitStateSchema,
  threadEventContextWindowUsageSchema,
  threadEventItemSchema,
  threadEventTokenUsageSchema,
  type ThreadEventItem,
} from "@bb/domain";
import { z } from "zod";
import { providerDriverErrorSchema } from "./errors.js";
import {
  providerDriverAttachmentIdSchema,
  providerDriverItemIdSchema,
  providerDriverSequenceSchema,
  providerDriverTurnIdSchema,
} from "./ids.js";
import {
  PROVIDER_DRIVER_MAX_ID_LENGTH,
  PROVIDER_DRIVER_MAX_MESSAGE_LENGTH,
} from "./limits.js";

const providerDriverEventBaseSchema = z.object({
  attachmentId: providerDriverAttachmentIdSchema,
  sequence: providerDriverSequenceSchema,
});

const providerDriverTurnEventBaseSchema = providerDriverEventBaseSchema.extend({
  turnId: providerDriverTurnIdSchema,
});

export type ProviderDriverItem = Exclude<
  ThreadEventItem,
  { type: "userMessage" }
>;
export const providerDriverItemSchema = threadEventItemSchema.refine(
  (item): item is ProviderDriverItem => item.type !== "userMessage",
  "Driver turn items cannot be user messages",
);

export const providerDriverItemDeltaChannelSchema = z.enum([
  "assistant_text",
  "reasoning_text",
  "reasoning_summary",
  "command_output",
  "file_change_output",
  "plan_text",
  "tool_output",
]);
export type ProviderDriverItemDeltaChannel = z.infer<
  typeof providerDriverItemDeltaChannelSchema
>;

export const providerDriverTurnSettledEventSchema =
  providerDriverTurnEventBaseSchema
    .extend({
      type: z.literal("turn.settled"),
      outcome: z.enum(["completed", "failed", "cancelled"]),
      error: providerDriverErrorSchema.nullable(),
      providerCheckpointId: z
        .string()
        .min(1)
        .max(PROVIDER_DRIVER_MAX_ID_LENGTH * 4)
        .nullable(),
    })
    .strict()
    .superRefine((event, context) => {
      if (event.outcome === "failed" && event.error === null) {
        context.addIssue({
          code: "custom",
          message: 'error is required when outcome is "failed"',
          path: ["error"],
        });
      }
      if (event.outcome === "completed" && event.error !== null) {
        context.addIssue({
          code: "custom",
          message: 'error must be null when outcome is "completed"',
          path: ["error"],
        });
      }
    });
export type ProviderDriverTurnSettledEvent = z.infer<
  typeof providerDriverTurnSettledEventSchema
>;

export const providerDriverItemCompletedEventSchema =
  providerDriverTurnEventBaseSchema
    .extend({
      type: z.literal("item.completed"),
      item: providerDriverItemSchema,
      outcome: z.enum(["completed", "failed", "cancelled"]),
      error: providerDriverErrorSchema.nullable(),
    })
    .strict()
    .superRefine((event, context) => {
      if (event.outcome === "failed" && event.error === null) {
        context.addIssue({
          code: "custom",
          message: 'error is required when outcome is "failed"',
          path: ["error"],
        });
      }
      if (event.outcome === "completed" && event.error !== null) {
        context.addIssue({
          code: "custom",
          message: 'error must be null when outcome is "completed"',
          path: ["error"],
        });
      }
    });

export const providerDriverEventSchema = z.discriminatedUnion("type", [
  providerDriverTurnSettledEventSchema,
  providerDriverTurnEventBaseSchema
    .extend({
      type: z.literal("turn.retrying"),
      attempt: z.number().int().positive(),
      message: z.string().min(1).max(PROVIDER_DRIVER_MAX_MESSAGE_LENGTH),
      retryAt: z.string().datetime().nullable(),
    })
    .strict(),
  providerDriverTurnEventBaseSchema
    .extend({
      type: z.literal("item.started"),
      item: providerDriverItemSchema,
    })
    .strict(),
  providerDriverTurnEventBaseSchema
    .extend({
      type: z.literal("item.delta"),
      itemId: providerDriverItemIdSchema,
      channel: providerDriverItemDeltaChannelSchema,
      delta: z.string(),
      reset: z.boolean(),
    })
    .strict(),
  providerDriverItemCompletedEventSchema,
  providerDriverEventBaseSchema
    .extend({
      type: z.literal("session.checkpoint_changed"),
      providerCheckpointId: z
        .string()
        .min(1)
        .max(PROVIDER_DRIVER_MAX_ID_LENGTH * 4),
    })
    .strict(),
  providerDriverTurnEventBaseSchema
    .extend({
      type: z.literal("turn.token_usage_changed"),
      tokenUsage: threadEventTokenUsageSchema,
    })
    .strict(),
  providerDriverTurnEventBaseSchema
    .extend({
      type: z.literal("turn.compacted"),
    })
    .strict(),
  providerDriverEventBaseSchema
    .extend({
      type: z.literal("session.context_window_usage_changed"),
      contextWindowUsage: threadEventContextWindowUsageSchema,
    })
    .strict(),
  providerDriverEventBaseSchema
    .extend({
      type: z.literal("provider.rate_limits_changed"),
      rateLimits: providerRateLimitStateSchema,
    })
    .strict(),
  providerDriverEventBaseSchema
    .extend({
      type: z.literal("provider.warning"),
      code: z.string().min(1).max(PROVIDER_DRIVER_MAX_ID_LENGTH),
      message: z.string().min(1).max(PROVIDER_DRIVER_MAX_MESSAGE_LENGTH),
    })
    .strict(),
  providerDriverEventBaseSchema
    .extend({
      type: z.literal("provider.model_fallback"),
      originalModel: z
        .string()
        .min(1)
        .max(PROVIDER_DRIVER_MAX_ID_LENGTH * 4),
      fallbackModel: z
        .string()
        .min(1)
        .max(PROVIDER_DRIVER_MAX_ID_LENGTH * 4),
      reason: z.enum(["refusal", "provider"]),
      message: z.string().min(1).max(PROVIDER_DRIVER_MAX_MESSAGE_LENGTH),
      turnId: providerDriverTurnIdSchema.nullable(),
    })
    .strict(),
  providerDriverEventBaseSchema
    .extend({
      type: z.literal("background_task.progress"),
      item: threadEventItemSchema.refine(
        (item): item is Extract<ThreadEventItem, { type: "backgroundTask" }> =>
          item.type === "backgroundTask",
        "Background-task progress requires a backgroundTask item",
      ),
      turnId: providerDriverTurnIdSchema.nullable(),
    })
    .strict(),
  providerDriverEventBaseSchema
    .extend({
      type: z.literal("background_task.completed"),
      item: threadEventItemSchema.refine(
        (item): item is Extract<ThreadEventItem, { type: "backgroundTask" }> =>
          item.type === "backgroundTask",
        "Background-task completion requires a backgroundTask item",
      ),
      turnId: providerDriverTurnIdSchema.nullable(),
    })
    .strict(),
]);
export type ProviderDriverEvent = z.infer<typeof providerDriverEventSchema>;

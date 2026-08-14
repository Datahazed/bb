import {
  clientTurnRequestIdSchema,
  instructionModeSchema,
  jsonObjectSchema,
  promptInputSchema,
  reasoningLevelSchema,
  runtimePermissionPolicySchema,
  serviceTierSchema,
} from "@bb/domain";
import { z } from "zod";
import { providerDriverErrorSchema } from "./errors.js";
import {
  providerDriverAttachmentIdSchema,
  providerDriverCallIdSchema,
  providerDriverOperationIdSchema,
  providerDriverSessionIdSchema,
  providerDriverTurnIdSchema,
} from "./ids.js";
import {
  PROVIDER_DRIVER_MAX_DYNAMIC_TOOLS,
  PROVIDER_DRIVER_MAX_ID_LENGTH,
  PROVIDER_DRIVER_MAX_MESSAGE_LENGTH,
  PROVIDER_DRIVER_MAX_SKILL_SOURCES,
} from "./limits.js";

const pathSchema = z.string().min(1).max(16_384);

export const providerDriverExecutionOptionsSchema = z
  .object({
    model: z
      .string()
      .min(1)
      .max(PROVIDER_DRIVER_MAX_ID_LENGTH * 4),
    reasoningLevel: reasoningLevelSchema,
    serviceTier: serviceTierSchema,
    permission: runtimePermissionPolicySchema,
    features: z
      .object({
        workflowsEnabled: z.boolean(),
        memoryEnabled: z.boolean(),
        planModeEnabled: z.boolean(),
        subagentsEnabled: z.boolean(),
      })
      .strict(),
    providerOptions: jsonObjectSchema,
  })
  .strict();
export type ProviderDriverExecutionOptions = z.infer<
  typeof providerDriverExecutionOptionsSchema
>;

export const providerDriverSkillSourceSchema = z
  .object({
    id: z.string().min(1).max(PROVIDER_DRIVER_MAX_ID_LENGTH),
    /** Root of a staged skill package. Skill folders are under `skills/`. */
    rootPath: pathSchema,
    skills: z
      .array(
        z
          .object({
            name: z.string().min(1).max(PROVIDER_DRIVER_MAX_ID_LENGTH),
            description: z
              .string()
              .max(PROVIDER_DRIVER_MAX_MESSAGE_LENGTH)
              .nullable(),
          })
          .strict(),
      )
      .max(1_024),
  })
  .strict();
export type ProviderDriverSkillSource = z.infer<
  typeof providerDriverSkillSourceSchema
>;

export const providerDriverDynamicToolSchema = z
  .object({
    name: z.string().min(1).max(PROVIDER_DRIVER_MAX_ID_LENGTH),
    description: z.string().max(PROVIDER_DRIVER_MAX_MESSAGE_LENGTH),
    inputSchema: jsonObjectSchema,
    statusLabels: z
      .object({
        pending: z.string().min(1).max(PROVIDER_DRIVER_MAX_MESSAGE_LENGTH),
        completed: z.string().min(1).max(PROVIDER_DRIVER_MAX_MESSAGE_LENGTH),
      })
      .strict()
      .nullable(),
  })
  .strict();
export type ProviderDriverDynamicTool = z.infer<
  typeof providerDriverDynamicToolSchema
>;

export const providerSessionOpenModeSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("start") }).strict(),
  z
    .object({
      kind: z.literal("resume"),
      providerSessionId: providerDriverSessionIdSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("fork"),
      sourceProviderSessionId: providerDriverSessionIdSchema,
      sourceCheckpointId: z
        .string()
        .min(1)
        .max(PROVIDER_DRIVER_MAX_ID_LENGTH * 4)
        .nullable(),
    })
    .strict(),
]);
export type ProviderSessionOpenMode = z.infer<
  typeof providerSessionOpenModeSchema
>;

export const providerSessionOpenParamsSchema = z
  .object({
    operationId: providerDriverOperationIdSchema,
    attachmentId: providerDriverAttachmentIdSchema,
    bbThreadId: z.string().min(1).max(PROVIDER_DRIVER_MAX_ID_LENGTH),
    mode: providerSessionOpenModeSchema,
    workspace: z
      .object({
        cwd: pathSchema,
        additionalWriteRoots: z.array(pathSchema).max(256),
        threadStoragePath: pathSchema,
      })
      .strict(),
    execution: providerDriverExecutionOptionsSchema,
    instructions: z
      .object({
        mode: instructionModeSchema,
        text: z.string().max(4 * 1024 * 1024),
      })
      .strict(),
    skillSources: z
      .array(providerDriverSkillSourceSchema)
      .max(PROVIDER_DRIVER_MAX_SKILL_SOURCES),
    dynamicTools: z
      .array(providerDriverDynamicToolSchema)
      .max(PROVIDER_DRIVER_MAX_DYNAMIC_TOOLS),
    disallowedTools: z
      .array(z.string().min(1).max(PROVIDER_DRIVER_MAX_ID_LENGTH))
      .max(PROVIDER_DRIVER_MAX_DYNAMIC_TOOLS),
    outputSchema: jsonObjectSchema.nullable(),
    shellEnvironment: z.record(z.string(), z.string()),
  })
  .strict();
export type ProviderSessionOpenParams = z.infer<
  typeof providerSessionOpenParamsSchema
>;

export const providerSessionOpenResultSchema = z
  .object({
    providerSessionId: providerDriverSessionIdSchema,
    sessionFormatVersion: z
      .string()
      .min(1)
      .max(PROVIDER_DRIVER_MAX_ID_LENGTH)
      .nullable(),
  })
  .strict();
export type ProviderSessionOpenResult = z.infer<
  typeof providerSessionOpenResultSchema
>;

export const providerSessionDetachParamsSchema = z
  .object({
    operationId: providerDriverOperationIdSchema,
    attachmentId: providerDriverAttachmentIdSchema,
  })
  .strict();
export type ProviderSessionDetachParams = z.infer<
  typeof providerSessionDetachParamsSchema
>;

export const providerSessionDetachResultSchema = z
  .object({
    providerCheckpointId: z
      .string()
      .min(1)
      .max(PROVIDER_DRIVER_MAX_ID_LENGTH * 4)
      .nullable(),
  })
  .strict();
export type ProviderSessionDetachResult = z.infer<
  typeof providerSessionDetachResultSchema
>;

export const providerSessionDiscardParamsSchema = z
  .object({
    operationId: providerDriverOperationIdSchema,
    attachmentId: providerDriverAttachmentIdSchema,
    providerSessionId: providerDriverSessionIdSchema,
  })
  .strict();
export type ProviderSessionDiscardParams = z.infer<
  typeof providerSessionDiscardParamsSchema
>;

const providerSessionMutationParamsBaseSchema = z
  .object({
    operationId: providerDriverOperationIdSchema,
    attachmentId: providerDriverAttachmentIdSchema,
  })
  .strict();

export const providerSessionRenameParamsSchema =
  providerSessionMutationParamsBaseSchema.extend({
    title: z.string().min(1).max(PROVIDER_DRIVER_MAX_MESSAGE_LENGTH),
  });
export type ProviderSessionRenameParams = z.infer<
  typeof providerSessionRenameParamsSchema
>;

export const providerSessionArchiveParamsSchema =
  providerSessionMutationParamsBaseSchema.extend({ archived: z.boolean() });
export type ProviderSessionArchiveParams = z.infer<
  typeof providerSessionArchiveParamsSchema
>;

export const providerSessionCompactParamsSchema =
  providerSessionMutationParamsBaseSchema;
export type ProviderSessionCompactParams = z.infer<
  typeof providerSessionCompactParamsSchema
>;

export const providerSessionClearGoalParamsSchema =
  providerSessionMutationParamsBaseSchema;
export type ProviderSessionClearGoalParams = z.infer<
  typeof providerSessionClearGoalParamsSchema
>;

const providerTurnSubmitBaseSchema = z.object({
  operationId: providerDriverOperationIdSchema,
  clientRequestId: clientTurnRequestIdSchema,
  attachmentId: providerDriverAttachmentIdSchema,
  /** Preserves queued-message boundaries without carrying a second flattened form. */
  inputGroups: z.array(z.array(promptInputSchema).min(1)).min(1),
  execution: providerDriverExecutionOptionsSchema,
});

export const providerTurnSubmitParamsSchema = z.discriminatedUnion("mode", [
  providerTurnSubmitBaseSchema
    .extend({
      mode: z.literal("start"),
      turnId: providerDriverTurnIdSchema,
    })
    .strict(),
  providerTurnSubmitBaseSchema
    .extend({
      mode: z.literal("steer"),
      expectedTurnId: providerDriverTurnIdSchema,
    })
    .strict(),
]);
export type ProviderTurnSubmitParams = z.infer<
  typeof providerTurnSubmitParamsSchema
>;

export const providerTurnSubmitResultSchema = z.discriminatedUnion("outcome", [
  z
    .object({
      outcome: z.literal("accepted"),
      disposition: z.enum(["started", "steered", "queued"]),
      turnId: providerDriverTurnIdSchema,
      providerTurnId: z
        .string()
        .min(1)
        .max(PROVIDER_DRIVER_MAX_ID_LENGTH * 4)
        .nullable(),
    })
    .strict(),
  z
    .object({
      outcome: z.literal("stale"),
      activeTurnId: providerDriverTurnIdSchema.nullable(),
    })
    .strict(),
  z
    .object({
      outcome: z.literal("rejected"),
      error: providerDriverErrorSchema,
    })
    .strict(),
]);
export type ProviderTurnSubmitResult = z.infer<
  typeof providerTurnSubmitResultSchema
>;

export const providerTurnCancelParamsSchema = z
  .object({
    operationId: providerDriverOperationIdSchema,
    attachmentId: providerDriverAttachmentIdSchema,
    turnId: providerDriverTurnIdSchema,
  })
  .strict();
export type ProviderTurnCancelParams = z.infer<
  typeof providerTurnCancelParamsSchema
>;

export const providerTurnCancelResultSchema = z
  .object({
    outcome: z.enum([
      "cancellation_requested",
      "already_settled",
      "not_active",
    ]),
  })
  .strict();
export type ProviderTurnCancelResult = z.infer<
  typeof providerTurnCancelResultSchema
>;

export const providerDriverHostToolCallParamsSchema = z
  .object({
    attachmentId: providerDriverAttachmentIdSchema,
    turnId: providerDriverTurnIdSchema,
    callId: providerDriverCallIdSchema,
    tool: z.string().min(1).max(PROVIDER_DRIVER_MAX_ID_LENGTH),
    arguments: jsonObjectSchema,
  })
  .strict();
export type ProviderDriverHostToolCallParams = z.infer<
  typeof providerDriverHostToolCallParamsSchema
>;

export const providerDriverHostToolCallResultSchema = z
  .object({
    success: z.boolean(),
    content: z.array(
      z.discriminatedUnion("type", [
        z.object({ type: z.literal("text"), text: z.string() }).strict(),
        z
          .object({
            type: z.literal("image"),
            imageUrl: z.string().min(1),
          })
          .strict(),
      ]),
    ),
  })
  .strict();
export type ProviderDriverHostToolCallResult = z.infer<
  typeof providerDriverHostToolCallResultSchema
>;

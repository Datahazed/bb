import {
  approvalPendingInteractionResolutionSchema,
  availableModelSchema,
  pendingInteractionPayloadSchema,
  permissionModeSchema,
  userQuestionPendingInteractionResolutionSchema,
} from "@bb/domain";
import { z } from "zod";
import {
  providerDriverAttachmentIdSchema,
  providerDriverCallIdSchema,
  providerDriverTurnIdSchema,
} from "./ids.js";
import {
  PROVIDER_DRIVER_MAX_DETAIL_LENGTH,
  PROVIDER_DRIVER_MAX_ID_LENGTH,
  PROVIDER_DRIVER_MAX_MESSAGE_LENGTH,
  PROVIDER_DRIVER_MAX_MODELS,
} from "./limits.js";

const providerDriverReadinessProblemSchema = z
  .object({
    reason: z.string().min(1).max(PROVIDER_DRIVER_MAX_MESSAGE_LENGTH),
  })
  .strict();

export const providerDriverReadinessSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("ready") }).strict(),
  providerDriverReadinessProblemSchema.extend({
    status: z.literal("needs_configuration"),
  }),
  providerDriverReadinessProblemSchema.extend({
    status: z.literal("missing_dependency"),
  }),
  providerDriverReadinessProblemSchema.extend({
    status: z.literal("unsupported_version"),
  }),
  providerDriverReadinessProblemSchema.extend({
    status: z.literal("incompatible"),
  }),
  providerDriverReadinessProblemSchema.extend({
    status: z.literal("unavailable"),
    retryable: z.boolean(),
  }),
]);
export type ProviderDriverReadiness = z.infer<
  typeof providerDriverReadinessSchema
>;

export const providerDriverSessionOperationSchema = z.enum([
  "fork",
  "rename",
  "archive",
  "compact",
  "clear_goal",
  "structured_output",
]);
export type ProviderDriverSessionOperation = z.infer<
  typeof providerDriverSessionOperationSchema
>;

export const providerDriverCapabilitiesSchema = z
  .object({
    multiplexSessions: z.boolean(),
    supportedSessionOperations: z
      .array(providerDriverSessionOperationSchema)
      .max(providerDriverSessionOperationSchema.options.length)
      .refine((operations) => new Set(operations).size === operations.length, {
        message: "supportedSessionOperations must not contain duplicates",
      }),
    supportedPermissionModes: z
      .array(permissionModeSchema)
      .min(1)
      .refine((modes) => new Set(modes).size === modes.length, {
        message: "supportedPermissionModes must not contain duplicates",
      }),
    supportsServiceTier: z.boolean(),
    supportsSteering: z.boolean(),
    supportsUserQuestions: z.boolean(),
  })
  .strict();
export type ProviderDriverCapabilities = z.infer<
  typeof providerDriverCapabilitiesSchema
>;

export const providerDriverDiagnosticSchema = z
  .object({
    level: z.enum(["info", "warning", "error"]),
    code: z.string().min(1).max(PROVIDER_DRIVER_MAX_ID_LENGTH),
    message: z.string().min(1).max(PROVIDER_DRIVER_MAX_MESSAGE_LENGTH),
    detail: z.string().max(PROVIDER_DRIVER_MAX_DETAIL_LENGTH).nullable(),
  })
  .strict();
export type ProviderDriverDiagnostic = z.infer<
  typeof providerDriverDiagnosticSchema
>;

export const providerDriverInspectParamsSchema = z
  .object({
    cwd: z.string().min(1).max(16_384).nullable(),
    operation: z.enum(["new_session", "resume", "fork", "rewind"]).nullable(),
  })
  .strict();
export type ProviderDriverInspectParams = z.infer<
  typeof providerDriverInspectParamsSchema
>;

export const providerDriverInspectResultSchema = z
  .object({
    readiness: providerDriverReadinessSchema,
    capabilities: providerDriverCapabilitiesSchema,
    models: z.array(availableModelSchema).max(PROVIDER_DRIVER_MAX_MODELS),
    selectedOnlyModels: z
      .array(availableModelSchema)
      .max(PROVIDER_DRIVER_MAX_MODELS),
    diagnostics: z.array(providerDriverDiagnosticSchema).max(256),
  })
  .strict();
export type ProviderDriverInspectResult = z.infer<
  typeof providerDriverInspectResultSchema
>;

export const providerDriverHostInteractionRequestParamsSchema = z
  .object({
    attachmentId: providerDriverAttachmentIdSchema,
    turnId: providerDriverTurnIdSchema,
    requestId: providerDriverCallIdSchema,
    payload: pendingInteractionPayloadSchema,
  })
  .strict();
export type ProviderDriverHostInteractionRequestParams = z.infer<
  typeof providerDriverHostInteractionRequestParamsSchema
>;

export const providerDriverHostInteractionRequestResultSchema = z
  .object({
    resolution: z.union([
      approvalPendingInteractionResolutionSchema,
      userQuestionPendingInteractionResolutionSchema,
    ]),
  })
  .strict();
export type ProviderDriverHostInteractionRequestResult = z.infer<
  typeof providerDriverHostInteractionRequestResultSchema
>;

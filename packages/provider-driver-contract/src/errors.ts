import { z } from "zod";
import {
  PROVIDER_DRIVER_MAX_DETAIL_LENGTH,
  PROVIDER_DRIVER_MAX_ID_LENGTH,
  PROVIDER_DRIVER_MAX_MESSAGE_LENGTH,
} from "./limits.js";

export const providerDriverErrorCategorySchema = z.enum([
  "rate_limit",
  "authentication",
  "configuration",
  "context_limit",
  "permission",
  "provider_unavailable",
  "billing",
  "budget_exceeded",
  "max_output_tokens",
  "max_turns",
  "structured_output_retries",
  "internal",
  "provider",
  "driver",
]);
export type ProviderDriverErrorCategory = z.infer<
  typeof providerDriverErrorCategorySchema
>;

export const providerDriverRetrySchema = z
  .object({
    disposition: z.enum(["automatic", "after", "manual", "never"]),
    retryAt: z.string().datetime().optional(),
  })
  .strict()
  .superRefine((retry, context) => {
    if (retry.disposition === "after" && retry.retryAt === undefined) {
      context.addIssue({
        code: "custom",
        message: 'retryAt is required when disposition is "after"',
        path: ["retryAt"],
      });
    }
    if (retry.disposition !== "after" && retry.retryAt !== undefined) {
      context.addIssue({
        code: "custom",
        message: 'retryAt is only valid when disposition is "after"',
        path: ["retryAt"],
      });
    }
  });
export type ProviderDriverRetry = z.infer<typeof providerDriverRetrySchema>;

export const providerDriverErrorSchema = z
  .object({
    code: z.string().min(1).max(PROVIDER_DRIVER_MAX_ID_LENGTH),
    category: providerDriverErrorCategorySchema,
    message: z.string().min(1).max(PROVIDER_DRIVER_MAX_MESSAGE_LENGTH),
    detail: z.string().max(PROVIDER_DRIVER_MAX_DETAIL_LENGTH).optional(),
    httpStatusCode: z.number().int().min(100).max(599).optional(),
    retry: providerDriverRetrySchema.optional(),
  })
  .strict();
export type ProviderDriverError = z.infer<typeof providerDriverErrorSchema>;

export const providerDriverOperationResultSchema = z.discriminatedUnion(
  "outcome",
  [
    z.object({ outcome: z.literal("applied") }).strict(),
    z.object({ outcome: z.literal("unchanged") }).strict(),
    z
      .object({
        outcome: z.literal("unsupported"),
        message: z.string().min(1).max(PROVIDER_DRIVER_MAX_MESSAGE_LENGTH),
      })
      .strict(),
  ],
);
export type ProviderDriverOperationResult = z.infer<
  typeof providerDriverOperationResultSchema
>;

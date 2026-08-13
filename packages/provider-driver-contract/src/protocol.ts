import { jsonObjectSchema } from "@bb/domain";
import { z } from "zod";
import {
  providerDriverErrorSchema,
  providerDriverOperationResultSchema,
} from "./errors.js";
import { providerDriverEventSchema } from "./events.js";
import {
  providerDriverIdSchema,
  providerDriverPluginIdSchema,
  providerDriverProviderIdSchema,
} from "./ids.js";
import {
  providerDriverHostInteractionRequestParamsSchema,
  providerDriverHostInteractionRequestResultSchema,
  providerDriverInspectParamsSchema,
  providerDriverInspectResultSchema,
} from "./inspection.js";
import { PROVIDER_DRIVER_PROTOCOL_VERSION } from "./limits.js";
import {
  providerDriverHostToolCallParamsSchema,
  providerDriverHostToolCallResultSchema,
  providerSessionArchiveParamsSchema,
  providerSessionClearGoalParamsSchema,
  providerSessionCompactParamsSchema,
  providerSessionDetachParamsSchema,
  providerSessionDetachResultSchema,
  providerSessionDiscardParamsSchema,
  providerSessionOpenParamsSchema,
  providerSessionOpenResultSchema,
  providerSessionRenameParamsSchema,
  providerTurnCancelParamsSchema,
  providerTurnCancelResultSchema,
  providerTurnSubmitParamsSchema,
  providerTurnSubmitResultSchema,
} from "./session.js";

export const providerDriverProtocolVersionSchema = z.number().int().positive();

export const providerDriverInitializeParamsSchema = z
  .object({
    supportedProtocolVersions: z
      .array(providerDriverProtocolVersionSchema)
      .min(1)
      .refine((versions) => new Set(versions).size === versions.length, {
        message: "supportedProtocolVersions must not contain duplicates",
      }),
    expected: z
      .object({
        pluginId: providerDriverPluginIdSchema,
        driverId: providerDriverIdSchema,
        providerId: providerDriverProviderIdSchema,
        artifactDigest: z.string().regex(/^[a-f0-9]{64}$/u),
      })
      .strict(),
    host: z
      .object({
        platform: z.string().min(1).max(64),
        architecture: z.string().min(1).max(64),
      })
      .strict(),
    paths: z
      .object({
        providerDataDir: z.string().min(1).max(16_384),
      })
      .strict(),
    config: jsonObjectSchema,
  })
  .strict();
export type ProviderDriverInitializeParams = z.infer<
  typeof providerDriverInitializeParamsSchema
>;

export const providerDriverInitializeResultSchema = z
  .object({
    protocolVersion: providerDriverProtocolVersionSchema,
    identity: z
      .object({
        pluginId: providerDriverPluginIdSchema,
        driverId: providerDriverIdSchema,
        providerId: providerDriverProviderIdSchema,
      })
      .strict(),
    processCapabilities: z
      .object({
        multiplexSessions: z.boolean(),
      })
      .strict(),
  })
  .strict();
export type ProviderDriverInitializeResult = z.infer<
  typeof providerDriverInitializeResultSchema
>;

export function supportsCurrentProviderDriverProtocol(
  versions: readonly number[],
): boolean {
  return versions.includes(PROVIDER_DRIVER_PROTOCOL_VERSION);
}

const rpcIdSchema = z.union([
  z.string().min(1).max(512),
  z.number().int().safe(),
]);

function driverRequestSchema<Method extends string, Params extends z.ZodType>(
  method: Method,
  params: Params,
) {
  return z
    .object({
      jsonrpc: z.literal("2.0"),
      id: rpcIdSchema,
      method: z.literal(method),
      params,
    })
    .strict();
}

export const providerDriverRequestSchema = z.discriminatedUnion("method", [
  driverRequestSchema(
    "driver.initialize",
    providerDriverInitializeParamsSchema,
  ),
  driverRequestSchema("driver.inspect", providerDriverInspectParamsSchema),
  driverRequestSchema("driver.shutdown", z.object({}).strict()),
  driverRequestSchema("session.open", providerSessionOpenParamsSchema),
  driverRequestSchema("session.detach", providerSessionDetachParamsSchema),
  driverRequestSchema("session.discard", providerSessionDiscardParamsSchema),
  driverRequestSchema("session.rename", providerSessionRenameParamsSchema),
  driverRequestSchema(
    "session.set_archived",
    providerSessionArchiveParamsSchema,
  ),
  driverRequestSchema("session.compact", providerSessionCompactParamsSchema),
  driverRequestSchema(
    "session.clear_goal",
    providerSessionClearGoalParamsSchema,
  ),
  driverRequestSchema("turn.submit", providerTurnSubmitParamsSchema),
  driverRequestSchema("turn.cancel", providerTurnCancelParamsSchema),
]);
export type ProviderDriverRequest = z.infer<typeof providerDriverRequestSchema>;

export const providerDriverHostRequestSchema = z.discriminatedUnion("method", [
  driverRequestSchema("host.tool.call", providerDriverHostToolCallParamsSchema),
  driverRequestSchema(
    "host.interaction.request",
    providerDriverHostInteractionRequestParamsSchema,
  ),
]);
export type ProviderDriverHostRequest = z.infer<
  typeof providerDriverHostRequestSchema
>;

export const providerDriverEventNotificationSchema = z
  .object({
    jsonrpc: z.literal("2.0"),
    method: z.literal("driver.event"),
    params: providerDriverEventSchema,
  })
  .strict();
export type ProviderDriverEventNotification = z.infer<
  typeof providerDriverEventNotificationSchema
>;

export const providerDriverRpcSuccessResponseSchema = z
  .object({
    jsonrpc: z.literal("2.0"),
    id: rpcIdSchema,
    result: z.unknown(),
  })
  .strict();

export const providerDriverRpcErrorResponseSchema = z
  .object({
    jsonrpc: z.literal("2.0"),
    id: rpcIdSchema,
    error: z
      .object({
        code: z.number().int(),
        message: z.string().min(1).max(4_096),
        data: providerDriverErrorSchema.nullable(),
      })
      .strict(),
  })
  .strict();

export const providerDriverRpcResponseSchema = z.union([
  providerDriverRpcSuccessResponseSchema,
  providerDriverRpcErrorResponseSchema,
]);
export type ProviderDriverRpcResponse = z.infer<
  typeof providerDriverRpcResponseSchema
>;

/** Result schemas are selected from the pending request method after correlation by id. */
export const providerDriverMethodSchemas = {
  "driver.initialize": {
    params: providerDriverInitializeParamsSchema,
    result: providerDriverInitializeResultSchema,
  },
  "driver.inspect": {
    params: providerDriverInspectParamsSchema,
    result: providerDriverInspectResultSchema,
  },
  "driver.shutdown": {
    params: z.object({}).strict(),
    result: z.object({}).strict(),
  },
  "session.open": {
    params: providerSessionOpenParamsSchema,
    result: providerSessionOpenResultSchema,
  },
  "session.detach": {
    params: providerSessionDetachParamsSchema,
    result: providerSessionDetachResultSchema,
  },
  "session.discard": {
    params: providerSessionDiscardParamsSchema,
    result: z.object({}).strict(),
  },
  "session.rename": {
    params: providerSessionRenameParamsSchema,
    result: providerDriverOperationResultSchema,
  },
  "session.set_archived": {
    params: providerSessionArchiveParamsSchema,
    result: providerDriverOperationResultSchema,
  },
  "session.compact": {
    params: providerSessionCompactParamsSchema,
    result: providerDriverOperationResultSchema,
  },
  "session.clear_goal": {
    params: providerSessionClearGoalParamsSchema,
    result: providerDriverOperationResultSchema,
  },
  "turn.submit": {
    params: providerTurnSubmitParamsSchema,
    result: providerTurnSubmitResultSchema,
  },
  "turn.cancel": {
    params: providerTurnCancelParamsSchema,
    result: providerTurnCancelResultSchema,
  },
} as const;

export const providerDriverHostMethodSchemas = {
  "host.tool.call": {
    params: providerDriverHostToolCallParamsSchema,
    result: providerDriverHostToolCallResultSchema,
  },
  "host.interaction.request": {
    params: providerDriverHostInteractionRequestParamsSchema,
    result: providerDriverHostInteractionRequestResultSchema,
  },
} as const;

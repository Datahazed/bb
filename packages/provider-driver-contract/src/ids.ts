import { z } from "zod";
import { PROVIDER_DRIVER_MAX_ID_LENGTH } from "./limits.js";

const protocolIdPattern = /^[A-Za-z0-9][A-Za-z0-9._:@/-]*$/u;

function protocolIdSchema(label: string) {
  return z
    .string()
    .min(1)
    .max(PROVIDER_DRIVER_MAX_ID_LENGTH)
    .regex(protocolIdPattern, `${label} contains unsupported characters`);
}

export const providerDriverIdSchema = protocolIdSchema("driver id");
export const providerDriverProviderIdSchema = protocolIdSchema("provider id");
export const providerDriverPluginIdSchema = protocolIdSchema("plugin id");
export const providerDriverAttachmentIdSchema =
  protocolIdSchema("attachment id");
export const providerDriverOperationIdSchema = protocolIdSchema("operation id");
export const providerDriverTurnIdSchema = protocolIdSchema("turn id");
export const providerDriverItemIdSchema = protocolIdSchema("item id");
export const providerDriverCallIdSchema = protocolIdSchema("call id");

/** Provider session identities are opaque and may not follow BB's identifier alphabet. */
export const providerDriverSessionIdSchema = z
  .string()
  .min(1)
  .max(PROVIDER_DRIVER_MAX_ID_LENGTH * 4);

export const providerDriverSequenceSchema = z
  .number()
  .int()
  .positive()
  .max(Number.MAX_SAFE_INTEGER);

export type ProviderDriverId = z.infer<typeof providerDriverIdSchema>;
export type ProviderDriverProviderId = z.infer<
  typeof providerDriverProviderIdSchema
>;
export type ProviderDriverPluginId = z.infer<
  typeof providerDriverPluginIdSchema
>;
export type ProviderDriverAttachmentId = z.infer<
  typeof providerDriverAttachmentIdSchema
>;
export type ProviderDriverOperationId = z.infer<
  typeof providerDriverOperationIdSchema
>;
export type ProviderDriverTurnId = z.infer<typeof providerDriverTurnIdSchema>;
export type ProviderDriverItemId = z.infer<typeof providerDriverItemIdSchema>;
export type ProviderDriverCallId = z.infer<typeof providerDriverCallIdSchema>;
export type ProviderDriverSessionId = z.infer<
  typeof providerDriverSessionIdSchema
>;
export type ProviderDriverSequence = z.infer<
  typeof providerDriverSequenceSchema
>;

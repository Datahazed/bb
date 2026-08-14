import { z } from "zod";
import { PROVIDER_DRIVER_PROTOCOL_VERSION } from "./limits.js";

export const PROVIDER_DRIVER_ARTIFACT_FORMAT_VERSION = 2 as const;
export const PROVIDER_DRIVER_ARTIFACT_RUNTIME = "node22" as const;
export const PROVIDER_DRIVER_ARTIFACT_ENTRYPOINT = "driver.ts" as const;
export const PROVIDER_DRIVER_ARTIFACT_MAX_ARCHIVE_BYTES = 256 * 1024 * 1024;
export const PROVIDER_DRIVER_ARTIFACT_MAX_EXTRACTED_BYTES = 512 * 1024 * 1024;

export const providerDriverArtifactDigestSchema = z
  .string()
  .regex(/^[a-f0-9]{64}$/);
export type ProviderDriverArtifactDigest = z.infer<
  typeof providerDriverArtifactDigestSchema
>;

export const providerDriverArtifactMetaSchema = z
  .object({
    artifactFormatVersion: z.literal(PROVIDER_DRIVER_ARTIFACT_FORMAT_VERSION),
    pluginId: z.string().min(1),
    pluginVersion: z.string().min(1),
    driverId: z.string().min(1),
    providerDriverProtocolVersion: z.literal(PROVIDER_DRIVER_PROTOCOL_VERSION),
    runtime: z.literal(PROVIDER_DRIVER_ARTIFACT_RUNTIME),
    entrypoint: z.literal(PROVIDER_DRIVER_ARTIFACT_ENTRYPOINT),
    builtWith: z
      .object({
        bbVersion: z.string().min(1),
      })
      .strict(),
  })
  .strict();
export type ProviderDriverArtifactMeta = z.infer<
  typeof providerDriverArtifactMetaSchema
>;

export const providerDriverArtifactDescriptorSchema = z
  .object({
    digest: providerDriverArtifactDigestSchema,
    meta: providerDriverArtifactMetaSchema,
  })
  .strict();
export type ProviderDriverArtifactDescriptor = z.infer<
  typeof providerDriverArtifactDescriptorSchema
>;

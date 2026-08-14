import { describe, expect, it } from "vitest";
import {
  PROVIDER_DRIVER_ARTIFACT_FORMAT_VERSION,
  PROVIDER_DRIVER_PROTOCOL_VERSION,
  providerDriverArtifactDescriptorSchema,
} from "../src/index.js";

describe("provider driver artifact contract", () => {
  const descriptor = {
    digest: "a".repeat(64),
    meta: {
      artifactFormatVersion: PROVIDER_DRIVER_ARTIFACT_FORMAT_VERSION,
      pluginId: "echo",
      pluginVersion: "1.2.3",
      driverId: "agent",
      providerDriverProtocolVersion: PROVIDER_DRIVER_PROTOCOL_VERSION,
      runtime: "node22",
      entrypoint: "driver.js",
      builtWith: { bbVersion: "0.37.0" },
    },
  } as const;

  it("accepts one exact content-addressed artifact descriptor", () => {
    expect(providerDriverArtifactDescriptorSchema.parse(descriptor)).toEqual(
      descriptor,
    );
  });

  it("rejects malformed digests, protocol skew, and extra launch fields", () => {
    expect(
      providerDriverArtifactDescriptorSchema.safeParse({
        ...descriptor,
        digest: "not-a-digest",
      }).success,
    ).toBe(false);
    expect(
      providerDriverArtifactDescriptorSchema.safeParse({
        ...descriptor,
        meta: {
          ...descriptor.meta,
          providerDriverProtocolVersion:
            descriptor.meta.providerDriverProtocolVersion + 1,
        },
      }).success,
    ).toBe(false);
    expect(
      providerDriverArtifactDescriptorSchema.safeParse({
        ...descriptor,
        command: "/tmp/untrusted",
      }).success,
    ).toBe(false);
  });
});

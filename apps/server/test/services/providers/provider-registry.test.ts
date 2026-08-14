import { afterEach, describe, expect, it } from "vitest";
import { PROVIDER_DRIVER_PROTOCOL_VERSION } from "@bb/provider-driver-contract";
import {
  getRegisteredProviderDriverLaunchSpec,
  getRegisteredProviderInfo,
  getRegisteredProviderPermissionModes,
  listRegisteredProviderInfos,
  registeredProviderSupportsManualCompaction,
  setPluginProviderContributions,
} from "../../../src/services/providers/provider-registry.js";

const artifact = {
  archivePath: "/tmp/artifact.tgz",
  sizeBytes: 1,
  descriptor: {
    digest: "a".repeat(64),
    meta: {
      artifactFormatVersion: 1 as const,
      pluginId: "echo",
      pluginVersion: "1.0.0",
      driverId: "agent",
      providerDriverProtocolVersion: PROVIDER_DRIVER_PROTOCOL_VERSION,
      runtime: "node22" as const,
      entrypoint: "driver.js" as const,
      builtWith: { bbVersion: "test" },
    },
  },
};

const registration = {
  localId: "default",
  providerId: "echo/default",
  displayName: "Echo",
  description: "Echo provider",
  capabilities: {
    supportsArchive: false,
    supportsRename: true,
    supportsServiceTier: false,
    supportsUserQuestion: false,
    supportsFork: false,
    supportedPermissionModes: ["full" as const],
  },
  composerActions: [],
  reasoningLevels: ["medium" as const],
  productCapabilities: {
    supportsWorkflows: false,
    supportsExecutionOverride: false,
    supportsManualCompaction: true,
  },
  execution: {
    kind: "host-driver" as const,
    driverId: "agent",
    config: { greeting: "hello" },
    process: { scope: "thread" as const, multiplexSessions: false },
  },
};

afterEach(() => {
  setPluginProviderContributions(undefined);
});

describe("server provider registry", () => {
  it("projects one atomically loaded plugin contribution into policy and launch data", () => {
    setPluginProviderContributions({
      listProviderContributions: () => [
        {
          pluginId: "echo",
          registration,
          artifact,
          logoUrl: "/plugins/echo/logo.svg",
        },
      ],
    });

    expect(
      listRegisteredProviderInfos().map((provider) => provider.id),
    ).toContain("echo/default");
    expect(getRegisteredProviderInfo("echo/default")).toMatchObject({
      displayName: "Echo",
      logoUrl: "/plugins/echo/logo.svg",
      available: true,
    });
    expect(getRegisteredProviderPermissionModes("echo/default")).toEqual([
      "full",
    ]);
    expect(registeredProviderSupportsManualCompaction("echo/default")).toBe(
      true,
    );
    expect(getRegisteredProviderDriverLaunchSpec("echo/default")).toEqual({
      artifact: artifact.descriptor,
      displayName: "Echo",
      capabilities: registration.capabilities,
      config: { greeting: "hello" },
      process: { scope: "thread", multiplexSessions: false },
    });
  });
});

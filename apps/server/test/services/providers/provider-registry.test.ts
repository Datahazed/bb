import { afterEach, describe, expect, it } from "vitest";
import {
  PROVIDER_DRIVER_ARTIFACT_ENTRYPOINT,
  PROVIDER_DRIVER_ARTIFACT_FORMAT_VERSION,
  PROVIDER_DRIVER_PROTOCOL_VERSION,
} from "@bb/provider-driver-contract";
import { getBuiltinProviderIdOverrides } from "../../../src/services/providers/builtin-provider-plugins.js";
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
      artifactFormatVersion: PROVIDER_DRIVER_ARTIFACT_FORMAT_VERSION,
      pluginId: "echo",
      pluginVersion: "1.0.0",
      driverId: "agent",
      providerDriverProtocolVersion: PROVIDER_DRIVER_PROTOCOL_VERSION,
      runtime: "node22" as const,
      entrypoint: PROVIDER_DRIVER_ARTIFACT_ENTRYPOINT,
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
  it("preserves stable provider ids only for their builtin plugin provenance", () => {
    expect(
      getBuiltinProviderIdOverrides({
        builtinName: "pi",
        pluginId: "pi",
      }).get("default"),
    ).toBe("pi");
    expect(
      getBuiltinProviderIdOverrides({
        builtinName: null,
        pluginId: "pi",
      }).size,
    ).toBe(0);
  });

  it("does not fall back when an installed builtin provider plugin is disabled", () => {
    setPluginProviderContributions({
      isBuiltin: (id) => id === "pi",
      listHostDriverArtifacts: () => [],
      listProviderContributions: () => [],
    });

    expect(getRegisteredProviderInfo("pi")).toBeNull();
    expect(listRegisteredProviderInfos().some(({ id }) => id === "pi")).toBe(
      false,
    );
    expect(() => getRegisteredProviderDriverLaunchSpec("pi")).toThrow(
      "pi provider driver plugin is not running",
    );
  });

  it("launches dynamic ACP providers through the builtin ACP artifact", () => {
    const acpArtifact = {
      ...artifact,
      descriptor: {
        ...artifact.descriptor,
        meta: {
          ...artifact.descriptor.meta,
          pluginId: "acp",
          driverId: "acp",
        },
      },
    };
    setPluginProviderContributions({
      isBuiltin: (id) => id === "acp",
      listHostDriverArtifacts: () => [acpArtifact],
      listProviderContributions: () => [],
    });

    expect(getRegisteredProviderDriverLaunchSpec("acp-opencode")).toMatchObject(
      {
        artifact: acpArtifact.descriptor,
        driverProviderId: "acp",
        config: {},
        process: { scope: "environment", multiplexSessions: true },
      },
    );
  });

  it("fails closed when the installed ACP plugin is not running", () => {
    setPluginProviderContributions({
      isBuiltin: (id) => id === "acp",
      listHostDriverArtifacts: () => [],
      listProviderContributions: () => [],
    });

    expect(() => getRegisteredProviderDriverLaunchSpec("acp-opencode")).toThrow(
      "ACP provider driver plugin is not running",
    );
  });

  it("projects one atomically loaded plugin contribution into policy and launch data", () => {
    setPluginProviderContributions({
      isBuiltin: () => false,
      listHostDriverArtifacts: () => [],
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
      driverProviderId: "echo/default",
      displayName: "Echo",
      capabilities: registration.capabilities,
      supportsLiveExecutionChanges: false,
      config: { greeting: "hello" },
      process: { scope: "thread", multiplexSessions: false },
    });
  });
});

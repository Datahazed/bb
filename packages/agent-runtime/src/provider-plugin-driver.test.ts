import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  PROVIDER_DRIVER_ARTIFACT_ENTRYPOINT,
  PROVIDER_DRIVER_ARTIFACT_FORMAT_VERSION,
  PROVIDER_DRIVER_PROTOCOL_VERSION,
} from "@bb/provider-driver-contract";
import type { HostDaemonProviderDriverLaunchSpec } from "@bb/host-daemon-contract";
import { createAgentRuntime } from "./runtime.js";
import {
  buildCanonicalTestDriverArgs,
  fakeProviderDriverPath,
} from "./test/runtime-with-provider-drivers.js";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("plugin provider driver launch", () => {
  it("does not fall back to statically bundled provider drivers", async () => {
    const workspacePath = await mkdtemp(join(tmpdir(), "bb-plugin-driver-"));
    temporaryRoots.push(workspacePath);
    const runtime = createAgentRuntime({
      workspacePath,
      onEvent: () => undefined,
      onToolCall: async () => ({ contentItems: [], success: true }),
    });

    try {
      await expect(runtime.listModels({ providerId: "pi" })).rejects.toThrow(
        'Provider "pi" requires a registered host-driver artifact',
      );
    } finally {
      await runtime.shutdown();
    }
  });

  it("launches a namespaced provider through a resolved artifact and releases its generation", async () => {
    const workspacePath = await mkdtemp(join(tmpdir(), "bb-plugin-driver-"));
    temporaryRoots.push(workspacePath);
    const providerId = "echo/default";
    const artifactDigest = "a".repeat(64);
    const providerDriver: HostDaemonProviderDriverLaunchSpec = {
      artifact: {
        digest: artifactDigest,
        meta: {
          artifactFormatVersion: PROVIDER_DRIVER_ARTIFACT_FORMAT_VERSION,
          pluginId: "test-plugin",
          pluginVersion: "1.0.0",
          driverId: "test-driver",
          providerDriverProtocolVersion: PROVIDER_DRIVER_PROTOCOL_VERSION,
          runtime: "node22",
          entrypoint: PROVIDER_DRIVER_ARTIFACT_ENTRYPOINT,
          builtWith: { bbVersion: "test" },
        },
      },
      driverProviderId: providerId,
      displayName: "Plugin Echo",
      capabilities: {
        supportsArchive: true,
        supportsRename: true,
        supportsServiceTier: false,
        supportsUserQuestion: true,
        supportsFork: true,
        supportedPermissionModes: ["full"],
      },
      config: { fixture: true },
      supportsLiveExecutionChanges: false,
      process: { scope: "environment", multiplexSessions: true },
    };
    let resolutions = 0;
    let releases = 0;
    const runtime = createAgentRuntime({
      workspacePath,
      threadStorageRootPath: join(workspacePath, "thread-storage"),
      onEvent: () => undefined,
      onToolCall: async () => ({ contentItems: [], success: true }),
      resolveProviderDriverLaunch: async (spec) => {
        resolutions += 1;
        expect(spec.artifact.digest).toBe(artifactDigest);
        return {
          artifactDigest,
          capabilities: spec.capabilities,
          config: spec.config,
          displayName: spec.displayName,
          identity: {
            pluginId: "test-plugin",
            driverId: "test-driver",
            providerId: spec.driverProviderId,
          },
          process: {
            command: process.execPath,
            args: buildCanonicalTestDriverArgs(fakeProviderDriverPath),
            env: { BB_TEST_PROVIDER_ID: providerId },
          },
          providerDataDir: join(workspacePath, "provider-data"),
          processCapabilities: { multiplexSessions: true },
          supportsLiveExecutionChanges: false,
          release: () => {
            releases += 1;
          },
        };
      },
    });

    try {
      const result = await runtime.listModels({ providerId, providerDriver });
      expect(result.models.length).toBeGreaterThan(0);
      await runtime.listModels({ providerId, providerDriver });
      expect(resolutions).toBe(1);

      await runtime.listModels({
        providerId,
        providerDriver: {
          ...providerDriver,
          config: { fixture: "changed" },
        },
      });
      expect(resolutions).toBe(2);
      expect(releases).toBe(0);
    } finally {
      await runtime.shutdown();
    }
    expect(releases).toBe(2);
  });
});

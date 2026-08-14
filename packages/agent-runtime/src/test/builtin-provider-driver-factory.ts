import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  buildAcpProviderInfo,
  getBuiltInAgentProviderInfo,
  isAcpProviderId,
  isAgentProviderId,
} from "@bb/agent-providers";
import type { JsonObject } from "@bb/domain";
import type { HostDaemonProviderDriverLaunchSpec } from "@bb/host-daemon-contract";
import {
  PROVIDER_DRIVER_ARTIFACT_FORMAT_VERSION,
  PROVIDER_DRIVER_ARTIFACT_RUNTIME,
  PROVIDER_DRIVER_PROTOCOL_VERSION,
} from "@bb/provider-driver-contract";
import type { RuntimeCanonicalProviderDriverLaunchSpecFactory } from "../runtime-provider-process.js";

function driverEntrySpecifier(driverId: string): string {
  switch (driverId) {
    case "acp":
      return "bb-plugin-acp/driver-entry";
    case "claude-code":
      return "bb-plugin-claude-code/driver-entry";
    case "codex":
      return "bb-plugin-codex/driver-entry";
    case "pi":
      return "bb-plugin-pi/driver-entry";
    default:
      throw new Error(`Unsupported test provider driver "${driverId}"`);
  }
}

function sourceDriverProcessArgs(specifier: string): string[] {
  const sourcePath = fileURLToPath(import.meta.resolve(specifier));
  if (!existsSync(sourcePath)) {
    throw new Error(`Missing test provider driver at ${sourcePath}`);
  }
  return sourcePath.endsWith(".ts")
    ? [
        "--conditions=source",
        "--import",
        import.meta.resolve("tsx"),
        sourcePath,
      ]
    : [sourcePath];
}

function providerInfo(providerId: string) {
  return isAgentProviderId(providerId)
    ? getBuiltInAgentProviderInfo(providerId)
    : buildAcpProviderInfo({
        id: providerId,
        displayName: providerId,
        logoUrl: null,
      });
}

export function builtinProviderDriverLaunchSpec(
  providerId: string,
  config: JsonObject = {},
): HostDaemonProviderDriverLaunchSpec {
  const driverId = isAcpProviderId(providerId) ? "acp" : providerId;
  const info = providerInfo(providerId);
  return {
    artifact: {
      digest: "a".repeat(64),
      meta: {
        artifactFormatVersion: PROVIDER_DRIVER_ARTIFACT_FORMAT_VERSION,
        driverId,
        entrypoint: "driver.ts",
        runtime: PROVIDER_DRIVER_ARTIFACT_RUNTIME,
        pluginId: driverId,
        pluginVersion: "0.1.0",
        providerDriverProtocolVersion: PROVIDER_DRIVER_PROTOCOL_VERSION,
        builtWith: { bbVersion: "test" },
      },
    },
    driverProviderId: driverId,
    displayName: info.displayName,
    capabilities: info.capabilities,
    supportsLiveExecutionChanges: providerId === "claude-code",
    config,
    process: {
      scope: driverId === "codex" ? "thread" : "environment",
      multiplexSessions: driverId !== "codex",
    },
  };
}

export function builtinProviderProcessScope(
  providerId: string,
): "environment" | "thread" {
  return providerId === "codex" ? "thread" : "environment";
}

export const builtinProviderDriverTestFactory: RuntimeCanonicalProviderDriverLaunchSpecFactory =
  (providerId) => {
    if (!isAgentProviderId(providerId) && !isAcpProviderId(providerId)) {
      throw new Error(`Unsupported test provider "${providerId}"`);
    }
    const driverId = isAcpProviderId(providerId) ? "acp" : providerId;
    const info = providerInfo(providerId);
    return {
      capabilities: info.capabilities,
      config: {},
      displayName: info.displayName,
      identity: {
        pluginId: driverId,
        driverId,
        providerId: driverId,
      },
      process: {
        command: process.execPath,
        args: sourceDriverProcessArgs(driverEntrySpecifier(driverId)),
      },
      processCapabilities: { multiplexSessions: driverId !== "codex" },
      supportsLiveExecutionChanges: providerId === "claude-code",
    };
  };

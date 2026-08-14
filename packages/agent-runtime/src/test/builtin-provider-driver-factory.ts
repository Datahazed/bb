import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildAcpProviderInfo,
  getBuiltInAgentProviderInfo,
  isAcpProviderId,
  isAgentProviderId,
} from "@bb/agent-providers";
import type { RuntimeCanonicalProviderDriverLaunchSpecFactory } from "../runtime-provider-process.js";

function sourceRelativePathForDriver(driverId: string): string {
  switch (driverId) {
    case "acp":
      return "../acp/driver-entry.js";
    case "claude-code":
      return "../claude-code/driver-entry.js";
    case "codex":
      return "../codex/driver-entry.js";
    case "pi":
      return "../pi/driver-entry.js";
    default:
      throw new Error(`Unsupported test provider driver "${driverId}"`);
  }
}

function sourceDriverProcessArgs(sourceRelativePath: string): string[] {
  const sourceJavaScriptPath = resolve(
    dirname(fileURLToPath(import.meta.url)),
    sourceRelativePath,
  );
  if (existsSync(sourceJavaScriptPath)) return [sourceJavaScriptPath];
  const sourceTypeScriptPath = sourceJavaScriptPath.replace(/\.js$/u, ".ts");
  if (!existsSync(sourceTypeScriptPath)) {
    throw new Error(`Missing test provider driver at ${sourceTypeScriptPath}`);
  }
  return [
    "--conditions=source",
    "--import",
    import.meta.resolve("tsx"),
    sourceTypeScriptPath,
  ];
}

export const builtinProviderDriverTestFactory: RuntimeCanonicalProviderDriverLaunchSpecFactory = (
  providerId,
) => {
  if (!isAgentProviderId(providerId) && !isAcpProviderId(providerId)) {
    throw new Error(`Unsupported test provider "${providerId}"`);
  }
  const driverId = isAcpProviderId(providerId) ? "acp" : providerId;
  const providerInfo = isAgentProviderId(providerId)
    ? getBuiltInAgentProviderInfo(providerId)
    : buildAcpProviderInfo({
        id: providerId,
        displayName: providerId,
        logoUrl: null,
      });
  return {
    capabilities: providerInfo.capabilities,
    config: {},
    displayName: providerInfo.displayName,
    identity: {
      pluginId: driverId,
      driverId,
      providerId: driverId,
    },
    process: {
      command: process.execPath,
      args: sourceDriverProcessArgs(sourceRelativePathForDriver(driverId)),
    },
    processCapabilities: { multiplexSessions: driverId !== "codex" },
  };
};

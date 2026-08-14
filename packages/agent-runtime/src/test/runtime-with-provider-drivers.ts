import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import type { JsonObject, ProviderCapabilities } from "@bb/domain";
import { createAgentRuntimeWithCanonicalProviderDriverFactory } from "../runtime.js";
import type {
  RuntimeCanonicalProviderDriverLaunchSpec,
  RuntimeCanonicalProviderDriverLaunchSpecFactory,
} from "../runtime-provider-process.js";
import type { AgentRuntime, AgentRuntimeOptions } from "../types.js";

const defaultCapabilities = {
  supportsArchive: true,
  supportsRename: true,
  supportsServiceTier: false,
  supportsUserQuestion: true,
  supportsFork: true,
  supportedPermissionModes: ["accept-edits", "auto", "full"],
} satisfies ProviderCapabilities;

function resolveTsxLoaderSpecifier(): string {
  return import.meta.resolve("tsx");
}

export function buildCanonicalTestDriverArgs(scriptPath: string): string[] {
  if (scriptPath.endsWith(".ts")) {
    return [
      "--conditions=source",
      "--import",
      resolveTsxLoaderSpecifier(),
      scriptPath,
    ];
  }
  return [scriptPath];
}

function resolveFakeProviderDriverPath(): string {
  const sourcePath = fileURLToPath(
    new URL("./fake-provider-driver.ts", import.meta.url),
  );
  if (!existsSync(sourcePath)) {
    throw new Error(`Missing canonical fake provider driver at ${sourcePath}`);
  }
  return sourcePath;
}

export const fakeProviderDriverPath = resolveFakeProviderDriverPath();

export interface CreateFakeCanonicalProviderDriverSpecOptions {
  capabilities?: ProviderCapabilities;
  config?: JsonObject;
  displayName?: string;
  env?: Record<string, string>;
  scriptPath?: string;
}

export function createFakeCanonicalProviderDriverSpec(
  providerId: string,
  options: CreateFakeCanonicalProviderDriverSpecOptions = {},
): RuntimeCanonicalProviderDriverLaunchSpec {
  return {
    capabilities: options.capabilities ?? defaultCapabilities,
    config: options.config ?? {},
    displayName: options.displayName ?? "Fake Provider",
    identity: { pluginId: "test-plugin", driverId: "test-driver" },
    process: {
      command: process.execPath,
      args: buildCanonicalTestDriverArgs(
        options.scriptPath ?? fakeProviderDriverPath,
      ),
      env: {
        BB_TEST_PROVIDER_ID: providerId,
        ...options.env,
      },
    },
    processCapabilities: { multiplexSessions: true },
    supportsLiveExecutionChanges: false,
  };
}

export interface AgentRuntimeWithProviderDriversOptions extends AgentRuntimeOptions {
  providerDriverFactory?: RuntimeCanonicalProviderDriverLaunchSpecFactory;
  providerProcessScope?: (providerId: string) => "environment" | "thread";
}

export function createAgentRuntimeWithProviderDrivers(
  options: AgentRuntimeWithProviderDriversOptions,
): AgentRuntime {
  const { providerDriverFactory, providerProcessScope, ...runtimeOptions } =
    options;
  return createAgentRuntimeWithCanonicalProviderDriverFactory(
    {
      ...runtimeOptions,
      threadStorageRootPath:
        runtimeOptions.threadStorageRootPath ??
        join(runtimeOptions.workspacePath, ".bb-test-thread-storage"),
    },
    providerDriverFactory ??
      ((providerId) => createFakeCanonicalProviderDriverSpec(providerId)),
    providerProcessScope,
  );
}

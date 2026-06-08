import {
  readOptionalEnvVar,
  resolveEnvLoader,
  type EnvLoaderArgs,
} from "./env.js";
import { BB_BRIDGE_DIR_ENV, BB_CLI_DIR_ENV } from "./env-vars.js";
import { assignIfDefined } from "./objects.js";

/**
 * Bundle-location env for the in-process engine (plan §5.9): where the
 * provider bridge bundles and the injected-shell `bb` CLI live. Named for the
 * daemon entrypoint it came from; Phase 3 repoints the launcher at the server
 * bundle and renames this scope.
 */
export interface HostDaemonEntrypointConfig {
  BB_BRIDGE_DIR?: string;
  BB_CLI_DIR?: string;
}

export type LoadHostDaemonEntrypointConfigArgs = EnvLoaderArgs;

export function loadHostDaemonEntrypointConfig(
  args: LoadHostDaemonEntrypointConfigArgs = {},
): HostDaemonEntrypointConfig {
  const loader = resolveEnvLoader(args);
  const config: HostDaemonEntrypointConfig = {};
  const bridgeDir = readOptionalEnvVar({
    context: loader.context,
    definition: BB_BRIDGE_DIR_ENV,
    env: loader.env,
  });
  const cliDir = readOptionalEnvVar({
    context: loader.context,
    definition: BB_CLI_DIR_ENV,
    env: loader.env,
  });

  assignIfDefined({
    key: "BB_BRIDGE_DIR",
    target: config,
    value: bridgeDir,
  });
  assignIfDefined({
    key: "BB_CLI_DIR",
    target: config,
    value: cliDir,
  });

  return config;
}

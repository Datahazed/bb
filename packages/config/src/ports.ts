import {
  readOptionalEnvVar,
  resolveEnvLoader,
  type EnvLoaderArgs,
  type EnvVarDefinition,
} from "./env.js";
import { BB_SERVER_PORT_ENV } from "./env-vars.js";
import { BB_PROD_SERVER_PORT, resolveDevInstanceConfig } from "./runtime.js";

export interface RuntimePortLoaderArgs extends EnvLoaderArgs {
  repoRoot?: string;
}

export interface RuntimePortDefaultArgs {
  homeDir: string;
  repoRoot?: string;
}

interface LoadRuntimePortValueArgs extends RuntimePortLoaderArgs {
  definition: EnvVarDefinition<number>;
  prodDefault: number;
  devDefault: number | undefined;
}

export function resolveServerPortDefault(
  args: RuntimePortDefaultArgs,
): number | undefined {
  if (args.repoRoot === undefined) {
    return undefined;
  }

  return resolveDevInstanceConfig({
    homeDir: args.homeDir,
    repoRoot: args.repoRoot,
  }).ports.serverPort;
}

export function loadRuntimePortValue(args: LoadRuntimePortValueArgs): number {
  const loader = resolveEnvLoader(args);
  const configuredPort = readOptionalEnvVar({
    context: loader.context,
    definition: args.definition,
    env: loader.env,
  });
  if (configuredPort !== undefined) {
    return configuredPort;
  }

  if (loader.mode === "prod") {
    return args.prodDefault;
  }

  if (args.devDefault !== undefined) {
    return args.devDefault;
  }

  throw new Error(
    `${args.definition.name} is required unless repoRoot is provided for development`,
  );
}

export function loadServerPortValue(args: RuntimePortLoaderArgs = {}): number {
  const loader = resolveEnvLoader(args);
  return loadRuntimePortValue({
    ...args,
    definition: BB_SERVER_PORT_ENV,
    devDefault: resolveServerPortDefault({
      homeDir: loader.context.homeDir,
      repoRoot: args.repoRoot,
    }),
    env: loader.env,
    homeDir: loader.context.homeDir,
    mode: loader.mode,
    prodDefault: BB_PROD_SERVER_PORT,
  });
}

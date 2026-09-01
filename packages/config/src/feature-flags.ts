import type { FeatureFlags } from "@bb/domain";
import {
  readEnvVarWithDefault,
  resolveEnvLoader,
  type EnvLoaderArgs,
} from "./env.js";
import { BB_FF_PLACEHOLDER_ENV, DEFAULT_BB_FF_PLACEHOLDER } from "./env-vars.js";

type LoadFeatureFlagsArgs = EnvLoaderArgs;

export function loadFeatureFlags(
  args: LoadFeatureFlagsArgs = {},
): FeatureFlags {
  const loader = resolveEnvLoader(args);
  return {
    placeholder: readEnvVarWithDefault({
      context: loader.context,
      defaultValue: DEFAULT_BB_FF_PLACEHOLDER,
      definition: BB_FF_PLACEHOLDER_ENV,
      env: loader.env,
    }),
  };
}

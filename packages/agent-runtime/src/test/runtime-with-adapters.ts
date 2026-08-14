import type { ProviderAdapterFactory } from "./provider-adapter.js";
import { LegacyAdapterConnection } from "./legacy-adapter-connection.js";
import { createAgentRuntimeWithProviderProcessFactory } from "../runtime.js";
import type { RuntimeProviderProcessLaunchSpecFactory } from "../runtime-provider-process.js";
import type { AgentRuntime, AgentRuntimeOptions } from "../types.js";

export interface AgentRuntimeWithAdaptersOptions extends AgentRuntimeOptions {
  adapterFactory: ProviderAdapterFactory;
}

export function createLegacyProviderProcessLaunchSpecFactory(
  adapterFactory: ProviderAdapterFactory,
): RuntimeProviderProcessLaunchSpecFactory {
  return (providerId, factoryOptions) => {
    const adapter = adapterFactory(providerId, factoryOptions);
    return {
      process: adapter.process,
      createConnection: ({ child, getNextRequestId }) =>
        new LegacyAdapterConnection({
          adapter,
          child,
          getNextRequestId,
        }),
    };
  };
}

/** Test-only compatibility harness for legacy adapter fixtures. */
export function createAgentRuntimeWithAdapters(
  options: AgentRuntimeWithAdaptersOptions,
): AgentRuntime {
  const { adapterFactory, ...runtimeOptions } = options;
  return createAgentRuntimeWithProviderProcessFactory(
    runtimeOptions,
    createLegacyProviderProcessLaunchSpecFactory(adapterFactory),
  );
}

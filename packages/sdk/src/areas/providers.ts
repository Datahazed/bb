import type {
  SystemExecutionOptionsQuery,
  SystemExecutionOptionsResponse,
  SystemProviderInfo,
} from "@bb/server-contract";
import type { CreateSdkAreaArgs } from "./common.js";

export interface ProviderModelsArgs extends SystemExecutionOptionsQuery {}

export type ProviderListResult = SystemProviderInfo[];
export type ProviderModelsResult = SystemExecutionOptionsResponse;

export interface ProvidersArea {
  list(): Promise<ProviderListResult>;
  models(args?: ProviderModelsArgs): Promise<ProviderModelsResult>;
}

export function createProvidersArea(args: CreateSdkAreaArgs): ProvidersArea {
  const { transport } = args;
  return {
    async list() {
      return transport.readJson(transport.api.v1.system.providers.$get());
    },
    async models(input = {}) {
      return transport.readJson(
        transport.api.v1.system["execution-options"].$get({
          query: input,
        }),
      );
    },
  };
}

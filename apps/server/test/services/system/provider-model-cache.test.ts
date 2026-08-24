import { describe, expect, it, vi } from "vitest";
import { createLifecycleDedupers } from "../../../src/lifecycle-dedupers.js";
import { publishProviderModelsChanged } from "../../../src/services/system/provider-model-cache.js";

describe("provider model cache invalidation", () => {
  it("drops settled catalogs and notifies picker clients", async () => {
    const { providerModelList } = createLifecycleDedupers();
    const firstProbe = vi.fn(async () => ({
      models: [],
      selectedOnlyModels: [],
    }));
    await providerModelList.run("host-1:pi", firstProbe);
    await providerModelList.run("host-1:pi", firstProbe);
    expect(firstProbe).toHaveBeenCalledOnce();
    const notifySystem = vi.fn();

    publishProviderModelsChanged({ providerModelList, notifySystem });

    const secondProbe = vi.fn(async () => ({
      models: [],
      selectedOnlyModels: [],
    }));
    await providerModelList.run("host-1:pi", secondProbe);
    expect(secondProbe).toHaveBeenCalledOnce();
    expect(notifySystem).toHaveBeenCalledWith(["provider-models-changed"]);
  });
});

import { describe, expect, it } from "vitest";
import { existingThreadExecutionInputSourcesSchema } from "@bb/server-contract";
import { buildExecutionInputSources } from "./selection-state";

describe("buildExecutionInputSources", () => {
  it("keeps provider mode out of existing-thread source data", () => {
    const sources = buildExecutionInputSources({
      scope: "component-local",
      effectiveValues: {
        selectedProviderId: "acp-opencode",
        selectedModel: "openai/gpt-5",
        providerMode: "orchestrator",
        serviceTier: undefined,
        reasoningLevel: "high",
        permissionMode: "full",
      },
      storedValues: {
        selectedProviderId: "",
        selectedModel: "",
        providerMode: "",
        serviceTier: "",
        reasoningLevel: "",
        permissionMode: "",
      },
      touchedFields: new Set(["providerMode"]),
    });

    expect(sources).not.toHaveProperty("providerMode");
    expect(existingThreadExecutionInputSourcesSchema.parse(sources)).toEqual(
      sources,
    );
  });
});

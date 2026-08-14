import { describe, expect, it } from "vitest";
import type { RuntimeThreadExecutionOptions } from "@bb/domain";
import {
  classifyLiveExecutionSettingsChange,
  classifySessionExecutionSettingsChange,
} from "./execution-options.js";

const baseOptions = {
  model: "model-1",
  serviceTier: "default",
  reasoningLevel: "high",
  providerOptions: {},
  planModeEnabled: false,
  workflowsEnabled: true,
  memoryEnabled: true,
  providerSubagentsEnabled: true,
  permissionMode: "auto",
  permissionScope: "workspace",
  approvalReviewer: "automatic",
  permissionEscalation: "ask",
} satisfies RuntimeThreadExecutionOptions;

describe("execution setting classification", () => {
  it("classifies driver-declared turn-mutable settings as live", () => {
    const liveChanges: RuntimeThreadExecutionOptions[] = [
      { ...baseOptions, model: "model-2" },
      { ...baseOptions, reasoningLevel: "max" },
      { ...baseOptions, workflowsEnabled: false },
      { ...baseOptions, memoryEnabled: false },
      { ...baseOptions, providerSubagentsEnabled: false },
      { ...baseOptions, permissionEscalation: "deny" },
    ];

    for (const next of liveChanges) {
      expect(
        classifyLiveExecutionSettingsChange({ current: baseOptions, next }),
      ).toBe("live");
    }
  });

  it("keeps construction settings session-scoped", () => {
    const sessionChanges: RuntimeThreadExecutionOptions[] = [
      { ...baseOptions, serviceTier: "fast" },
      { ...baseOptions, planModeEnabled: true },
      { ...baseOptions, providerOptions: { endpoint: "test" } },
      {
        ...baseOptions,
        permissionMode: "full",
        permissionScope: "full",
        approvalReviewer: null,
        permissionEscalation: null,
      },
    ];

    for (const next of sessionChanges) {
      expect(
        classifyLiveExecutionSettingsChange({ current: baseOptions, next }),
      ).toBe("session");
    }
  });

  it("keeps every change session-scoped without live controls", () => {
    expect(
      classifySessionExecutionSettingsChange({
        current: baseOptions,
        next: { ...baseOptions, model: "another-model" },
      }),
    ).toBe("session");
  });
});

import { describe, expect, it } from "vitest";
import {
  acpLaunchConfigSchema,
  normalizeAcpLaunchConfig,
} from "./launch-config.js";

describe("ACP launch config", () => {
  it("drops empty model CLI configuration at the plugin boundary", () => {
    const parsed = acpLaunchConfigSchema.parse({
      displayName: "Custom ACP",
      command: "custom-agent",
      args: [],
      env: {},
      modelCli: {
        listArgs: [],
        selectFlag: "--model",
        primaryModels: ["model-a"],
      },
      reasoningCli: {
        flag: "--reasoning-effort",
        supportedLevels: ["low", "medium", "high"],
        levelValues: { max: "high" },
        defaultLevel: "high",
      },
    });

    expect(normalizeAcpLaunchConfig(parsed)).toEqual({
      displayName: "Custom ACP",
      command: "custom-agent",
      args: [],
      env: {},
      reasoningCli: {
        flag: "--reasoning-effort",
        supportedLevels: ["low", "medium", "high"],
        levelValues: { max: "high" },
        defaultLevel: "high",
      },
    });
  });
});

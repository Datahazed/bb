import { describe, expect, it } from "vitest";
import {
  encodeTargetValue,
  parseEnvironmentValue,
} from "./environment-picker-value";

describe("target environment values", () => {
  it("round-trips a plugin id containing dashes", () => {
    const value = encodeTargetValue("docker-sandbox", "container");
    expect(value).toBe("target:docker-sandbox/container");
    expect(parseEnvironmentValue(value)).toEqual({
      type: "target",
      pluginId: "docker-sandbox",
      targetId: "container",
    });
  });

  it("round-trips target ids with underscores and digits", () => {
    const value = encodeTargetValue("worktree", "wt_2");
    expect(parseEnvironmentValue(value)).toEqual({
      type: "target",
      pluginId: "worktree",
      targetId: "wt_2",
    });
  });

  it("rejects a value whose plugin half contains a slash because plugin ids never contain one", () => {
    expect(parseEnvironmentValue("target:a/b/c")).toBeNull();
  });

  it("rejects malformed target values", () => {
    expect(parseEnvironmentValue("target:")).toBeNull();
    expect(parseEnvironmentValue("target:worktree")).toBeNull();
    expect(parseEnvironmentValue("target:/container")).toBeNull();
    expect(parseEnvironmentValue("target:worktree/")).toBeNull();
    expect(parseEnvironmentValue("target:worktree/bad*id")).toBeNull();
    expect(
      parseEnvironmentValue(`target:worktree/${"a".repeat(65)}`),
    ).toBeNull();
  });
});

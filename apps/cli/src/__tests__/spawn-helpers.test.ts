import { describe, expect, it } from "vitest";
import {
  buildSpawnEnvironment,
  looksLikePath,
  resolveSpawnEnvironmentValue,
} from "../commands/thread/spawn.js";
import {
  parseThreadWaitTimeoutSeconds,
  parseThreadWaitPollIntervalMs,
  parseServiceTier,
  parsePermissionMode,
  DEFAULT_THREAD_WAIT_TIMEOUT_SECONDS,
  DEFAULT_THREAD_WAIT_POLL_INTERVAL_MS,
  PERMISSION_MODE_HELP,
} from "../commands/thread/helpers.js";

describe("looksLikePath", () => {
  it("returns true for absolute paths", () => {
    expect(looksLikePath("/absolute/path")).toBe(true);
  });

  it("returns true for relative paths starting with ./", () => {
    expect(looksLikePath("./relative")).toBe(true);
  });

  it("returns true for home-relative paths starting with ~", () => {
    expect(looksLikePath("~/home/dir")).toBe(true);
  });

  it("returns true for parent-relative paths starting with ../", () => {
    expect(looksLikePath("../parent")).toBe(true);
  });

  it("returns true for paths containing slashes", () => {
    expect(looksLikePath("some/nested/dir")).toBe(true);
  });

  it("returns false for bare words", () => {
    expect(looksLikePath("worktree")).toBe(false);
    expect(looksLikePath("docker")).toBe(false);
  });
});

describe("resolveSpawnEnvironmentValue", () => {
  it("passes path-shaped values through without id validation", () => {
    expect(resolveSpawnEnvironmentValue("/tmp/some/repo")).toBe(
      "/tmp/some/repo",
    );
    expect(resolveSpawnEnvironmentValue("./relative")).toBe("./relative");
    expect(resolveSpawnEnvironmentValue("~/home/dir")).toBe("~/home/dir");
  });

  it("validates id-shaped values as ids", () => {
    expect(resolveSpawnEnvironmentValue("env_abc123")).toBe("env_abc123");
    expect(() => resolveSpawnEnvironmentValue("not an id")).toThrow(
      "--environment flag",
    );
  });

  it("returns undefined for missing or blank values", () => {
    expect(resolveSpawnEnvironmentValue(undefined)).toBeUndefined();
    expect(resolveSpawnEnvironmentValue("   ")).toBeUndefined();
  });
});

describe("buildSpawnEnvironment", () => {
  it("returns unmanaged host with null path when no flags are provided", () => {
    const result = buildSpawnEnvironment({
      defaultPersonalWorkspace: false,
    });
    expect(result).toEqual({
      type: "host",
      hostId: "local",
      workspace: { type: "unmanaged", path: null },
    });
  });

  it("returns personal workspace when personal project defaults are active", () => {
    const result = buildSpawnEnvironment({
      defaultPersonalWorkspace: true,
    });
    expect(result).toEqual({
      type: "host",
      hostId: "local",
      workspace: { type: "personal" },
    });
  });

  it("returns managed-worktree for --new-environment worktree", () => {
    const result = buildSpawnEnvironment({
      defaultPersonalWorkspace: false,
      newEnvironmentKind: "worktree",
    });
    expect(result).toEqual({
      type: "host",
      hostId: "local",
      workspace: {
        type: "managed-worktree",
        baseBranch: { kind: "default" },
      },
    });
  });

  it("returns named base branch for --base-branch with managed worktrees", () => {
    const result = buildSpawnEnvironment({
      defaultPersonalWorkspace: false,
      newEnvironmentKind: "worktree",
      baseBranch: "release-1.2",
    });
    expect(result).toEqual({
      type: "host",
      hostId: "local",
      workspace: {
        type: "managed-worktree",
        baseBranch: { kind: "named", name: "release-1.2" },
      },
    });
  });

  it("throws for unknown --new-environment kind", () => {
    expect(() =>
      buildSpawnEnvironment({
        defaultPersonalWorkspace: false,
        newEnvironmentKind: "docker",
      }),
    ).toThrow("Unknown environment kind 'docker'");
  });

  it("throws when combining --environment with --new-environment", () => {
    expect(() =>
      buildSpawnEnvironment({
        defaultPersonalWorkspace: false,
        environmentValue: "some-env-id",
        newEnvironmentKind: "docker",
      }),
    ).toThrow("Cannot combine --environment with --new-environment");
  });

  it("returns unmanaged host with path for path-like --environment", () => {
    const result = buildSpawnEnvironment({
      defaultPersonalWorkspace: false,
      environmentValue: "/absolute/workspace",
    });
    expect(result).toEqual({
      type: "host",
      hostId: "local",
      workspace: { type: "unmanaged", path: "/absolute/workspace" },
    });
  });

  it("returns unmanaged host with path for relative --environment", () => {
    const result = buildSpawnEnvironment({
      defaultPersonalWorkspace: false,
      environmentValue: "./my-project",
    });
    expect(result).toEqual({
      type: "host",
      hostId: "local",
      workspace: { type: "unmanaged", path: "./my-project" },
    });
  });

  it("returns reuse for non-path --environment (UUID)", () => {
    const result = buildSpawnEnvironment({
      defaultPersonalWorkspace: false,
      environmentValue: "env-uuid-123",
    });
    expect(result).toEqual({
      type: "reuse",
      environmentId: "env-uuid-123",
    });
  });

  it("trims whitespace from environment values", () => {
    const result = buildSpawnEnvironment({
      defaultPersonalWorkspace: false,
      newEnvironmentKind: "  worktree  ",
    });
    expect(result).toEqual({
      type: "host",
      hostId: "local",
      workspace: {
        type: "managed-worktree",
        baseBranch: { kind: "default" },
      },
    });
  });
});

describe("parseThreadWaitTimeoutSeconds", () => {
  it("returns default when undefined", () => {
    expect(parseThreadWaitTimeoutSeconds(undefined)).toBe(
      DEFAULT_THREAD_WAIT_TIMEOUT_SECONDS,
    );
  });

  it("returns parsed number for valid input", () => {
    expect(parseThreadWaitTimeoutSeconds("60")).toBe(60);
    expect(parseThreadWaitTimeoutSeconds("0")).toBe(0);
    expect(parseThreadWaitTimeoutSeconds("1.5")).toBe(1.5);
  });

  it("throws for negative numbers", () => {
    expect(() => parseThreadWaitTimeoutSeconds("-1")).toThrow(
      "non-negative number",
    );
  });

  it("throws for non-numeric strings", () => {
    expect(() => parseThreadWaitTimeoutSeconds("abc")).toThrow(
      "non-negative number",
    );
  });
});

describe("parseThreadWaitPollIntervalMs", () => {
  it("returns default when undefined", () => {
    expect(parseThreadWaitPollIntervalMs(undefined)).toBe(
      DEFAULT_THREAD_WAIT_POLL_INTERVAL_MS,
    );
  });

  it("returns parsed integer for valid input", () => {
    expect(parseThreadWaitPollIntervalMs("500")).toBe(500);
    expect(parseThreadWaitPollIntervalMs("1")).toBe(1);
  });

  it("throws for zero", () => {
    expect(() => parseThreadWaitPollIntervalMs("0")).toThrow(
      "positive integer",
    );
  });

  it("throws for negative numbers", () => {
    expect(() => parseThreadWaitPollIntervalMs("-100")).toThrow(
      "positive integer",
    );
  });
});

describe("parseServiceTier", () => {
  it("returns undefined when undefined", () => {
    expect(parseServiceTier(undefined)).toBeUndefined();
  });

  it("returns 'fast' for 'fast'", () => {
    expect(parseServiceTier("fast")).toBe("fast");
  });

  it("returns 'default' for 'default'", () => {
    expect(parseServiceTier("default")).toBe("default");
  });

  it("throws for invalid tier", () => {
    expect(() => parseServiceTier("turbo")).toThrow("Invalid service tier");
  });
});

describe("parsePermissionMode", () => {
  it("returns undefined when undefined", () => {
    expect(parsePermissionMode(undefined)).toBeUndefined();
  });

  it("returns 'workspace-write' for 'workspace-write'", () => {
    expect(parsePermissionMode("workspace-write")).toBe("workspace-write");
  });

  it("returns 'readonly' for 'readonly'", () => {
    expect(parsePermissionMode("readonly")).toBe("readonly");
  });

  it("returns 'full' for 'full'", () => {
    expect(parsePermissionMode("full")).toBe("full");
  });

  it("throws for invalid mode", () => {
    expect(() => parsePermissionMode("readwrite")).toThrow(
      "Invalid permission mode 'readwrite'. Expected full, workspace-write, or readonly.",
    );
  });

  it("exposes user-facing help in product terms", () => {
    expect(PERMISSION_MODE_HELP).toBe(
      "Permission mode: full, workspace-write, or readonly",
    );
  });
});

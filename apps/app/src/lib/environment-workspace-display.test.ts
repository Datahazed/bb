import { describe, expect, it } from "vitest";
import {
  getEnvironmentWorkspaceSummaryDisplay,
  getEnvironmentWorkspaceTypeLabel,
  shouldShowWorktreeMachineInComposer,
} from "./environment-workspace-display";

describe("getEnvironmentWorkspaceTypeLabel", () => {
  it.each([
    ["managed-worktree", "local", "Local worktree"],
    ["unmanaged-worktree", "remote", "Remote worktree"],
    ["other", "local", "Local"],
    ["other", "remote", "Remote"],
  ] as const)("maps %s on a %s host to %s", (kind, locality, expected) => {
    expect(getEnvironmentWorkspaceTypeLabel(kind, locality)).toBe(expected);
  });
});

describe("getEnvironmentWorkspaceSummaryDisplay", () => {
  it("keeps provisioning ahead of host and worktree classification", () => {
    expect(
      getEnvironmentWorkspaceSummaryDisplay({
        display: {
          modeLabel: "Provisioning",
          compactModeLabel: "Provisioning",
          lifecycle: "provisioning",
          id: "env_test",
          mode: "direct",
          workspaceDisplayKind: "managed-worktree",
        },
        environmentName: null,
        locality: "remote",
      }),
    ).toEqual({
      label: "Provisioning",
      compactLabel: "Provisioning",
      icon: "Loading",
      typeLabel: undefined,
    });
  });

  it("does not use the worktree type as an unnamed worktree label", () => {
    expect(
      getEnvironmentWorkspaceSummaryDisplay({
        display: {
          modeLabel: "Worktree",
          compactModeLabel: "Worktree",
          lifecycle: null,
          id: "env_test",
          mode: "worktree",
          workspaceDisplayKind: "managed-worktree",
        },
        environmentName: null,
        locality: "remote",
      }),
    ).toMatchObject({
      label: undefined,
      compactLabel: undefined,
      icon: "FolderGit",
      typeLabel: "Remote worktree",
    });
  });

  it("uses the custom worktree name as the primary label", () => {
    expect(
      getEnvironmentWorkspaceSummaryDisplay({
        display: {
          modeLabel: "Design system polish",
          compactModeLabel: "Design system polish",
          lifecycle: null,
          id: "env_test",
          mode: "worktree",
          workspaceDisplayKind: "managed-worktree",
        },
        environmentName: "Design system polish",
        locality: "remote",
      }),
    ).toMatchObject({
      label: "Design system polish",
      compactLabel: "Design system polish",
    });
  });

  it("does not present a machine name as an unnamed direct environment", () => {
    expect(
      getEnvironmentWorkspaceSummaryDisplay({
        display: {
          modeLabel: "Working locally",
          compactModeLabel: "Local",
          lifecycle: null,
          id: "env_test",
          mode: "direct",
          workspaceDisplayKind: "other",
        },
        environmentName: null,
        locality: "local",
      }),
    ).toMatchObject({
      label: undefined,
      compactLabel: undefined,
      icon: "Laptop",
      typeLabel: "Local",
    });
  });
});

describe("shouldShowWorktreeMachineInComposer", () => {
  it("hides the only connected local machine", () => {
    expect(
      shouldShowWorktreeMachineInComposer({
        connected: true,
        locality: "local",
        machineCount: 1,
      }),
    ).toBe(false);
  });

  it.each([
    { connected: true, locality: "remote", machineCount: 1 },
    { connected: true, locality: "local", machineCount: 2 },
    { connected: false, locality: "local", machineCount: 1 },
  ] as const)("shows salient machine context for %o", (input) => {
    expect(shouldShowWorktreeMachineInComposer(input)).toBe(true);
  });
});

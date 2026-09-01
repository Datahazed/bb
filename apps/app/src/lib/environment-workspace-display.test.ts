import { describe, expect, it } from "vitest";
import {
  getEnvironmentWorkspaceSummaryDisplay,
  getEnvironmentWorkspaceTypeLabel,
  shouldShowWorktreeMachineInComposer,
} from "./environment-workspace-display";

describe("getEnvironmentWorkspaceTypeLabel", () => {
  it.each([
    ["managed-worktree", "Worktree"],
    ["unmanaged-worktree", "Worktree"],
    ["other", "Machine"],
  ] as const)("maps %s to %s", (kind, expected) => {
    expect(getEnvironmentWorkspaceTypeLabel(kind)).toBe(expected);
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
      }),
    ).toEqual({
      label: "Provisioning",
      icon: "Loading",
      typeLabel: "Worktree",
    });
  });

  it("uses the host for a worktree without a custom name", () => {
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
        hostName: "Build Mac mini",
      }),
    ).toMatchObject({
      label: "Build Mac mini",
      icon: "FolderGit",
      typeLabel: "Worktree",
    });
  });

  it("preserves a real custom worktree name", () => {
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
      }),
    ).toMatchObject({
      label: "Design system polish",
    });
  });
});

describe("shouldShowWorktreeMachineInComposer", () => {
  it.each([
    [true, true, "local", 1, false],
    [true, false, "remote", 2, false],
    [true, true, "remote", 1, true],
    [false, true, "local", 1, true],
  ] as const)(
    "maps connected=%s named=%s locality=%s count=%s to %s",
    (connected, hasCustomName, locality, machineCount, expected) => {
      expect(
        shouldShowWorktreeMachineInComposer({
          connected,
          hasCustomName,
          locality,
          machineCount,
        }),
      ).toBe(expected);
    },
  );
});

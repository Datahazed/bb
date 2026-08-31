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

  it("uses the machine name as an unnamed worktree fallback without changing its type", () => {
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
        locality: "remote",
      }),
    ).toMatchObject({
      label: "Build Mac mini",
      compactLabel: "Build Mac mini",
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

  it("uses the machine name and machine icon for a direct environment", () => {
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
        hostName: "Bersabel's MacBook Pro",
        locality: "local",
      }),
    ).toMatchObject({
      label: "Bersabel's MacBook Pro",
      compactLabel: "Bersabel's MacBook Pro",
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
        hasCustomName: true,
        locality: "local",
        machineCount: 1,
      }),
    ).toBe(false);
  });

  it("does not render an unnamed worktree fallback as a separate machine", () => {
    expect(
      shouldShowWorktreeMachineInComposer({
        connected: true,
        hasCustomName: false,
        locality: "remote",
        machineCount: 2,
      }),
    ).toBe(false);
  });

  it.each([
    {
      connected: true,
      hasCustomName: true,
      locality: "remote",
      machineCount: 1,
    },
    {
      connected: true,
      hasCustomName: true,
      locality: "local",
      machineCount: 2,
    },
    {
      connected: false,
      hasCustomName: true,
      locality: "local",
      machineCount: 1,
    },
  ] as const)("shows salient machine context for %o", (input) => {
    expect(shouldShowWorktreeMachineInComposer(input)).toBe(true);
  });
});

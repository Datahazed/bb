import type { EnvironmentWorkspaceDisplayKind } from "@bb/domain";
import type { EnvironmentDisplayInfo } from "@bb/core-ui";
import type { IconName } from "@bb/shared-ui/icon";
import { PersistentHostIconName } from "@/lib/host-display";

export type EnvironmentWorkspaceTypeLabel =
  | "Local worktree"
  | "Remote worktree"
  | "Local"
  | "Remote";

interface EnvironmentWorkspaceSummaryDisplayArgs {
  display: EnvironmentDisplayInfo;
  environmentName: string | null;
  locality: "local" | "remote";
}

export interface EnvironmentWorkspaceSummaryDisplay {
  label: string | undefined;
  compactLabel: string | undefined;
  icon: IconName;
  typeLabel: EnvironmentWorkspaceTypeLabel | undefined;
}

interface WorktreeMachineComposerVisibilityArgs {
  connected: boolean;
  locality: "local" | "remote";
  machineCount: number;
}

export function shouldShowWorktreeMachineInComposer({
  connected,
  locality,
  machineCount,
}: WorktreeMachineComposerVisibilityArgs): boolean {
  return locality === "remote" || machineCount > 1 || !connected;
}

export function getEnvironmentWorkspaceSummaryDisplay({
  display,
  environmentName,
  locality,
}: EnvironmentWorkspaceSummaryDisplayArgs): EnvironmentWorkspaceSummaryDisplay {
  if (display.lifecycle === "provisioning") {
    return {
      label: "Provisioning",
      compactLabel: "Provisioning",
      icon: "Loading",
      typeLabel: undefined,
    };
  }

  const isWorktree = display.mode === "worktree";

  return {
    label: isWorktree ? display.modeLabel : (environmentName ?? undefined),
    compactLabel: isWorktree
      ? display.compactModeLabel
      : (environmentName ?? undefined),
    icon: getEnvironmentWorkspaceLabelIconName(display.workspaceDisplayKind),
    typeLabel: getEnvironmentWorkspaceTypeLabel(
      display.workspaceDisplayKind,
      locality,
    ),
  };
}

export function getEnvironmentWorkspaceTypeLabel(
  kind: EnvironmentWorkspaceDisplayKind,
  locality: "local" | "remote",
): EnvironmentWorkspaceTypeLabel {
  if (kind === "other") {
    return locality === "local" ? "Local" : "Remote";
  }
  return locality === "local" ? "Local worktree" : "Remote worktree";
}

export function getEnvironmentWorkspaceDisplayIconName(
  kind: EnvironmentWorkspaceDisplayKind,
): IconName | null {
  switch (kind) {
    case "managed-worktree":
      return "FolderGit";
    case "unmanaged-worktree":
      return "FolderGit";
    case "other":
      return null;
  }
}

export function getEnvironmentWorkspaceLabelIconName(
  kind: EnvironmentWorkspaceDisplayKind,
): IconName {
  return getEnvironmentWorkspaceDisplayIconName(kind) ?? PersistentHostIconName;
}

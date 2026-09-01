import type { EnvironmentWorkspaceDisplayKind } from "@bb/domain";
import type { EnvironmentDisplayInfo } from "@bb/core-ui";
import type { IconName } from "@bb/shared-ui/icon";
import { PersistentHostIconName } from "@/lib/host-display";

export type EnvironmentWorkspaceTypeLabel = "Worktree" | "Machine";

interface EnvironmentWorkspaceSummaryDisplayArgs {
  display: EnvironmentDisplayInfo;
  environmentName: string | null;
  hostName?: string;
}

export interface EnvironmentWorkspaceSummaryDisplay {
  label: string | undefined;
  icon: IconName;
  typeLabel: EnvironmentWorkspaceTypeLabel | undefined;
}

interface WorktreeMachineComposerVisibilityArgs {
  connected: boolean;
  hasCustomName: boolean;
  locality: "local" | "remote";
  machineCount: number;
}

export function shouldShowWorktreeMachineInComposer({
  connected,
  hasCustomName,
  locality,
  machineCount,
}: WorktreeMachineComposerVisibilityArgs): boolean {
  return (
    hasCustomName && (locality === "remote" || machineCount > 1 || !connected)
  );
}

export function getEnvironmentWorkspaceSummaryDisplay({
  display,
  environmentName,
  hostName,
}: EnvironmentWorkspaceSummaryDisplayArgs): EnvironmentWorkspaceSummaryDisplay {
  const typeLabel = getEnvironmentWorkspaceTypeLabel(
    display.workspaceDisplayKind,
  );

  if (display.lifecycle === "provisioning") {
    return {
      label: "Provisioning",
      icon: "Loading",
      typeLabel,
    };
  }

  return {
    label:
      typeLabel === "Machine" || environmentName === null
        ? hostName
        : environmentName,
    icon: getEnvironmentWorkspaceLabelIconName(display.workspaceDisplayKind),
    typeLabel,
  };
}

export function getEnvironmentWorkspaceTypeLabel(
  kind: EnvironmentWorkspaceDisplayKind,
): EnvironmentWorkspaceTypeLabel {
  if (kind === "other") {
    return "Machine";
  }
  return "Worktree";
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

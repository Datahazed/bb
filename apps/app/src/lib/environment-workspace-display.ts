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
  hostName?: string;
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

  const environmentSummaryLabel =
    display.mode === "direct" || environmentName === null
      ? hostName
      : environmentName;

  return {
    label: environmentSummaryLabel,
    compactLabel: environmentSummaryLabel,
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

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

interface EnvironmentContextDisplay {
  customName: string | null;
  lifecycleLabel: string | null;
  machineName: string | undefined;
  resourceIcon: IconName;
  typeLabel: EnvironmentWorkspaceTypeLabel;
}

export interface EnvironmentWorkspaceSummaryDisplay {
  label: string | undefined;
  icon: IconName;
  typeLabel: EnvironmentWorkspaceTypeLabel | undefined;
}

export interface EnvironmentWorkspaceInfoDisplay {
  icon: IconName;
  label: "Environment";
  title: string;
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
  const context = getEnvironmentContextDisplay({
    display,
    environmentName,
    hostName,
  });

  if (context.lifecycleLabel === "Provisioning") {
    return {
      label: context.lifecycleLabel,
      icon: "Loading",
      typeLabel: context.typeLabel,
    };
  }

  const environmentSummaryLabel =
    context.typeLabel === "Machine" || context.customName === null
      ? context.machineName
      : context.customName;

  return {
    label: environmentSummaryLabel,
    icon: context.resourceIcon,
    typeLabel: context.typeLabel,
  };
}

export function getEnvironmentWorkspaceInfoDisplay({
  display,
  environmentName,
}: Omit<
  EnvironmentWorkspaceSummaryDisplayArgs,
  "hostName"
>): EnvironmentWorkspaceInfoDisplay | null {
  const context = getEnvironmentContextDisplay({
    display,
    environmentName,
  });
  if (context.typeLabel !== "Worktree") return null;

  return {
    icon: context.resourceIcon,
    label: "Environment",
    title: [context.typeLabel, context.customName, context.lifecycleLabel]
      .filter((value) => Boolean(value))
      .join(" · "),
  };
}

function getEnvironmentContextDisplay({
  display,
  environmentName,
  hostName,
}: EnvironmentWorkspaceSummaryDisplayArgs): EnvironmentContextDisplay {
  return {
    customName: environmentName,
    lifecycleLabel: display.lifecycle === null ? null : display.modeLabel,
    machineName: hostName,
    resourceIcon: getEnvironmentWorkspaceLabelIconName(
      display.workspaceDisplayKind,
    ),
    typeLabel: getEnvironmentWorkspaceTypeLabel(display.workspaceDisplayKind),
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

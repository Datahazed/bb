import { memo } from "react";
import { OptionDisplay } from "@bb/shared-ui/option-display";
import { copyToClipboardWithToast } from "@/lib/clipboard";
import { Icon, type IconName } from "@bb/shared-ui/icon";
import { Tooltip, TooltipContent, TooltipTrigger } from "@bb/shared-ui/tooltip";
import { cn } from "@bb/shared-ui/lib/utils";
import { CHROME_SUBTLE_ICON_BUTTON_FOREGROUND_CLASS } from "@bb/shared-ui/chrome-style-tokens";
import type { EnvironmentWorkspaceTypeLabel } from "@/lib/environment-workspace-display";
import type { WorkspaceCheckoutDisplay } from "@/lib/workspace-checkout-display";

const CHECKOUT_CHIP_BASE_CLASS_NAME =
  "flex min-w-0 flex-1 items-center gap-1 rounded-md px-1.5 py-0.5 text-xs text-muted-foreground";
const CHECKOUT_CHIP_BUTTON_CLASS_NAME = `${CHECKOUT_CHIP_BASE_CLASS_NAME} cursor-pointer transition-colors hover:bg-state-hover hover:text-foreground`;

interface ThreadEnvironmentSummaryProps {
  projectName?: string;
  environmentLabel?: string;
  environmentCompactLabel?: string;
  environmentIcon?: IconName;
  environmentTypeLabel?: EnvironmentWorkspaceTypeLabel;
  environmentCheckout?: WorkspaceCheckoutDisplay;
  machineName?: string;
  machineConnected?: boolean;
  onRenameWorktree?: () => void;
  renameWorktreePending?: boolean;
  onCreateNewThreadInWorktree?: () => void;
}

export const ThreadEnvironmentSummary = memo(function ThreadEnvironmentSummary({
  projectName,
  environmentLabel,
  environmentCompactLabel,
  environmentIcon,
  environmentTypeLabel,
  environmentCheckout,
  machineName,
  machineConnected = true,
  onRenameWorktree,
  renameWorktreePending = false,
  onCreateNewThreadInWorktree,
}: ThreadEnvironmentSummaryProps) {
  const isWorktree = environmentTypeLabel?.endsWith("worktree") ?? false;
  if (
    !projectName &&
    !environmentLabel &&
    !environmentCheckout &&
    !machineName &&
    !onRenameWorktree &&
    !onCreateNewThreadInWorktree
  ) {
    return null;
  }

  const checkoutCopyValue = environmentCheckout?.copyValue ?? null;
  const worktreeName = environmentLabel ?? "Add name";
  return (
    <div className="flex min-w-0 max-w-full items-center gap-2 pr-1.5">
      {projectName ? (
        <span data-promptbox-secondary-context="" className="contents">
          <OptionDisplay
            label="Project"
            value={projectName}
            compactValue={projectName}
            leading={<Icon name="Folder" className="size-4 shrink-0" />}
            className="h-6 min-w-0 max-w-[10rem] shrink"
            tooltip={projectName}
            muted
          />
        </span>
      ) : null}
      {environmentLabel || (isWorktree && onRenameWorktree) ? (
        <div
          data-promptbox-worktree-context={isWorktree ? "" : undefined}
          className="inline-flex h-6 w-fit max-w-full min-w-0 shrink items-center justify-start gap-1.5 px-1 text-xs leading-tight text-muted-foreground"
        >
          {environmentIcon && environmentTypeLabel ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <span
                  role="img"
                  tabIndex={0}
                  aria-label={`Environment type: ${environmentTypeLabel}`}
                  className="inline-flex size-4 shrink-0 items-center justify-center rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                >
                  <Icon name={environmentIcon} className="size-4" />
                </span>
              </TooltipTrigger>
              <TooltipContent>{environmentTypeLabel}</TooltipContent>
            </Tooltip>
          ) : environmentIcon ? (
            <Icon
              name={environmentIcon}
              className={cn(
                "size-4 shrink-0",
                environmentIcon === "Loading" && "animate-spin",
              )}
            />
          ) : null}
          {onRenameWorktree ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  aria-label={
                    environmentLabel
                      ? `Rename worktree: ${environmentLabel}`
                      : "Name worktree"
                  }
                  disabled={renameWorktreePending}
                  onClick={onRenameWorktree}
                  className="group -ml-1 inline-flex h-6 min-w-0 shrink items-center gap-1 rounded-md px-1 text-xs leading-tight text-muted-foreground outline-none transition-colors hover:bg-state-hover focus-visible:bg-state-hover focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-60"
                >
                  <span
                    className="min-w-0 truncate"
                    data-promptbox-full-label=""
                  >
                    {worktreeName}
                  </span>
                  {environmentCompactLabel ? (
                    <span
                      className="min-w-0 truncate"
                      data-promptbox-compact-label=""
                    >
                      {environmentCompactLabel}
                    </span>
                  ) : null}
                  <Icon
                    name={renameWorktreePending ? "Loading" : "Edit"}
                    className={cn(
                      "size-3.5 shrink-0 transition-opacity",
                      renameWorktreePending
                        ? "animate-spin opacity-100"
                        : "opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100",
                    )}
                  />
                </button>
              </TooltipTrigger>
              <TooltipContent>Rename</TooltipContent>
            </Tooltip>
          ) : (
            <OptionDisplay
              label={isWorktree ? "Name" : "Environment"}
              value={environmentLabel}
              compactValue={environmentCompactLabel}
              className="h-6 min-w-0 shrink px-0"
              tooltip={environmentLabel}
              muted
            />
          )}
        </div>
      ) : null}
      {machineName ? (
        <span data-promptbox-secondary-context="" className="contents">
          <OptionDisplay
            label="Machine"
            value={machineConnected ? machineName : `${machineName} · Offline`}
            compactValue={
              machineConnected ? machineName : `${machineName} · Offline`
            }
            leading={<Icon name="Laptop" className="size-4 shrink-0" />}
            className="h-6 min-w-0 max-w-[10rem] shrink"
            tooltip={
              machineConnected ? machineName : `${machineName} · Offline`
            }
            muted
          />
        </span>
      ) : null}
      {environmentCheckout && checkoutCopyValue !== null ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              data-promptbox-hide-branch-compact=""
              className={CHECKOUT_CHIP_BUTTON_CLASS_NAME}
              onClick={() => {
                void copyToClipboardWithToast(checkoutCopyValue, {
                  successMessage:
                    environmentCheckout.copySuccessMessage ?? "Value copied",
                  errorMessage:
                    environmentCheckout.copyErrorMessage ??
                    "Failed to copy value",
                });
              }}
            >
              <Icon name="GitBranch" className="size-3.5 shrink-0" />
              <span className="truncate">{environmentCheckout.label}</span>
            </button>
          </TooltipTrigger>
          <TooltipContent>{environmentCheckout.title}</TooltipContent>
        </Tooltip>
      ) : environmentCheckout ? (
        <span
          data-promptbox-hide-branch-compact=""
          className={CHECKOUT_CHIP_BASE_CLASS_NAME}
          title={environmentCheckout.title}
        >
          <Icon name="GitBranch" className="size-3.5 shrink-0" />
          <span className="truncate">{environmentCheckout.label}</span>
        </span>
      ) : null}
      {onCreateNewThreadInWorktree ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              aria-label="Create thread in worktree"
              onClick={onCreateNewThreadInWorktree}
              className={cn(
                "-ml-1 inline-flex cursor-pointer shrink-0 items-center justify-center rounded-md px-1 py-0.5 transition-colors hover:bg-state-hover",
                CHROME_SUBTLE_ICON_BUTTON_FOREGROUND_CLASS,
              )}
            >
              <Icon name="MessageSquarePlus" className="size-4" />
            </button>
          </TooltipTrigger>
          <TooltipContent>Create thread in worktree</TooltipContent>
        </Tooltip>
      ) : null}
    </div>
  );
});

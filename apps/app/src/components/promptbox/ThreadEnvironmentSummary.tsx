import { memo, useRef } from "react";
import { OptionDisplay } from "@bb/shared-ui/option-display";
import { copyToClipboardWithToast } from "@/lib/clipboard";
import { Icon, type IconName } from "@bb/shared-ui/icon";
import { Tooltip, TooltipContent, TooltipTrigger } from "@bb/shared-ui/tooltip";
import { cn } from "@bb/shared-ui/lib/utils";
import { CHROME_SUBTLE_ICON_BUTTON_FOREGROUND_CLASS } from "@bb/shared-ui/chrome-style-tokens";
import type { EnvironmentWorkspaceTypeLabel } from "@/lib/environment-workspace-display";
import type { WorkspaceCheckoutDisplay } from "@/lib/workspace-checkout-display";
import { useIsElementTruncated } from "@/hooks/useIsElementTruncated";

const CHECKOUT_CHIP_BASE_CLASS_NAME =
  "flex min-w-24 flex-1 items-center gap-1 rounded-md px-1.5 py-0.5 text-xs text-muted-foreground";
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
  onCreateNewThreadInWorktree?: () => void;
}

function MachineContext({
  name,
  connected,
}: {
  name: string;
  connected: boolean;
}) {
  const accessibleLabel = connected
    ? `Machine: ${name}`
    : `Machine: ${name}, offline`;
  const fullNameRef = useRef<HTMLSpanElement>(null);
  const compactNameRef = useRef<HTMLSpanElement>(null);
  const isFullNameTruncated = useIsElementTruncated({
    elementRef: fullNameRef,
    measurementKey: name,
  });
  const isCompactNameTruncated = useIsElementTruncated({
    elementRef: compactNameRef,
    measurementKey: name,
  });
  const isNameTruncated = isFullNameTruncated || isCompactNameTruncated;

  const nameDisplay = (
    <span
      tabIndex={isNameTruncated ? 0 : undefined}
      aria-label={accessibleLabel}
      className={cn(
        "inline-flex min-w-0 rounded-md",
        isNameTruncated &&
          "outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
      )}
    >
      <span
        ref={fullNameRef}
        className="min-w-0 truncate"
        data-promptbox-full-label=""
        data-machine-name-text=""
      >
        {name}
      </span>
      <span
        ref={compactNameRef}
        className="min-w-0 truncate"
        data-promptbox-compact-label=""
        data-machine-name-text=""
      >
        {name}
      </span>
    </span>
  );

  return (
    <span
      data-promptbox-secondary-context=""
      className="inline-flex h-6 w-fit max-w-[10rem] min-w-0 shrink items-center gap-1.5 px-1 text-xs leading-tight text-muted-foreground"
    >
      {connected ? (
        <Icon name="Laptop" className="size-4 shrink-0" aria-hidden />
      ) : (
        <Tooltip>
          <TooltipTrigger asChild>
            <span
              role="img"
              tabIndex={0}
              aria-label="Offline"
              className="inline-flex size-4 shrink-0 items-center justify-center rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            >
              <Icon name="LaptopIssue" className="size-4" aria-hidden />
            </span>
          </TooltipTrigger>
          <TooltipContent>Offline</TooltipContent>
        </Tooltip>
      )}
      <Tooltip>
        <TooltipTrigger asChild>{nameDisplay}</TooltipTrigger>
        {isNameTruncated ? <TooltipContent>{name}</TooltipContent> : null}
      </Tooltip>
    </span>
  );
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
  onCreateNewThreadInWorktree,
}: ThreadEnvironmentSummaryProps) {
  const isWorktree = environmentTypeLabel === "Worktree";
  if (
    !projectName &&
    !environmentLabel &&
    !environmentCheckout &&
    !machineName &&
    !onCreateNewThreadInWorktree
  ) {
    return null;
  }

  const checkoutCopyAction = environmentCheckout?.copyAction ?? null;
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
      {environmentLabel ? (
        <div
          data-promptbox-worktree-context={isWorktree ? "" : undefined}
          className="inline-flex h-6 w-fit max-w-full min-w-0 shrink items-center justify-start gap-1.5 px-1 text-xs leading-tight text-muted-foreground"
        >
          {environmentIcon && isWorktree && environmentIcon !== "Loading" ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <span
                  role="img"
                  tabIndex={0}
                  aria-label="Worktree"
                  className="inline-flex size-4 shrink-0 items-center justify-center rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                >
                  <Icon name={environmentIcon} className="size-4" aria-hidden />
                </span>
              </TooltipTrigger>
              <TooltipContent>Worktree</TooltipContent>
            </Tooltip>
          ) : environmentIcon ? (
            <Icon
              name={environmentIcon}
              aria-hidden
              className={cn(
                "size-4 shrink-0",
                environmentIcon === "Loading" && "animate-spin",
              )}
            />
          ) : null}
          <OptionDisplay
            label={environmentTypeLabel ?? "Worktree"}
            value={environmentLabel}
            compactValue={environmentCompactLabel}
            className="h-6 min-w-0 shrink px-0"
            tooltip={environmentLabel}
            muted
          />
        </div>
      ) : null}
      {machineName ? (
        <MachineContext name={machineName} connected={machineConnected} />
      ) : null}
      {environmentCheckout && checkoutCopyAction !== null ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              aria-label={checkoutCopyAction.accessibleLabel}
              data-promptbox-hide-branch-compact=""
              className={CHECKOUT_CHIP_BUTTON_CLASS_NAME}
              onClick={() => {
                void copyToClipboardWithToast(checkoutCopyAction.value, {
                  successMessage: checkoutCopyAction.successMessage,
                  errorMessage: checkoutCopyAction.errorMessage,
                });
              }}
            >
              <Icon name="GitBranch" className="size-3.5 shrink-0" />
              <span className="truncate">{environmentCheckout.label}</span>
            </button>
          </TooltipTrigger>
          <TooltipContent>{checkoutCopyAction.label}</TooltipContent>
        </Tooltip>
      ) : environmentCheckout ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <span
              tabIndex={0}
              aria-label={`${environmentCheckout.rowLabel}: ${environmentCheckout.label}`}
              data-promptbox-hide-branch-compact=""
              className={`${CHECKOUT_CHIP_BASE_CLASS_NAME} outline-none focus-visible:ring-2 focus-visible:ring-ring`}
            >
              <Icon name="GitBranch" className="size-3.5 shrink-0" />
              <span className="truncate">{environmentCheckout.label}</span>
            </span>
          </TooltipTrigger>
          <TooltipContent>
            {environmentCheckout.detailTooltip ?? environmentCheckout.label}
          </TooltipContent>
        </Tooltip>
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

import { memo } from "react";
import {
  OPTION_BASE_CLASS_NAME,
  OPTION_CONTENT_CLASS_NAME,
  OPTION_MUTED_CLASS_NAME,
  OptionDisplay,
} from "@bb/shared-ui/option-display";
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
  environmentIcon?: IconName;
  environmentTypeLabel?: EnvironmentWorkspaceTypeLabel;
  environmentCheckout?: WorkspaceCheckoutDisplay;
  machineName?: string;
  machineConnected?: boolean;
  onCreateNewThreadInWorktree?: () => void;
}

function OfflineMachineIcon({ compact = false }: { compact?: boolean }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          role="img"
          tabIndex={0}
          aria-label="Offline"
          className="inline-flex size-4 shrink-0 items-center justify-center rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        >
          <Icon
            name="AlertTriangle"
            className={cn(compact ? "size-3.5" : "size-4", "text-warning-text")}
            aria-hidden
          />
        </span>
      </TooltipTrigger>
      <TooltipContent>Offline</TooltipContent>
    </Tooltip>
  );
}

function NameDisplay({
  accessibleLabel,
  kind,
  name,
  option = false,
}: {
  accessibleLabel: string;
  kind: "environment" | "machine";
  name: string;
  option?: boolean;
}) {
  const { elementRef, isTruncated } = useIsElementTruncated({
    measurementKey: name,
  });
  const text = (
    <span
      ref={elementRef}
      className="min-w-0 truncate"
      data-environment-name-text={kind === "environment" ? "" : undefined}
      data-machine-name-text={kind === "machine" ? "" : undefined}
    >
      {name}
    </span>
  );
  const display = option ? (
    <div
      data-option-display=""
      tabIndex={isTruncated ? 0 : undefined}
      aria-label={accessibleLabel}
      className={cn(
        "inline-flex h-6 min-w-0 shrink px-0",
        OPTION_BASE_CLASS_NAME,
        OPTION_MUTED_CLASS_NAME,
        isTruncated &&
          "rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
      )}
    >
      <span className={OPTION_CONTENT_CLASS_NAME}>{text}</span>
    </div>
  ) : (
    <span
      tabIndex={isTruncated ? 0 : undefined}
      aria-label={accessibleLabel}
      className={cn(
        "inline-flex min-w-0 rounded-md",
        isTruncated &&
          "outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
      )}
    >
      {text}
    </span>
  );

  return isTruncated ? (
    <Tooltip>
      <TooltipTrigger asChild>{display}</TooltipTrigger>
      <TooltipContent>{name}</TooltipContent>
    </Tooltip>
  ) : (
    display
  );
}

function MachineContext({
  name,
  connected,
}: {
  name: string;
  connected: boolean;
}) {
  const accessibleLabel =
    connected === false ? `Machine: ${name}, offline` : `Machine: ${name}`;
  return (
    <span
      data-promptbox-secondary-context=""
      data-promptbox-offline-machine-context={connected ? undefined : ""}
      className="inline-flex h-6 w-fit max-w-[10rem] min-w-0 shrink items-center gap-1.5 px-1 text-xs leading-tight text-muted-foreground"
    >
      {connected === false ? (
        <OfflineMachineIcon />
      ) : (
        <Icon name="Laptop" className="size-4 shrink-0" aria-hidden />
      )}
      <span data-promptbox-machine-name-context="" className="contents">
        <NameDisplay
          accessibleLabel={accessibleLabel}
          kind="machine"
          name={name}
        />
      </span>
    </span>
  );
}

export const ThreadEnvironmentSummary = memo(function ThreadEnvironmentSummary({
  projectName,
  environmentLabel,
  environmentIcon,
  environmentTypeLabel,
  environmentCheckout,
  machineName,
  machineConnected = true,
  onCreateNewThreadInWorktree,
}: ThreadEnvironmentSummaryProps) {
  const isWorktree = environmentTypeLabel === "Worktree";
  const showPrimaryOffline =
    !machineName && machineConnected === false && environmentIcon !== "Loading";
  const showOfflineAsPrimaryIcon =
    showPrimaryOffline && environmentTypeLabel === "Machine";
  if (
    !projectName &&
    !environmentLabel &&
    !environmentCheckout &&
    !machineName &&
    !onCreateNewThreadInWorktree
  ) {
    return null;
  }

  const checkoutCopyValue = environmentCheckout?.copyValue ?? null;
  return (
    <div
      data-promptbox-offline-machine-summary={
        machineName && machineConnected === false ? "" : undefined
      }
      className="flex min-w-0 max-w-full items-center gap-2 pr-1.5"
    >
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
          {showOfflineAsPrimaryIcon ? (
            <OfflineMachineIcon />
          ) : environmentIcon && isWorktree && environmentIcon !== "Loading" ? (
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
          {showPrimaryOffline && isWorktree ? (
            <span className="inline-flex min-w-0 shrink items-center gap-1">
              <OfflineMachineIcon compact />
              <NameDisplay
                accessibleLabel={`Worktree: ${environmentLabel}, offline`}
                kind="environment"
                name={environmentLabel}
                option
              />
            </span>
          ) : (
            <NameDisplay
              accessibleLabel={`${environmentTypeLabel ?? "Worktree"}: ${environmentLabel}${showOfflineAsPrimaryIcon ? ", offline" : ""}`}
              kind="environment"
              name={environmentLabel}
              option
            />
          )}
        </div>
      ) : null}
      {machineName ? (
        <MachineContext name={machineName} connected={machineConnected} />
      ) : null}
      {environmentCheckout && checkoutCopyValue !== null ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              aria-label={`${environmentCheckout.copyLabel}: ${checkoutCopyValue}`}
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
          <TooltipContent>{environmentCheckout.copyLabel}</TooltipContent>
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
          <TooltipContent>{environmentCheckout.title}</TooltipContent>
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

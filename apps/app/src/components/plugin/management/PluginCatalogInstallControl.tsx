import { Button } from "@bb/shared-ui/button";
import { Icon } from "@bb/shared-ui/icon";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@bb/shared-ui/tooltip";

interface PluginCatalogInstallCount {
  display: string;
  accessibleLabel: string;
}

type PluginCatalogInstallControlProps = {
  displayName: string;
  disabled?: boolean;
  count?: PluginCatalogInstallCount;
} & ({ installed: true } | { installed: false; onInstall: () => void });

/**
 * Compact acquisition state for catalog cards.
 *
 * Available is an outlined action. Installed uses the same Download + count
 * shape at a muted, passive weight; uninstall remains in the installed
 * plugin's detail overflow menu rather than hiding a destructive action here.
 */
export function PluginCatalogInstallControl(
  props: PluginCatalogInstallControlProps,
) {
  const { displayName, installed, disabled = false, count } = props;
  const visualContent = (
    <>
      <Icon name="Download" className="size-3.5" aria-hidden />
      {count === undefined ? null : <span aria-hidden>{count.display}</span>}
    </>
  );

  if (installed) {
    const tooltip =
      count === undefined ? "Installed" : `Installed — ${count.accessibleLabel}`;
    return (
      <TooltipProvider delayDuration={250}>
        <Tooltip>
          <TooltipTrigger asChild>
            <span
              tabIndex={0}
              aria-label={`${displayName} installed${
                count === undefined ? "" : ` — ${count.accessibleLabel}`
              }`}
              className="inline-flex h-7 min-w-7 shrink-0 items-center justify-center gap-1.5 rounded-md px-2 text-xs text-subtle-foreground"
            >
              {visualContent}
            </span>
          </TooltipTrigger>
          <TooltipContent>{tooltip}</TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }

  return (
    <TooltipProvider delayDuration={250}>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={disabled}
            aria-label={`Install ${displayName}${
              count === undefined ? "" : ` — ${count.accessibleLabel}`
            }`}
            className="h-7 min-w-7 shrink-0 gap-1.5 border-border/80 bg-background px-2 text-xs text-foreground shadow-none hover:bg-state-hover"
            onClick={props.onInstall}
          >
            {visualContent}
          </Button>
        </TooltipTrigger>
        <TooltipContent>Install {displayName}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

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
} & (
  | { installed: true; included?: boolean }
  | { installed: false; onInstall: () => void }
);

export function PluginCatalogInstallControl(
  props: PluginCatalogInstallControlProps,
) {
  const { displayName, installed, disabled = false, count } = props;
  const included =
    props.installed && props.included === true && count === undefined;
  const visualContent = (
    <>
      <Icon
        name={included ? "Check" : "Download"}
        className="size-3.5"
        aria-hidden
      />
      {included ? (
        <span aria-hidden>Included</span>
      ) : count === undefined ? null : (
        <span aria-hidden>{count.display}</span>
      )}
    </>
  );

  if (installed) {
    const tooltip = included ? "Included with bb" : "Installed";
    return (
      <TooltipProvider delayDuration={250}>
        <Tooltip>
          <TooltipTrigger asChild>
            <span
              tabIndex={0}
              aria-label={
                included
                  ? `${displayName} included with bb`
                  : `${displayName} installed${
                      count === undefined ? "" : ` — ${count.accessibleLabel}`
                    }`
              }
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

import { Button } from "@bb/shared-ui/button";
import { Icon } from "@bb/shared-ui/icon";
import { cn } from "@bb/shared-ui/lib/utils";
import { Tooltip, TooltipContent, TooltipTrigger } from "@bb/shared-ui/tooltip";
import { useAtom } from "jotai";
import { THREAD_HEADER_ICON_BUTTON_CLASS } from "@/components/layout/AppPageHeader";
import { CHROME_SUBTLE_ICON_BUTTON_FOREGROUND_CLASS } from "@/components/ui/chromeStyleTokens";
import { dimInactiveSplitsAtom } from "@/lib/split-layout/atoms";
import { usePaneContext } from "./PaneContext";

export function SplitDimmingButton() {
  const { isFocused, isSplitPane } = usePaneContext();
  const [dimsInactiveSplits, setDimsInactiveSplits] = useAtom(
    dimInactiveSplitsAtom,
  );

  if (!isSplitPane || !isFocused) return null;

  const label = dimsInactiveSplits ? "Clear spotlight" : "Spotlight this split";

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className={cn(
            THREAD_HEADER_ICON_BUTTON_CLASS,
            CHROME_SUBTLE_ICON_BUTTON_FOREGROUND_CLASS,
            "aria-pressed:bg-transparent aria-pressed:text-foreground aria-pressed:hover:bg-state-hover",
          )}
          aria-label={label}
          aria-pressed={dimsInactiveSplits}
          onClick={() => setDimsInactiveSplits((current) => !current)}
        >
          <Icon name="Sun" />
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom">{label}</TooltipContent>
    </Tooltip>
  );
}

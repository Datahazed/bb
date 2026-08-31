import type { ComponentType } from "react";
import type { AppCommandId } from "@bb/domain";
import type { IconName } from "@bb/shared-ui/icon";

export interface PaletteModePresentation {
  chip: {
    icon: IconName;
    label: string;
  };
  footerKeys: readonly {
    keys: readonly string[];
    label: string;
  }[];
  placeholder: string;
}

export interface PaletteModeViewProps {
  onExit: () => void;
  /** Queue work until after the dialog has restored focus and closed. */
  runAfterClose: (run: () => void) => void;
  presentation: PaletteModePresentation;
}

/**
 * One content domain hosted by the palette shell. The registry is the only
 * place the shell learns which existing command enters a mode.
 */
export interface PaletteModeRegistration extends PaletteModePresentation {
  id: string;
  entryCommand: AppCommandId;
  View: ComponentType<PaletteModeViewProps>;
}

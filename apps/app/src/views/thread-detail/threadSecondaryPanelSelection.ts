import type { SecondaryFixedPanelTab } from "@/lib/fixed-panel-tabs-state";

interface GetOpenFixedSecondaryTabArgs {
  activeFixedSecondaryTab: SecondaryFixedPanelTab | null;
  isSecondaryPanelOpen: boolean;
}

export function getOpenFixedSecondaryTab({
  activeFixedSecondaryTab,
  isSecondaryPanelOpen,
}: GetOpenFixedSecondaryTabArgs): SecondaryFixedPanelTab | null {
  return isSecondaryPanelOpen ? activeFixedSecondaryTab : null;
}

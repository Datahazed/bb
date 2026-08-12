import { useMemo } from "react";
import type { TerminalSession } from "@bb/server-contract";
import { COARSE_POINTER_COMPACT_ICON_SIZE_CLASS } from "@bb/shared-ui/coarse-pointer-sizing";
import { Icon } from "@bb/shared-ui/icon";
import { PluginIcon } from "@/components/plugin/PluginIcon";
import type { SecondaryFileFixedPanelTab } from "@/lib/fixed-panel-tabs-state";
import { getBrowserUrlHost } from "@/lib/browser-url";
import { terminalStatusLabel } from "@/components/thread/terminal/useThreadTerminalController";
import type { SecondaryPanelFileTab } from "./ThreadSecondaryPanel";
import { resolveRightPanelFileVisual } from "./rightPanelFileVisuals";

interface PluginPanelActionIcon {
  id: string;
  icon?: string;
  pluginId: string;
}

interface UseSecondaryPanelFileTabsArgs {
  activeTabId: string | null;
  hideNewTab: boolean;
  onActivateTab: (tabId: string) => void;
  onActivateTerminal: (terminalId: string) => void;
  onCloseTab: (tabId: string) => void;
  onCloseTerminal: (terminalId: string) => void;
  orderedTabs: readonly SecondaryFileFixedPanelTab[];
  pluginPanelActions: readonly PluginPanelActionIcon[];
  terminalsById: ReadonlyMap<string, TerminalSession>;
}

function RightPanelFileTabIcon({ path }: { path: string }) {
  const visual = resolveRightPanelFileVisual({ path });
  return (
    <Icon
      name={visual.iconName}
      className={COARSE_POINTER_COMPACT_ICON_SIZE_CLASS}
      aria-hidden
    />
  );
}

export function useSecondaryPanelFileTabs({
  activeTabId,
  hideNewTab,
  onActivateTab,
  onActivateTerminal,
  onCloseTab,
  onCloseTerminal,
  orderedTabs,
  pluginPanelActions,
  terminalsById,
}: UseSecondaryPanelFileTabsArgs): SecondaryPanelFileTab[] | undefined {
  return useMemo(() => {
    const filenameOf = (path: string) => path.split("/").at(-1) ?? path;
    const tabs = orderedTabs.map((tab): SecondaryPanelFileTab => {
      const common = {
        id: tab.id,
        isActive: tab.id === activeTabId,
      };
      switch (tab.kind) {
        case "browser": {
          const browserLabel =
            tab.title ?? (tab.url.length > 0 ? getBrowserUrlHost(tab.url) : "");
          return {
            ...common,
            filename: browserLabel.length > 0 ? browserLabel : "Browser",
            leadingVisual: (
              <Icon
                name="Globe"
                className={COARSE_POINTER_COMPACT_ICON_SIZE_CLASS}
                aria-hidden
              />
            ),
            statusLabel: null,
            onSelect: () => onActivateTab(tab.id),
            onClose: () => onCloseTab(tab.id),
          };
        }
        case "terminal": {
          const session = terminalsById.get(tab.terminalId);
          return {
            ...common,
            filename: session?.title ?? "Terminal",
            leadingVisual: (
              <Icon
                name="Terminal"
                className={COARSE_POINTER_COMPACT_ICON_SIZE_CLASS}
                aria-hidden
              />
            ),
            statusLabel:
              session === undefined || session.status === "running"
                ? null
                : terminalStatusLabel(session),
            onSelect: () => onActivateTerminal(tab.terminalId),
            onClose: () => onCloseTerminal(tab.terminalId),
          };
        }
        case "workspace-file-preview":
          return {
            ...common,
            filename: filenameOf(tab.path),
            leadingVisual: <RightPanelFileTabIcon path={tab.path} />,
            statusLabel: tab.statusLabel,
            onSelect: () => onActivateTab(tab.id),
            onClose: () => onCloseTab(tab.id),
          };
        case "host-file-preview":
          return {
            ...common,
            filename: filenameOf(tab.path),
            leadingVisual: <RightPanelFileTabIcon path={tab.path} />,
            statusLabel: null,
            onSelect: () => onActivateTab(tab.id),
            onClose: () => onCloseTab(tab.id),
          };
        case "thread-storage-file-preview":
          return {
            ...common,
            filename: filenameOf(tab.path),
            isPinned: tab.isPinned,
            leadingVisual: <RightPanelFileTabIcon path={tab.path} />,
            statusLabel: null,
            onSelect: () => onActivateTab(tab.id),
            onClose: () => onCloseTab(tab.id),
          };
        case "new-tab":
          return {
            ...common,
            filename: "New tab",
            isHidden: hideNewTab,
            leadingVisual: (
              <Icon
                name="NewTab"
                className={COARSE_POINTER_COMPACT_ICON_SIZE_CLASS}
                aria-hidden
              />
            ),
            statusLabel: null,
            onSelect: () => onActivateTab(tab.id),
            onClose: () => onCloseTab(tab.id),
          };
        case "plugin-panel": {
          const actionIcon =
            pluginPanelActions.find(
              (action) =>
                action.pluginId === tab.pluginId && action.id === tab.actionId,
            )?.icon ?? null;
          return {
            ...common,
            filename: tab.title,
            leadingVisual: (
              <PluginIcon
                pluginId={tab.pluginId}
                icon={actionIcon}
                className={COARSE_POINTER_COMPACT_ICON_SIZE_CLASS}
              />
            ),
            statusLabel: null,
            onSelect: () => onActivateTab(tab.id),
            onClose: () => onCloseTab(tab.id),
          };
        }
      }
    });
    return tabs.length > 0 ? tabs : undefined;
  }, [
    activeTabId,
    hideNewTab,
    onActivateTab,
    onActivateTerminal,
    onCloseTab,
    onCloseTerminal,
    orderedTabs,
    pluginPanelActions,
    terminalsById,
  ]);
}

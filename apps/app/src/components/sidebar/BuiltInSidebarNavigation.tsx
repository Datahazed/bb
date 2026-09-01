import type { ComponentProps } from "react";
import {
  AutomationsNavSidebarItem,
  ExtensionsNavSidebarItem,
  getTraditionalPluginNavPanelEntries,
  PluginNavSidebarItems,
} from "@/components/plugin/PluginNavSidebarItems";
import { usePluginNavPanelChrome } from "@/lib/plugin-nav-panel-chrome";
import { AUTOMATIONS_PLUGIN_ID } from "@/lib/route-paths";
import { ProjectListActionButtons } from "./ProjectList";

export type BuiltInSidebarNavigationProps = ComponentProps<
  typeof ProjectListActionButtons
> &
  ComponentProps<typeof PluginNavSidebarItems> & {
    toolsRoutePath?: string;
  };

export function BuiltInSidebarNavigation({
  newThreadSplit,
  onNavigate,
  onNewChat,
  onSearchThreads,
  splitEnabled,
  toolsRoutePath,
}: BuiltInSidebarNavigationProps) {
  const pluginNavPanels = usePluginNavPanelChrome();
  const automationsNavPanel = pluginNavPanels.find(
    ({ chrome }) => chrome.pluginId === AUTOMATIONS_PLUGIN_ID,
  );
  const traditionalPluginNavPanels = getTraditionalPluginNavPanelEntries(
    pluginNavPanels,
  );

  return (
    <div className="contents" data-testid="built-in-sidebar-navigation">
      <div
        data-testid="app-sidebar-primary-actions"
        className="shrink-0 px-2 py-2 group-data-[collapsible=icon]:hidden"
      >
        <ProjectListActionButtons
          splitEnabled={splitEnabled}
          newThreadSplit={newThreadSplit}
          onNewChat={onNewChat}
          onSearchThreads={onSearchThreads}
        />
        {toolsRoutePath ? (
          <ExtensionsNavSidebarItem
            routePath={toolsRoutePath}
            onNavigate={onNavigate}
          />
        ) : null}
        {automationsNavPanel ? (
          <AutomationsNavSidebarItem
            chrome={automationsNavPanel.chrome}
            onNavigate={onNavigate}
          />
        ) : null}
      </div>
      <PluginNavSidebarItems
        entries={traditionalPluginNavPanels}
        onNavigate={onNavigate}
        splitEnabled={splitEnabled}
      />
    </div>
  );
}

import { Fragment, type ComponentProps, type ReactNode } from "react";
import { useAtomValue } from "jotai";
import {
  AutomationsNavSidebarItem,
  ExtensionsNavSidebarItem,
  getTraditionalPluginNavPanelEntries,
  PluginNavSidebarItems,
} from "@/components/plugin/PluginNavSidebarItems";
import { usePluginNavPanelChrome } from "@/lib/plugin-nav-panel-chrome";
import { AUTOMATIONS_PLUGIN_ID } from "@/lib/route-paths";
import {
  ProjectListNewThreadAction,
  ProjectListSearchThreadsAction,
} from "./ProjectList";
import {
  sidebarTopRegionItemPreferencesAtom,
  type SidebarTopRegionItemId,
} from "./sidebarTopRegionItemPreferences";
import {
  normalizeSidebarRegionOrder,
  sidebarRegionOrderAtom,
} from "./sidebarRegionOrderPreferences";

export type BuiltInSidebarNavigationProps = ComponentProps<
  typeof ProjectListNewThreadAction
> &
  ComponentProps<typeof ProjectListSearchThreadsAction> &
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
  const topRegionPreferences = useAtomValue(
    sidebarTopRegionItemPreferencesAtom,
  );
  const regionOrder = useAtomValue(sidebarRegionOrderAtom);
  const pluginNavPanels = usePluginNavPanelChrome();
  const automationsNavPanel = pluginNavPanels.find(
    ({ chrome }) => chrome.pluginId === AUTOMATIONS_PLUGIN_ID,
  );
  const traditionalPluginNavPanels = getTraditionalPluginNavPanelEntries(
    pluginNavPanels,
  );
  const topRegionItemNodes: Record<SidebarTopRegionItemId, ReactNode | null> = {
    "new-thread": (
      <ProjectListNewThreadAction
        splitEnabled={splitEnabled}
        newThreadSplit={newThreadSplit}
        onNewChat={onNewChat}
      />
    ),
    search: (
      <ProjectListSearchThreadsAction onSearchThreads={onSearchThreads} />
    ),
    extensions: toolsRoutePath ? (
      <ExtensionsNavSidebarItem
        routePath={toolsRoutePath}
        onNavigate={onNavigate}
      />
    ) : null,
    automations: automationsNavPanel ? (
      <AutomationsNavSidebarItem
        chrome={automationsNavPanel.chrome}
        onNavigate={onNavigate}
      />
    ) : null,
  };
  const visibleTopRegionItems = topRegionPreferences.order.flatMap((id) => {
    const node = topRegionItemNodes[id];
    return node === null || topRegionPreferences.hiddenIds.includes(id)
      ? []
      : [
          <div key={id} data-sidebar-top-region-item={id}>
            {node}
          </div>,
        ];
  });
  const regions = {
    "bb-controls":
      visibleTopRegionItems.length === 0 ? null : (
        <div
          data-testid="app-sidebar-primary-actions"
          className="shrink-0 space-y-1 px-2 py-2 group-data-[collapsible=icon]:hidden"
        >
          {visibleTopRegionItems}
        </div>
      ),
    plugins:
      traditionalPluginNavPanels.length === 0 ? null : (
        <PluginNavSidebarItems
          entries={traditionalPluginNavPanels}
          onNavigate={onNavigate}
          showDivider={false}
          splitEnabled={splitEnabled}
        />
      ),
  } as const;
  const visibleRegions = normalizeSidebarRegionOrder(regionOrder).flatMap(
    (id) =>
      id === "threads" || regions[id] === null
        ? []
        : ([[id, regions[id]]] as const),
  );

  return (
    <div className="contents" data-testid="built-in-sidebar-navigation">
      {visibleRegions.map(([id, region], index) => (
        <Fragment key={id}>
          {index > 0 ? (
            <div
              aria-hidden="true"
              data-sidebar-navigation-divider={id}
              className="mx-2 h-px shrink-0 bg-sidebar-border"
            />
          ) : null}
          {region}
        </Fragment>
      ))}
    </div>
  );
}

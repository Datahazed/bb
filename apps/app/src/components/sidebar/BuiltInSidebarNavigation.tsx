import type { ComponentProps } from "react";
import { useNavigate } from "react-router-dom";
import {
  AutomationsNavSidebarItem,
  type BuiltInSidebarNavEntry,
  ExtensionsNavSidebarItem,
  getTraditionalPluginNavPanelEntries,
  PluginNavSidebarItems,
} from "@/components/plugin/PluginNavSidebarItems";
import { useAppCommandRunner } from "@/components/commands/AppCommandProvider";
import { PluginIcon } from "@/components/plugin/PluginIcon";
import { Icon } from "@bb/shared-ui/icon";
import { usePluginNavPanelChrome } from "@/lib/plugin-nav-panel-chrome";
import {
  AUTOMATIONS_PLUGIN_ID,
  getPluginPanelRoutePath,
} from "@/lib/route-paths";
import {
  ProjectListNewThreadAction,
  ProjectListSearchThreadsAction,
} from "./ProjectList";
import { DEFAULT_BUILT_IN_SIDEBAR_NAVIGATION_ORDER } from "@/components/plugin/pluginNavSidebarOrder";

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
  const navigate = useNavigate();
  const commandRunner = useAppCommandRunner();
  const pluginNavPanels = usePluginNavPanelChrome();
  const automationsNavPanel = pluginNavPanels.find(
    ({ chrome }) => chrome.pluginId === AUTOMATIONS_PLUGIN_ID,
  );
  const traditionalPluginNavPanels = getTraditionalPluginNavPanelEntries(
    pluginNavPanels,
  );
  const builtInEntries: BuiltInSidebarNavEntry[] = [
    {
      kind: "built-in",
      pluginId: "__bb__",
      id: "new-thread",
      title: "New thread",
      icon: <Icon name="MessageSquarePlus" aria-hidden="true" />,
      content: (
        <ProjectListNewThreadAction
          splitEnabled={splitEnabled}
          newThreadSplit={newThreadSplit}
          onNewChat={onNewChat}
        />
      ),
      disabled: onNewChat === undefined,
      onActivate: () => onNewChat?.(),
    },
    {
      kind: "built-in",
      pluginId: "__bb__",
      id: "search-threads",
      title: "Search threads",
      icon: <Icon name="Search" aria-hidden="true" />,
      content: (
        <ProjectListSearchThreadsAction onSearchThreads={onSearchThreads} />
      ),
      disabled: !commandRunner.isCommandAvailable("thread.search", null),
      onActivate: () => {
        onSearchThreads?.();
        commandRunner.dispatch("thread.search", null);
      },
    },
    ...(toolsRoutePath
      ? [
          {
            kind: "built-in" as const,
            pluginId: "__bb__" as const,
            id: "extensions",
            title: "Extensions",
            icon: <Icon name="Toolbox" aria-hidden="true" />,
            content: (
              <ExtensionsNavSidebarItem
                routePath={toolsRoutePath}
                onNavigate={onNavigate}
              />
            ),
            onActivate: () => {
              onNavigate?.();
              void navigate(toolsRoutePath);
            },
          },
        ]
      : []),
    ...(automationsNavPanel
      ? [
          {
            kind: "built-in" as const,
            pluginId: "__bb__" as const,
            id: "automations",
            title: automationsNavPanel.chrome.title,
            icon: (
              <PluginIcon
                pluginId={automationsNavPanel.chrome.pluginId}
                icon={automationsNavPanel.chrome.icon}
              />
            ),
            content: (
              <AutomationsNavSidebarItem
                chrome={automationsNavPanel.chrome}
                onNavigate={onNavigate}
              />
            ),
            onActivate: () => {
              onNavigate?.();
              void navigate(
                getPluginPanelRoutePath({
                  pluginId: automationsNavPanel.chrome.pluginId,
                  path: automationsNavPanel.chrome.path,
                }),
              );
            },
          },
        ]
      : []),
  ];

  return (
    <div
      className="contents"
      data-testid="built-in-sidebar-navigation"
      data-sidebar-navigation-unified="true"
    >
      <PluginNavSidebarItems
        builtInEntries={builtInEntries}
        entries={traditionalPluginNavPanels}
        leadingOrderKeys={DEFAULT_BUILT_IN_SIDEBAR_NAVIGATION_ORDER}
        onNavigate={onNavigate}
        splitEnabled={splitEnabled}
      />
    </div>
  );
}

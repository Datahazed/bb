import {
  Link,
  matchPath,
  useLocation,
  useNavigate,
  useParams,
} from "react-router-dom";
import {
  CREATE_PLUGIN_PROMPT,
  CreateWithTemplatesButton,
} from "@/components/create-via-prompt-examples";
import { EmptyStatePanel } from "@/components/ui/empty-state.js";
import { Icon, type IconName } from "@/components/ui/icon.js";
import { Pill } from "@/components/ui/pill.js";
import { Skeleton } from "@/components/ui/skeleton.js";
import {
  PluginRow,
  pluginStatusPillVariant,
} from "@/components/settings/PluginsSettingsSection";
import {
  usePluginList,
  type PluginListItem,
} from "@/hooks/queries/plugin-settings-queries";
import { usePreferredTheme } from "@/hooks/useTheme";
import {
  AUTOMATION_DETAIL_ROUTE_PATH,
  getAutomationsRoutePath,
  getPluginDetailRoutePath,
  getPluginsRoutePath,
  getRootComposeRoutePath,
  getSkillsRoutePath,
} from "@/lib/route-paths";
import { cn } from "@/lib/utils";
import { AutomationDetailView } from "./AutomationDetailView";
import { AutomationsLibrary } from "./AutomationsView";
import { SkillsLibrary } from "./SkillsView";

type ToolsTabId = "skills" | "plugins" | "automations";

interface ToolsTab {
  id: ToolsTabId;
  label: string;
  icon: IconName;
  to: string;
}

const TOOLS_TABS: readonly ToolsTab[] = [
  { id: "skills", label: "Skills", icon: "Zap", to: getSkillsRoutePath() },
  {
    id: "plugins",
    label: "Plugins",
    icon: "Puzzle",
    to: getPluginsRoutePath(),
  },
  {
    id: "automations",
    label: "Automations",
    icon: "Clock",
    to: getAutomationsRoutePath(),
  },
];

function getToolsTab(pathname: string): ToolsTabId {
  if (pathname.startsWith(getPluginsRoutePath())) {
    return "plugins";
  }
  if (pathname.startsWith(getAutomationsRoutePath())) {
    return "automations";
  }
  return "skills";
}

function ToolsTabs({ activeTab }: { activeTab: ToolsTabId }) {
  return (
    <nav
      aria-label="Tools"
      role="tablist"
      className="flex min-w-0 items-center gap-1"
    >
      {TOOLS_TABS.map((tab) => {
        const active = tab.id === activeTab;
        return (
          <Link
            key={tab.id}
            to={tab.to}
            role="tab"
            aria-selected={active}
            aria-current={active ? "page" : undefined}
            className={cn(
              "inline-flex h-8 min-w-0 items-center gap-1.5 rounded-md px-2.5 text-sm transition-colors",
              active
                ? "bg-state-active text-foreground"
                : "text-muted-foreground hover:bg-state-hover hover:text-foreground",
            )}
          >
            <Icon name={tab.icon} className="size-4 shrink-0" aria-hidden />
            <span className="truncate">{tab.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}

function PluginListLogo({ plugin }: { plugin: PluginListItem }) {
  const theme = usePreferredTheme();
  const logoUrl =
    theme === "dark" && plugin.logoDarkUrl !== null
      ? plugin.logoDarkUrl
      : plugin.logoUrl;
  if (logoUrl !== null) {
    return (
      <img
        src={logoUrl}
        alt=""
        aria-hidden="true"
        className="size-4 shrink-0 rounded-sm object-contain"
      />
    );
  }
  return (
    <Icon
      name="Puzzle"
      className="size-4 shrink-0 text-muted-foreground"
      aria-hidden
    />
  );
}

function PluginListRow({ plugin }: { plugin: PluginListItem }) {
  return (
    <Link
      to={getPluginDetailRoutePath({ pluginId: plugin.id })}
      className="group flex min-w-0 items-start gap-2 rounded-md px-3 py-2 text-left transition-colors hover:bg-state-hover focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
    >
      <PluginListLogo plugin={plugin} />
      <span className="min-w-0 flex-1">
        <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          <span className="truncate text-sm font-medium text-foreground">
            {plugin.id}
          </span>
          <span className="text-xs text-muted-foreground">
            v{plugin.version}
          </span>
          <Pill variant={pluginStatusPillVariant(plugin.status)} size="sm">
            {plugin.status}
          </Pill>
          {!plugin.enabled ? (
            <Pill variant="outline" size="sm">
              disabled
            </Pill>
          ) : null}
        </span>
        {plugin.statusDetail !== null && plugin.statusDetail.length > 0 ? (
          <span className="mt-1 block truncate text-xs text-subtle-foreground">
            {plugin.statusDetail}
          </span>
        ) : null}
      </span>
      <Icon
        name="ChevronRight"
        className="mt-0.5 size-4 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100"
        aria-hidden
      />
    </Link>
  );
}

function PluginsLoadingRows() {
  return (
    <div className="space-y-0.5" aria-busy aria-label="Loading plugins">
      {["w-32", "w-44", "w-28"].map((nameWidth) => (
        <div key={nameWidth} className="flex items-start gap-2 px-3 py-2">
          <Skeleton className="size-4 shrink-0 rounded-sm" />
          <div className="min-w-0 flex-1 space-y-1.5">
            <Skeleton className={cn("h-3.5", nameWidth)} />
            <Skeleton className="h-3 w-24" />
          </div>
        </div>
      ))}
    </div>
  );
}

function PluginDetail({
  isLoading,
  plugin,
}: {
  isLoading: boolean;
  plugin: PluginListItem | null;
}) {
  if (isLoading) {
    return <PluginsLoadingRows />;
  }

  if (plugin === null) {
    return (
      <EmptyStatePanel className="py-6">Plugin not found.</EmptyStatePanel>
    );
  }

  return (
    <div className="space-y-4">
      <Link
        to={getPluginsRoutePath()}
        className="inline-flex w-fit items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
      >
        <Icon name="ChevronLeft" className="size-3.5 shrink-0" aria-hidden />
        Plugins
      </Link>
      <div className="border-t border-border">
        <PluginRow plugin={plugin} />
      </div>
    </div>
  );
}

function PluginsToolView({ pluginId }: { pluginId: string | undefined }) {
  const navigate = useNavigate();
  const listQuery = usePluginList();
  const plugins = listQuery.data ?? [];
  const isLoading = listQuery.isFetching && listQuery.data === undefined;
  const selectedPlugin =
    pluginId !== undefined
      ? (plugins.find((plugin) => plugin.id === pluginId) ?? null)
      : null;
  const handleCreatePlugin = (prompt?: string) => {
    navigate(getRootComposeRoutePath(), {
      state: {
        focusPrompt: true,
        initialPrompt: prompt ?? CREATE_PLUGIN_PROMPT,
        replaceInitialPrompt: true,
        createDraftKind: "plugin",
      },
    });
  };

  const createButton =
    pluginId === undefined ? (
      <div className="flex justify-end">
        <CreateWithTemplatesButton
          kind="plugin"
          label="New plugin"
          onCreate={handleCreatePlugin}
        />
      </div>
    ) : null;

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto w-full max-w-5xl space-y-4 px-4 pb-4 pt-3 md:px-5 md:pt-4">
        {pluginId !== undefined ? (
          <PluginDetail isLoading={isLoading} plugin={selectedPlugin} />
        ) : listQuery.isError ? (
          <>
            {createButton}
            <EmptyStatePanel role="alert" className="py-6">
              Couldn't load plugins.
            </EmptyStatePanel>
          </>
        ) : isLoading ? (
          <>
            {createButton}
            <PluginsLoadingRows />
          </>
        ) : plugins.length === 0 ? (
          <>
            {createButton}
            <EmptyStatePanel className="py-6">
              No plugins installed.
            </EmptyStatePanel>
          </>
        ) : (
          <>
            {createButton}
            <div className="space-y-0.5">
              {plugins.map((plugin) => (
                <PluginListRow key={plugin.id} plugin={plugin} />
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export function ToolsView() {
  const location = useLocation();
  const { pluginId } = useParams<{ pluginId?: string }>();
  const activeTab = getToolsTab(location.pathname);
  const isAutomationDetail =
    matchPath(AUTOMATION_DETAIL_ROUTE_PATH, location.pathname) !== null;

  return (
    <div className="-mx-4 -mb-4 -mt-4 flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden md:-mx-5 md:-mb-5 md:-mt-5">
      <div className="shrink-0 bg-background">
        <div className="mx-auto flex w-full max-w-5xl items-center px-4 pb-1.5 pt-3 md:px-5 md:pt-4">
          <ToolsTabs activeTab={activeTab} />
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-hidden">
        {activeTab === "skills" ? (
          <div className="h-full overflow-y-auto">
            <div className="mx-auto w-full max-w-5xl px-4 pb-4 pt-2 md:px-5">
              <SkillsLibrary />
            </div>
          </div>
        ) : null}
        {activeTab === "plugins" ? (
          <PluginsToolView pluginId={pluginId} />
        ) : null}
        {activeTab === "automations" ? (
          isAutomationDetail ? (
            <AutomationDetailView />
          ) : (
            <AutomationsLibrary />
          )
        ) : null}
      </div>
    </div>
  );
}

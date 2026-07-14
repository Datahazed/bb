import {
  Suspense,
  useCallback,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  matchPath,
  useLocation,
  useNavigate,
  useParams,
} from "react-router-dom";
import { WorkerPoolContextProvider } from "@pierre/diffs/react";
import { useMutation } from "@tanstack/react-query";
import {
  CREATE_PLUGIN_PROMPT,
  CreateWithTemplatesButton,
  getCreateExamples,
} from "@/components/create-via-prompt-examples";
import { appToast } from "@/components/ui/app-toast";
import {
  ConfirmDeleteDialog,
  ConfirmDeleteDialogContent,
} from "@/components/dialogs/ConfirmDeleteDialog";
import {
  ResourceActionButton,
  ResourceDetailBackButton,
  ResourceDetailList,
  ResourceDetailListItem,
  ResourceListPanel,
  ResourceListState,
  ResourceOverviewPage,
  ResourceRow,
  ResourceRowDetailChevron,
  ResourceSortMenu,
  ResourceTemplateBrowseCard,
} from "@bb/shared-ui/resource-list";
import { Icon, type IconName } from "@bb/shared-ui/icon";
import { EmptyStatePanel } from "@bb/shared-ui/empty-state";
import { Skeleton } from "@bb/shared-ui/skeleton";
import { Switch } from "@bb/shared-ui/switch";
import { PluginSlotMount } from "@/components/plugin/PluginSlotMount";
import { PluginSettingsDetail } from "@/components/settings/PluginsSettingsSection";
import { PluginDetailView } from "@/components/tools/PluginDetailView";
import {
  usePluginList,
  type PluginListItem,
} from "@/hooks/queries/plugin-settings-queries";
import { usePreferredTheme } from "@/hooks/useTheme";
import { useLocalOpenTargets } from "@/hooks/useLocalOpenTargets";
import {
  createDiffWorker,
  getDiffWorkerPoolSize,
} from "@/lib/diff-worker-pool";
import { usePluginSlots } from "@/lib/plugin-slots";
import {
  AUTOMATIONS_PLUGIN_ID,
  AUTOMATIONS_PLUGIN_PANEL_PATH,
  TOOLS_AUTOMATION_EDIT_ROUTE_PATH,
  getAutomationsRoutePath,
  getPluginDetailRoutePath,
  getPluginsRoutePath,
  getRootComposeRoutePath,
} from "@/lib/route-paths";
import { cn } from "@bb/shared-ui/lib/utils";
import { SkillsLibrary } from "./SkillsView";

const WORKER_POOL_OPTIONS = {
  workerFactory: createDiffWorker,
  poolSize: getDiffWorkerPoolSize(),
};
const HIGHLIGHTER_OPTIONS = {};

type ToolsSectionId = "skills" | "plugins" | "automations";

function getToolsSection(pathname: string): ToolsSectionId {
  if (pathname.startsWith(getPluginsRoutePath())) {
    return "plugins";
  }
  if (pathname.startsWith(getAutomationsRoutePath())) {
    return "automations";
  }
  return "skills";
}

function pluginStatusTone(
  plugin: PluginListItem,
): "success" | "warning" | "error" | "muted" {
  if (!plugin.enabled) return "muted";
  if (plugin.status === "running") return "success";
  if (plugin.status === "needs-configuration" || plugin.status === "degraded") {
    return "warning";
  }
  if (
    plugin.status === "error" ||
    plugin.status === "incompatible" ||
    plugin.status === "missing"
  ) {
    return "error";
  }
  return "muted";
}

function pluginSourceLabel(plugin: PluginListItem): string | null {
  if (plugin.isBuiltin) return "Built-in";
  if (plugin.source === null) return null;
  if (plugin.source.startsWith("path:")) return "Local plugin";
  if (plugin.source.startsWith("git:")) return "Git plugin";
  if (plugin.source.startsWith("npm:")) return "npm plugin";
  return plugin.source;
}

function pluginIsLocalSource(plugin: PluginListItem): boolean {
  return plugin.source?.startsWith("path:") === true;
}

function pluginCanBeRemoved(plugin: PluginListItem): boolean {
  return (
    plugin.source?.startsWith("path:") === true ||
    plugin.source?.startsWith("git:") === true ||
    plugin.source?.startsWith("npm:") === true
  );
}

function pluginRemovalLabel(plugin: PluginListItem): string {
  return pluginIsLocalSource(plugin) ? "Remove from bb" : "Uninstall";
}

function ToolsBodyFallback() {
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto w-full max-w-5xl px-4 pb-4 pt-2 md:px-5">
        <div className="space-y-2">
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-24 w-full rounded-md" />
          <Skeleton className="h-24 w-full rounded-md" />
        </div>
      </div>
    </div>
  );
}

function ToolsSectionBody({
  activeSection,
  pluginId,
}: {
  activeSection: ToolsSectionId;
  pluginId: string | undefined;
}) {
  if (activeSection === "skills") {
    return (
      <div className="h-full overflow-y-auto">
        <div className="mx-auto w-full max-w-5xl px-4 pb-4 pt-2 md:px-5">
          <SkillsLibrary />
        </div>
      </div>
    );
  }
  if (activeSection === "plugins") {
    return <PluginsToolView pluginId={pluginId} />;
  }
  return <AutomationsToolView />;
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
  return <BbMark />;
}

export function PluginListRow({
  plugin,
  pending,
  editDisabled,
  onToggle,
  onEdit,
  onDelete,
}: {
  plugin: PluginListItem;
  pending: boolean;
  editDisabled: boolean;
  onToggle: (plugin: PluginListItem) => void;
  onEdit: (plugin: PluginListItem) => void;
  onDelete: (plugin: PluginListItem) => void;
}) {
  const navigate = useNavigate();
  const detailPath = getPluginDetailRoutePath({ pluginId: plugin.id });
  const description =
    plugin.description !== null && plugin.description.length > 0
      ? plugin.description
      : plugin.statusDetail;
  return (
    <ResourceRow
      leading={<PluginListLogo plugin={plugin} />}
      title={plugin.displayName ?? plugin.id}
      titleMeta={`v${plugin.version}`}
      description={description}
      onOpen={() => void navigate(detailPath)}
      trailingVisual={<ResourceRowDetailChevron />}
      persistentActions={
        <Switch
          size="sm"
          checked={plugin.enabled}
          disabled={pending}
          aria-label={`${plugin.enabled ? "Disable" : "Enable"} ${plugin.id}`}
          onCheckedChange={() => onToggle(plugin)}
        />
      }
      actions={
        plugin.isBuiltin ? undefined : (
          <>
            {pluginIsLocalSource(plugin) ? (
              <ResourceActionButton
                label={`Edit ${plugin.id}`}
                icon="Edit"
                disabled={pending || editDisabled}
                onClick={() => onEdit(plugin)}
              />
            ) : null}
            {pluginCanBeRemoved(plugin) ? (
              <ResourceActionButton
                label={`${pluginRemovalLabel(plugin)} ${plugin.id}`}
                icon="Trash2"
                tone="destructive"
                disabled={pending}
                onClick={() => onDelete(plugin)}
              />
            ) : null}
          </>
        )
      }
    />
  );
}

type ToolSortMode = "alpha";
type ToolSortDirection = "asc" | "desc";

function applyToolSortDirection(
  result: number,
  direction: ToolSortDirection,
): number {
  return direction === "asc" ? result : -result;
}

function BbMark({ className = "size-4" }: { className?: string }) {
  return (
    <img
      src="/bb-mark.svg"
      alt=""
      aria-hidden="true"
      className={cn(className, "object-contain dark:invert")}
    />
  );
}

function PluginsLoadingRows() {
  return <ResourceListState state="loading" message="Loading plugins" />;
}

function pluginActivityIcon(
  state: "running" | "backoff" | "stopped" | "ok" | "error" | null,
): { name: IconName; className: string; label: string } {
  if (state === "running" || state === "ok") {
    return { name: "CircleCheck", className: "text-success", label: state };
  }
  if (state === "backoff") {
    return {
      name: "AlertTriangle",
      className: "text-warning",
      label: "retrying",
    };
  }
  if (state === "error") {
    return { name: "CircleX", className: "text-destructive", label: state };
  }
  if (state === null) {
    return {
      name: "Clock",
      className: "text-muted-foreground",
      label: "no runs yet",
    };
  }
  return {
    name: "Pause",
    className: "text-muted-foreground",
    label: "stopped",
  };
}

function PluginActivityState({
  state,
  resourceLabel,
}: {
  state: "running" | "backoff" | "stopped" | "ok" | "error" | null;
  resourceLabel: string;
}) {
  const icon = pluginActivityIcon(state);
  return (
    <Icon
      name={icon.name}
      className={cn("size-4", icon.className)}
      aria-label={`${resourceLabel}: ${icon.label}`}
    />
  );
}

function pluginIncludes(plugin: PluginListItem): ReactNode[] {
  return [
    ...(plugin.app.hasApp
      ? [
          <ResourceDetailListItem
            key="app"
            leading={<Icon name="AppWindow" className="size-4" aria-hidden />}
          >
            App surfaces
          </ResourceDetailListItem>,
        ]
      : []),
    ...(plugin.cliCommand
      ? [
          <ResourceDetailListItem
            key="cli"
            leading={<Icon name="Terminal" className="size-4" aria-hidden />}
          >
            <span className="block font-mono">bb {plugin.cliCommand.name}</span>
            <span className="block text-xs text-muted-foreground">
              {plugin.cliCommand.summary}
            </span>
          </ResourceDetailListItem>,
        ]
      : []),
    ...plugin.services.map((service) => (
      <ResourceDetailListItem
        key={`service:${service.name}`}
        leading={<Icon name="Workflow" className="size-4" aria-hidden />}
      >
        {service.name}
      </ResourceDetailListItem>
    )),
    ...plugin.schedules.map((schedule) => (
      <ResourceDetailListItem
        key={`schedule:${schedule.name}`}
        leading={<Icon name="TimeSchedule" className="size-4" aria-hidden />}
      >
        <span className="block">{schedule.name}</span>
        <span className="block font-mono text-xs text-muted-foreground">
          {schedule.cron}
        </span>
      </ResourceDetailListItem>
    )),
  ];
}

function PluginActivity({ plugin }: { plugin: PluginListItem }) {
  const showOverallState = plugin.enabled && plugin.status !== "running";
  const hasHandlerErrors = plugin.handlerStats.errorCount > 0;
  if (
    !showOverallState &&
    !hasHandlerErrors &&
    plugin.services.length === 0 &&
    plugin.schedules.length === 0
  ) {
    return null;
  }
  return (
    <ResourceDetailList>
      {showOverallState ? (
        <ResourceDetailListItem
          leading={
            <Icon
              name={
                pluginStatusTone(plugin) === "error"
                  ? "CircleX"
                  : "AlertTriangle"
              }
              className={cn(
                "size-4",
                pluginStatusTone(plugin) === "error"
                  ? "text-destructive"
                  : "text-warning",
              )}
              aria-hidden
            />
          }
        >
          <span className="block capitalize">
            {plugin.status.replaceAll("-", " ")}
          </span>
          {plugin.statusDetail ? (
            <span className="block text-xs text-muted-foreground">
              {plugin.statusDetail}
            </span>
          ) : null}
        </ResourceDetailListItem>
      ) : null}
      {plugin.services.map((service) => (
        <ResourceDetailListItem
          key={service.name}
          trailing={
            <PluginActivityState
              state={service.state}
              resourceLabel={service.name}
            />
          }
        >
          {service.name}
        </ResourceDetailListItem>
      ))}
      {plugin.schedules.map((schedule) => (
        <ResourceDetailListItem
          key={schedule.name}
          trailing={
            <PluginActivityState
              state={schedule.lastStatus}
              resourceLabel={schedule.name}
            />
          }
        >
          <span className="block">{schedule.name}</span>
          {schedule.lastError ? (
            <span className="block text-xs text-destructive">
              {schedule.lastError}
            </span>
          ) : null}
        </ResourceDetailListItem>
      ))}
      {hasHandlerErrors ? (
        <ResourceDetailListItem
          leading={
            <Icon
              name="AlertCircle"
              className="size-4 text-destructive"
              aria-hidden
            />
          }
        >
          {plugin.handlerStats.errorCount} handler{" "}
          {plugin.handlerStats.errorCount === 1 ? "error" : "errors"}
        </ResourceDetailListItem>
      ) : null}
    </ResourceDetailList>
  );
}

function AutomationsToolView() {
  const location = useLocation();
  const { projectId, automationId } = useParams<{
    projectId?: string;
    automationId?: string;
  }>();
  const { navPanels } = usePluginSlots();
  const panel =
    navPanels.find(
      (candidate) =>
        candidate.pluginId === AUTOMATIONS_PLUGIN_ID &&
        candidate.path === AUTOMATIONS_PLUGIN_PANEL_PATH,
    ) ?? null;
  const subPath =
    projectId && automationId
      ? `${projectId}/${automationId}${
          matchPath(
            { path: TOOLS_AUTOMATION_EDIT_ROUTE_PATH, end: true },
            location.pathname,
          ) !== null
            ? "/edit"
            : ""
        }`
      : "";

  if (panel === null) {
    return (
      <div className="h-full overflow-y-auto">
        <div className="mx-auto w-full max-w-3xl px-4 pb-4 pt-3 md:px-5 md:pt-4">
          <EmptyStatePanel className="rounded-lg p-6 text-sm">
            Automations are still loading, or the automations plugin is not
            available.
          </EmptyStatePanel>
        </div>
      </div>
    );
  }

  const slotMount = (
    <PluginSlotMount
      key={`${panel.pluginId}/${panel.id}/${panel.generation}`}
      pluginId={panel.pluginId}
      slotKind="navPanel"
      slotId={panel.id}
    >
      <panel.component subPath={subPath} />
    </PluginSlotMount>
  );
  const mount =
    typeof Worker === "undefined" ? (
      slotMount
    ) : (
      <WorkerPoolContextProvider
        poolOptions={WORKER_POOL_OPTIONS}
        highlighterOptions={HIGHLIGHTER_OPTIONS}
      >
        {slotMount}
      </WorkerPoolContextProvider>
    );

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto w-full max-w-5xl px-4 pb-4 pt-3 md:px-5 md:pt-4">
        {mount}
      </div>
    </div>
  );
}

export function PluginDetail({
  isLoading,
  plugin,
  pending,
  editDisabled,
  onToggle,
  onReload,
  onEdit,
  onDelete,
  onBack,
}: {
  isLoading: boolean;
  plugin: PluginListItem | null;
  pending: boolean;
  editDisabled: boolean;
  onToggle: (plugin: PluginListItem) => void;
  onReload: (plugin: PluginListItem) => void;
  onEdit: (plugin: PluginListItem) => void;
  onDelete: (plugin: PluginListItem) => void;
  onBack: () => void;
}) {
  const { settingsSections } = usePluginSlots();
  if (isLoading) {
    return <PluginsLoadingRows />;
  }

  if (plugin === null) {
    return (
      <EmptyStatePanel className="py-6">Plugin not found.</EmptyStatePanel>
    );
  }

  const hasSettings =
    plugin.hasSettings ||
    settingsSections.some((section) => section.pluginId === plugin.id);
  const sourceLabel = pluginSourceLabel(plugin);
  const includes = pluginIncludes(plugin);
  const hasActivity =
    (plugin.enabled && plugin.status !== "running") ||
    plugin.handlerStats.errorCount > 0 ||
    plugin.services.length > 0 ||
    plugin.schedules.length > 0;
  const canEditSource = pluginIsLocalSource(plugin);
  const canRemove = pluginCanBeRemoved(plugin);

  return (
    <PluginDetailView
      back={
        <ResourceDetailBackButton label="Back to plugins" onClick={onBack} />
      }
      leading={<PluginListLogo plugin={plugin} />}
      title={plugin.displayName ?? plugin.id}
      titleMeta={sourceLabel}
      metadata={[
        <span key="locator" className="font-mono">
          {plugin.rootDir ?? plugin.source ?? plugin.id}
        </span>,
        `v${plugin.version}`,
      ]}
      description={plugin.description}
      enabled={plugin.enabled}
      lifecycleDisabled={pending}
      onEnabledChange={() => onToggle(plugin)}
      overflowItems={
        plugin.isBuiltin
          ? undefined
          : [
              ...(canEditSource
                ? [
                    {
                      label: "Edit",
                      icon: "Edit" as const,
                      disabled: pending || editDisabled,
                      onSelect: () => onEdit(plugin),
                    },
                  ]
                : []),
              {
                label: "Reload",
                icon: "ArrowReloadHorizontal" as const,
                disabled: pending,
                onSelect: () => onReload(plugin),
              },
              ...(canRemove
                ? [
                    { kind: "separator" as const },
                    {
                      label: pluginRemovalLabel(plugin),
                      icon: "Trash2" as const,
                      tone: "destructive" as const,
                      disabled: pending,
                      onSelect: () => onDelete(plugin),
                    },
                  ]
                : []),
            ]
      }
      definitionSections={[
        ...(hasSettings
          ? [
              {
                label: "Settings",
                content: <PluginSettingsDetail plugin={plugin} />,
              },
            ]
          : []),
        ...(includes.length > 0
          ? [
              {
                label: "Includes",
                content: <ResourceDetailList>{includes}</ResourceDetailList>,
              },
            ]
          : []),
      ]}
      activitySections={
        hasActivity
          ? [{ label: "Activity", content: <PluginActivity plugin={plugin} /> }]
          : []
      }
    />
  );
}

function PluginsToolView({ pluginId }: { pluginId: string | undefined }) {
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<PluginListItem | null>(null);
  const [sortMode, setSortMode] = useState<ToolSortMode>("alpha");
  const [sortDirection, setSortDirection] = useState<ToolSortDirection>("asc");
  // Installed and builtin plugins remain real resources even when the
  // experiment that allows new user plugin installation is disabled.
  const listQuery = usePluginList({ enabled: true });
  const plugins = useMemo(() => listQuery.data ?? [], [listQuery.data]);
  const {
    canOpenPreferredDirectoryTarget,
    openPathInPreferredDirectoryTarget,
  } = useLocalOpenTargets({
    enabled: plugins.some(
      (plugin) => pluginIsLocalSource(plugin) && plugin.rootDir !== null,
    ),
  });
  const normalizedQuery = query.trim().toLowerCase();
  const visiblePlugins = useMemo(() => {
    return plugins
      .filter((plugin) => {
        if (normalizedQuery.length === 0) return true;
        return [
          plugin.id,
          plugin.displayName ?? "",
          plugin.description ?? "",
          plugin.version,
          plugin.source ?? "",
        ]
          .join(" ")
          .toLowerCase()
          .includes(normalizedQuery);
      })
      .sort((left, right) => {
        const base = (left.displayName ?? left.id).localeCompare(
          right.displayName ?? right.id,
        );
        return applyToolSortDirection(base, sortDirection);
      });
  }, [normalizedQuery, plugins, sortDirection]);
  const handleSortChange = useCallback(
    (nextSort: string) => {
      if (nextSort !== "alpha") return;
      if (nextSort === sortMode) {
        setSortDirection((current) => (current === "asc" ? "desc" : "asc"));
        return;
      }
      setSortMode(nextSort);
      setSortDirection("asc");
    },
    [sortMode],
  );
  const pluginToggle = useMutation({
    mutationFn: async (plugin: PluginListItem) => {
      const action = plugin.enabled ? "disable" : "enable";
      const response = await fetch(
        `/api/v1/plugins/${encodeURIComponent(plugin.id)}/${action}`,
        { method: "POST" },
      );
      if (!response.ok) throw new Error(`Failed to ${action} plugin`);
    },
    onSuccess: () => listQuery.refetch(),
    onError: (error) => {
      appToast.error(error instanceof Error ? error.message : String(error));
    },
  });
  const pluginReload = useMutation({
    mutationFn: async (plugin: PluginListItem) => {
      const response = await fetch(
        `/api/v1/plugins/reload?id=${encodeURIComponent(plugin.id)}`,
        { method: "POST" },
      );
      if (!response.ok) throw new Error("Failed to reload plugin");
    },
    onSuccess: () => {
      appToast.success("Plugin reloaded");
      return listQuery.refetch();
    },
    onError: (error) => {
      appToast.error(error instanceof Error ? error.message : String(error));
    },
  });
  const pluginDelete = useMutation({
    mutationFn: async (plugin: PluginListItem) => {
      const response = await fetch(
        `/api/v1/plugins/${encodeURIComponent(plugin.id)}`,
        { method: "DELETE" },
      );
      if (!response.ok) throw new Error("Failed to delete plugin");
    },
    onSuccess: (_data, deletedPlugin) => {
      appToast.success(
        pluginIsLocalSource(deletedPlugin)
          ? "Plugin removed from bb"
          : "Plugin uninstalled",
      );
      setDeleteTarget(null);
      if (pluginId === deletedPlugin.id) {
        navigate(getPluginsRoutePath());
      }
      return listQuery.refetch();
    },
    onError: (error) => {
      appToast.error(error instanceof Error ? error.message : String(error));
    },
  });
  const isLoading = listQuery.isFetching && listQuery.data === undefined;
  const selectedPlugin =
    pluginId !== undefined
      ? (plugins.find((plugin) => plugin.id === pluginId) ?? null)
      : null;
  const pendingPluginId =
    pluginToggle.isPending && pluginToggle.variables
      ? pluginToggle.variables.id
      : pluginReload.isPending && pluginReload.variables
        ? pluginReload.variables.id
        : pluginDelete.isPending && pluginDelete.variables
          ? pluginDelete.variables.id
          : null;
  const hasPlugins = plugins.length > 0;
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
  const backToPlugins = useCallback(() => {
    navigate(getPluginsRoutePath());
  }, [navigate]);
  const handleEditPlugin = useCallback(
    (plugin: PluginListItem) => {
      if (plugin.rootDir === null || !canOpenPreferredDirectoryTarget) return;
      void openPathInPreferredDirectoryTarget({
        path: plugin.rootDir,
        lineNumber: null,
      });
    },
    [canOpenPreferredDirectoryTarget, openPathInPreferredDirectoryTarget],
  );
  const overviewBody = listQuery.isError ? (
    <ResourceListState
      state="error"
      message="Couldn't load plugins."
      onRetry={() => void listQuery.refetch()}
    />
  ) : isLoading ? (
    <PluginsLoadingRows />
  ) : !hasPlugins ? (
    <ResourceListState state="empty" message="No plugins installed." />
  ) : visiblePlugins.length === 0 ? (
    <ResourceListState state="empty" message={`No plugins match "${query}"`} />
  ) : (
    <ResourceListPanel>
      {visiblePlugins.map((plugin) => (
        <PluginListRow
          key={plugin.id}
          plugin={plugin}
          pending={pendingPluginId === plugin.id}
          editDisabled={
            plugin.rootDir === null || !canOpenPreferredDirectoryTarget
          }
          onToggle={(target) => pluginToggle.mutate(target)}
          onEdit={handleEditPlugin}
          onDelete={setDeleteTarget}
        />
      ))}
    </ResourceListPanel>
  );
  const browseExamples = getCreateExamples("plugin").examples;
  const overview = (
    <ResourceOverviewPage
      description="Manage plugins installed in bb. Plugins can add app surfaces, commands, background services, schedules, and skills."
      browse={{
        icon: "ElectricPlugs",
        items: browseExamples.map((example) => ({
          id: example.label,
          content: (
            <ResourceTemplateBrowseCard
              title={example.label}
              description={example.description}
              onUse={() => handleCreatePlugin(example.prompt)}
            />
          ),
        })),
      }}
      installed={{
        headingId: "installed-plugins-heading",
        label: "Installed plugins",
        searchValue: query,
        searchPlaceholder: "Search plugins",
        onSearchChange: setQuery,
        controls: (
          <ResourceSortMenu
            value={sortMode}
            direction={sortDirection}
            options={[{ id: "alpha", label: "Plugin name" }]}
            onChange={handleSortChange}
          />
        ),
        action: (
          <CreateWithTemplatesButton
            kind="plugin"
            label="New plugin"
            onCreate={handleCreatePlugin}
          />
        ),
        body: overviewBody,
      }}
    />
  );

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto w-full max-w-5xl space-y-4 px-4 pb-4 pt-3 md:px-5 md:pt-4">
        {pluginId !== undefined ? (
          listQuery.isError ? (
            <ResourceListState
              state="error"
              message="Couldn't load plugin."
              onRetry={() => void listQuery.refetch()}
            />
          ) : (
            <PluginDetail
              isLoading={isLoading}
              plugin={selectedPlugin}
              pending={
                selectedPlugin !== null && pendingPluginId === selectedPlugin.id
              }
              editDisabled={
                selectedPlugin?.rootDir == null ||
                !canOpenPreferredDirectoryTarget
              }
              onToggle={(target) => pluginToggle.mutate(target)}
              onReload={(target) => pluginReload.mutate(target)}
              onEdit={handleEditPlugin}
              onDelete={setDeleteTarget}
              onBack={backToPlugins}
            />
          )
        ) : (
          overview
        )}
        <ConfirmDeleteDialog
          open={deleteTarget !== null}
          onOpenChange={(open) => {
            if (!open && !pluginDelete.isPending) setDeleteTarget(null);
          }}
        >
          {deleteTarget ? (
            <ConfirmDeleteDialogContent
              title={
                pluginIsLocalSource(deleteTarget)
                  ? "Remove plugin from bb?"
                  : "Uninstall plugin?"
              }
              description={
                pluginIsLocalSource(deleteTarget)
                  ? `Remove "${deleteTarget.id}" from bb? Its source files will stay on disk.`
                  : `Uninstall "${deleteTarget.id}" and delete its managed files and settings?`
              }
              confirmLabel={pluginRemovalLabel(deleteTarget)}
              pending={pluginDelete.isPending}
              onConfirm={() => pluginDelete.mutate(deleteTarget)}
              onCancel={() => setDeleteTarget(null)}
            />
          ) : null}
        </ConfirmDeleteDialog>
      </div>
    </div>
  );
}

export function ToolsView() {
  const location = useLocation();
  const { pluginId } = useParams<{
    pluginId?: string;
  }>();
  const activeSection = getToolsSection(location.pathname);

  return (
    <div className="-mx-4 -mb-4 -mt-4 flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden md:-mx-5 md:-mb-5 md:-mt-5">
      <div className="min-h-0 flex-1 overflow-hidden">
        <Suspense fallback={<ToolsBodyFallback />}>
          <ToolsSectionBody activeSection={activeSection} pluginId={pluginId} />
        </Suspense>
      </div>
    </div>
  );
}

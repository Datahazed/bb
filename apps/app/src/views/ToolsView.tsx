import { useMemo, type ReactNode } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { WorkerPoolContextProvider } from "@pierre/diffs/react";
import { useMutation } from "@tanstack/react-query";
import { PERSONAL_PROJECT_ID } from "@bb/domain";
import type { SkillProvider, SkillSummary } from "@bb/server-contract";
import {
  CREATE_PLUGIN_PROMPT,
  CreateWithTemplatesButton,
} from "@/components/create-via-prompt-examples";
import { appToast } from "@/components/ui/app-toast";
import { Button } from "@bb/shared-ui/button";
import { EmptyStatePanel } from "@bb/shared-ui/empty-state";
import { Icon, type IconName } from "@bb/shared-ui/icon";
import { Skeleton } from "@bb/shared-ui/skeleton";
import { Switch } from "@bb/shared-ui/switch";
import { PluginSlotMount } from "@/components/plugin/PluginSlotMount";
import {
  usePluginList,
  type PluginListItem,
} from "@/hooks/queries/plugin-settings-queries";
import { useProjectSkills } from "@/hooks/queries/skills-queries";
import { usePreferredTheme } from "@/hooks/useTheme";
import {
  createDiffWorker,
  getDiffWorkerPoolSize,
} from "@/lib/diff-worker-pool";
import { usePluginSlots } from "@/lib/plugin-slots";
import {
  AUTOMATIONS_PLUGIN_ID,
  AUTOMATIONS_PLUGIN_PANEL_PATH,
  getAutomationsRoutePath,
  getPluginDetailRoutePath,
  getPluginsRoutePath,
  getRootComposeRoutePath,
  getSkillsRoutePath,
} from "@/lib/route-paths";
import { cn } from "@bb/shared-ui/lib/utils";
import { ProviderLogo, SkillsLibrary } from "./SkillsView";

const WORKER_POOL_OPTIONS = {
  workerFactory: createDiffWorker,
  poolSize: getDiffWorkerPoolSize(),
};
const HIGHLIGHTER_OPTIONS = {};

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
    icon: "ElectricPlugs",
    to: getPluginsRoutePath(),
  },
  {
    id: "automations",
    label: "Automations",
    icon: "TimeSchedule",
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

function StatusDot({
  tone,
}: {
  tone: "success" | "warning" | "error" | "muted";
}) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "size-1.5 shrink-0 rounded-full",
        tone === "success" && "bg-success",
        tone === "warning" && "bg-warning",
        tone === "error" && "bg-destructive",
        tone === "muted" && "bg-muted-foreground/50",
      )}
    />
  );
}

function StatusLabel({
  tone,
  children,
}: {
  tone: "success" | "warning" | "error" | "muted";
  children: string;
}) {
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
      <StatusDot tone={tone} />
      <span className="truncate">{children}</span>
    </span>
  );
}

function ResourceTaxonomy({
  items,
}: {
  items: readonly { label: string; value: ReactNode }[];
}) {
  return (
    <dl className="grid gap-2 rounded-md border border-border bg-surface-recessed p-3 text-xs sm:grid-cols-3">
      {items.map((item) => (
        <div key={item.label} className="min-w-0">
          <dt className="text-subtle-foreground">{item.label}</dt>
          <dd className="mt-0.5 min-w-0 text-foreground">{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}

function pluginStatusTone(
  plugin: PluginListItem,
): "success" | "warning" | "error" | "muted" {
  if (!plugin.enabled) return "muted";
  if (plugin.status === "running") return "success";
  if (plugin.status === "needs-configuration" || plugin.status === "degraded") {
    return "warning";
  }
  if (plugin.status === "error" || plugin.status === "incompatible") {
    return "error";
  }
  return "muted";
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
      name="ElectricPlugs"
      className="size-4 shrink-0 text-muted-foreground"
      aria-hidden
    />
  );
}

function PluginListRow({
  plugin,
  pending,
  onToggle,
}: {
  plugin: PluginListItem;
  pending: boolean;
  onToggle: (plugin: PluginListItem) => void;
}) {
  return (
    <div className="group flex min-w-0 items-start gap-2 rounded-md px-3 py-2 text-left transition-colors hover:bg-state-hover">
      <PluginListLogo plugin={plugin} />
      <Link
        to={getPluginDetailRoutePath({ pluginId: plugin.id })}
        className="min-w-0 flex-1 rounded-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
      >
        <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          <span className="truncate text-sm font-medium text-foreground">
            {plugin.id}
          </span>
          <span className="text-xs text-muted-foreground">
            v{plugin.version}
          </span>
          <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
            <StatusDot tone={pluginStatusTone(plugin)} />
            {plugin.enabled ? plugin.status : "disabled"}
          </span>
        </span>
        {plugin.description !== null && plugin.description.length > 0 ? (
          <span className="mt-1 block truncate text-xs text-subtle-foreground">
            {plugin.description}
          </span>
        ) : plugin.statusDetail !== null && plugin.statusDetail.length > 0 ? (
          <span className="mt-1 block truncate text-xs text-subtle-foreground">
            {plugin.statusDetail}
          </span>
        ) : null}
      </Link>
      <Switch
        checked={plugin.enabled}
        disabled={pending}
        aria-label={`${plugin.enabled ? "Disable" : "Enable"} ${plugin.id}`}
        onCheckedChange={() => onToggle(plugin)}
      />
      <Link
        to={getPluginDetailRoutePath({ pluginId: plugin.id })}
        aria-label={`Open ${plugin.id}`}
        className="mt-0.5 rounded-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
      >
        <Icon
          name="ChevronRight"
          className="size-4 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100"
          aria-hidden
        />
      </Link>
    </div>
  );
}

interface ProviderInstalledPlugin {
  name: string;
  providers: SkillProvider[];
  skillCount: number;
  description: string | null;
}

const PROVIDER_LABELS: Record<SkillProvider, string> = {
  "claude-code": "Claude Code",
  codex: "Codex",
};

function providerPluginNameFromSkill(skillName: string): string | null {
  const separatorIndex = skillName.indexOf(":");
  if (separatorIndex <= 0) return null;
  return skillName.slice(0, separatorIndex);
}

function providerPluginsFromSkills(
  skills: readonly SkillSummary[],
): ProviderInstalledPlugin[] {
  const byKey = new Map<
    string,
    {
      name: string;
      providers: Set<SkillProvider>;
      skills: Set<string>;
      description: string | null;
    }
  >();
  for (const skill of skills) {
    if (skill.scope !== "plugin" || skill.provider === null) continue;
    const name = providerPluginNameFromSkill(skill.name);
    if (name === null) continue;
    const existing = byKey.get(name);
    if (existing) {
      existing.providers.add(skill.provider);
      existing.skills.add(`${skill.provider}:${skill.name}`);
      if (existing.description === null && skill.description) {
        existing.description = skill.description;
      }
      continue;
    }
    byKey.set(name, {
      name,
      providers: new Set([skill.provider]),
      skills: new Set([`${skill.provider}:${skill.name}`]),
      description: skill.description,
    });
  }
  return [...byKey.values()]
    .map((plugin) => ({
      name: plugin.name,
      providers: [...plugin.providers].sort(),
      skillCount: plugin.skills.size,
      description: plugin.description,
    }))
    .sort((left, right) => left.name.localeCompare(right.name));
}

function ProviderInstalledPluginRow({
  plugin,
}: {
  plugin: ProviderInstalledPlugin;
}) {
  return (
    <div className="flex min-w-0 items-start gap-2 rounded-md px-3 py-2 text-left">
      <Icon
        name="ElectricPlugs"
        className="mt-0.5 size-4 shrink-0 text-muted-foreground"
        aria-hidden
      />
      <span className="min-w-0 flex-1">
        <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          <span className="truncate text-sm font-medium text-foreground">
            {plugin.name}
          </span>
          <span className="inline-flex items-center gap-1">
            {plugin.providers.map((provider) => (
              <ProviderLogo
                key={provider}
                providerId={provider}
                className="size-3.5 shrink-0"
              />
            ))}
          </span>
          <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
            <StatusDot tone="success" />
            Installed
          </span>
        </span>
        {plugin.description ? (
          <span className="mt-1 block truncate text-xs text-subtle-foreground">
            {plugin.description}
          </span>
        ) : (
          <span className="mt-1 block text-xs text-subtle-foreground">
            {plugin.providers
              .map((provider) => PROVIDER_LABELS[provider])
              .join(", ")}
            {" · "}
            {plugin.skillCount} {plugin.skillCount === 1 ? "skill" : "skills"}
          </span>
        )}
      </span>
    </div>
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

function AutomationsToolView() {
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
    projectId && automationId ? `${projectId}/${automationId}` : "";

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

function PluginDetail({
  isLoading,
  plugin,
  pending,
  onToggle,
}: {
  isLoading: boolean;
  plugin: PluginListItem | null;
  pending: boolean;
  onToggle: (plugin: PluginListItem) => void;
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
      <Button
        asChild
        type="button"
        variant="ghost"
        size="sm"
        className="h-7 w-fit px-2 text-muted-foreground hover:text-foreground"
      >
        <Link to={getPluginsRoutePath()}>
          <Icon name="ChevronLeft" className="size-3.5" />
          Plugins
        </Link>
      </Button>
      <div className="space-y-4 rounded-md border border-border bg-popover p-4 text-popover-foreground">
        <div className="flex min-w-0 items-start gap-3">
          <PluginListLogo plugin={plugin} />
          <div className="min-w-0 flex-1 space-y-1">
            <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
              <h1 className="truncate text-base font-semibold">{plugin.id}</h1>
              <span className="text-xs text-muted-foreground">
                v{plugin.version}
              </span>
              <StatusLabel tone={pluginStatusTone(plugin)}>
                {plugin.enabled ? plugin.status : "disabled"}
              </StatusLabel>
            </div>
            {plugin.description ? (
              <p className="text-sm leading-relaxed text-muted-foreground">
                {plugin.description}
              </p>
            ) : plugin.statusDetail ? (
              <p className="text-sm leading-relaxed text-muted-foreground">
                {plugin.statusDetail}
              </p>
            ) : null}
          </div>
          <Switch
            checked={plugin.enabled}
            disabled={pending}
            aria-label={`${plugin.enabled ? "Disable" : "Enable"} ${plugin.id}`}
            onCheckedChange={() => onToggle(plugin)}
          />
        </div>
        <ResourceTaxonomy
          items={[
            { label: "Kind", value: "bb plugin" },
            {
              label: "Status",
              value: plugin.enabled ? plugin.status : "disabled",
            },
            { label: "Version", value: plugin.version },
          ]}
        />
      </div>
    </div>
  );
}

function PluginsToolView({ pluginId }: { pluginId: string | undefined }) {
  const navigate = useNavigate();
  const listQuery = usePluginList();
  const plugins = listQuery.data ?? [];
  const skillsQuery = useProjectSkills(PERSONAL_PROJECT_ID);
  const providerPlugins = useMemo(
    () => providerPluginsFromSkills(skillsQuery.data?.skills ?? []),
    [skillsQuery.data],
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
    onSuccess: () => void listQuery.refetch(),
    onError: (error) => {
      appToast.error(error instanceof Error ? error.message : String(error));
    },
  });
  const isLoading = listQuery.isFetching && listQuery.data === undefined;
  const selectedPlugin =
    pluginId !== undefined
      ? (plugins.find((plugin) => plugin.id === pluginId) ?? null)
      : null;
  const isProviderPluginsLoading =
    skillsQuery.isFetching && skillsQuery.data === undefined;
  const pendingPluginId =
    pluginToggle.isPending && pluginToggle.variables
      ? pluginToggle.variables.id
      : null;
  const hasPluginRows = plugins.length > 0 || providerPlugins.length > 0;
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
          <PluginDetail
            isLoading={isLoading}
            plugin={selectedPlugin}
            pending={
              selectedPlugin !== null && pendingPluginId === selectedPlugin.id
            }
            onToggle={(target) => pluginToggle.mutate(target)}
          />
        ) : listQuery.isError ? (
          <>
            {createButton}
            <EmptyStatePanel role="alert" className="py-6">
              Couldn't load plugins.
            </EmptyStatePanel>
          </>
        ) : isLoading || (!hasPluginRows && isProviderPluginsLoading) ? (
          <>
            {createButton}
            <PluginsLoadingRows />
          </>
        ) : !hasPluginRows ? (
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
              {providerPlugins.map((plugin) => (
                <ProviderInstalledPluginRow key={plugin.name} plugin={plugin} />
              ))}
              {plugins.map((plugin) => (
                <PluginListRow
                  key={plugin.id}
                  plugin={plugin}
                  pending={pendingPluginId === plugin.id}
                  onToggle={(target) => pluginToggle.mutate(target)}
                />
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
        {activeTab === "automations" ? <AutomationsToolView /> : null}
      </div>
    </div>
  );
}

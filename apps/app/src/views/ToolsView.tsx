import { useMemo } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery } from "@tanstack/react-query";
import { PERSONAL_PROJECT_ID } from "@bb/domain";
import type { SkillProvider, SkillSummary } from "@bb/server-contract";
import {
  CREATE_PLUGIN_PROMPT,
  CreateWithTemplatesButton,
} from "@/components/create-via-prompt-examples";
import { appToast } from "@/components/ui/app-toast";
import { EmptyStatePanel } from "@bb/shared-ui/empty-state";
import { Icon, type IconName } from "@bb/shared-ui/icon";
import { Pill } from "@bb/shared-ui/pill";
import { Skeleton } from "@bb/shared-ui/skeleton";
import { Switch } from "@bb/shared-ui/switch";
import { PluginRow } from "@/components/settings/PluginsSettingsSection";
import {
  usePluginList,
  type PluginListItem,
} from "@/hooks/queries/plugin-settings-queries";
import { useProjectSkills } from "@/hooks/queries/skills-queries";
import { usePreferredTheme } from "@/hooks/useTheme";
import { CREATE_AUTOMATION_PROMPT } from "@/lib/automation-prompt";
import {
  formatScheduleStatusLabel,
  isCompletedOneShotAutomation,
  type AutomationTrigger,
} from "@/lib/format-schedule";
import { callPluginRpc } from "@/lib/plugin-sdk-hooks";
import {
  AUTOMATIONS_PLUGIN_ID,
  getAutomationDetailRoutePath,
  getAutomationsRoutePath,
  getPluginDetailRoutePath,
  getPluginsRoutePath,
  getRootComposeRoutePath,
  getSkillsRoutePath,
} from "@/lib/route-paths";
import { cn } from "@bb/shared-ui/lib/utils";
import { ProviderLogo, SkillsLibrary } from "./SkillsView";

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

type AutomationRunStatus = "running" | "succeeded" | "failed" | "skipped";
type AutomationExecution =
  | { mode: "agent" }
  | { mode: "script"; script?: string; scriptFile?: string };

interface AutomationSummary {
  id: string;
  projectId: string;
  name: string;
  enabled: boolean;
  trigger: AutomationTrigger;
  execution: AutomationExecution;
  origin: "human" | "app" | "agent";
  nextRunAt: number | null;
  runCount: number;
  lastRunStatus: AutomationRunStatus | null;
}

interface AutomationOverviewEntry {
  automation: AutomationSummary;
  project: { id: string; name: string };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function parseAutomationTrigger(value: unknown): AutomationTrigger | null {
  if (!isRecord(value)) return null;
  if (
    value.triggerType === "schedule" &&
    typeof value.cron === "string" &&
    typeof value.timezone === "string"
  ) {
    return {
      triggerType: "schedule",
      cron: value.cron,
      timezone: value.timezone,
    };
  }
  if (value.triggerType === "once" && typeof value.runAt === "number") {
    return { triggerType: "once", runAt: value.runAt };
  }
  return null;
}

function parseAutomationExecution(value: unknown): AutomationExecution | null {
  if (!isRecord(value)) return null;
  if (value.mode === "agent") return { mode: "agent" };
  if (value.mode === "script") {
    return {
      mode: "script",
      ...(typeof value.script === "string" ? { script: value.script } : {}),
      ...(typeof value.scriptFile === "string"
        ? { scriptFile: value.scriptFile }
        : {}),
    };
  }
  return null;
}

function parseAutomation(value: unknown): AutomationSummary | null {
  if (!isRecord(value)) return null;
  const trigger = parseAutomationTrigger(value.trigger);
  const execution = parseAutomationExecution(value.execution);
  if (
    typeof value.id !== "string" ||
    typeof value.projectId !== "string" ||
    typeof value.name !== "string" ||
    typeof value.enabled !== "boolean" ||
    trigger === null ||
    execution === null ||
    (value.origin !== "human" &&
      value.origin !== "app" &&
      value.origin !== "agent") ||
    !(value.nextRunAt === null || typeof value.nextRunAt === "number") ||
    typeof value.runCount !== "number" ||
    !(
      value.lastRunStatus === null ||
      value.lastRunStatus === "running" ||
      value.lastRunStatus === "succeeded" ||
      value.lastRunStatus === "failed" ||
      value.lastRunStatus === "skipped"
    )
  ) {
    return null;
  }
  return {
    id: value.id,
    projectId: value.projectId,
    name: value.name,
    enabled: value.enabled,
    trigger,
    execution,
    origin: value.origin,
    nextRunAt: value.nextRunAt,
    runCount: value.runCount,
    lastRunStatus: value.lastRunStatus,
  };
}

function parseAutomationOverview(value: unknown): AutomationOverviewEntry[] {
  if (!isRecord(value) || !Array.isArray(value.automations)) return [];
  return value.automations.flatMap((entry) => {
    if (!isRecord(entry) || !isRecord(entry.project)) return [];
    const automation = parseAutomation(entry.automation);
    if (
      automation === null ||
      typeof entry.project.id !== "string" ||
      typeof entry.project.name !== "string"
    ) {
      return [];
    }
    return [
      {
        automation,
        project: { id: entry.project.id, name: entry.project.name },
      },
    ];
  });
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
        {plugin.statusDetail !== null && plugin.statusDetail.length > 0 ? (
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
  provider: SkillProvider;
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
  const byKey = new Map<string, ProviderInstalledPlugin>();
  for (const skill of skills) {
    if (skill.scope !== "plugin" || skill.provider === null) continue;
    const name = providerPluginNameFromSkill(skill.name);
    if (name === null) continue;
    const key = `${skill.provider}:${name}`;
    const existing = byKey.get(key);
    if (existing) {
      existing.skillCount += 1;
      if (existing.description === null && skill.description) {
        existing.description = skill.description;
      }
      continue;
    }
    byKey.set(key, {
      name,
      provider: skill.provider,
      skillCount: 1,
      description: skill.description,
    });
  }
  return [...byKey.values()].sort(
    (left, right) =>
      left.provider.localeCompare(right.provider) ||
      left.name.localeCompare(right.name),
  );
}

function ProviderInstalledPluginRow({
  plugin,
}: {
  plugin: ProviderInstalledPlugin;
}) {
  return (
    <div className="flex min-w-0 items-start gap-2 rounded-md px-3 py-2 text-left">
      <ProviderLogo providerId={plugin.provider} className="size-4 shrink-0" />
      <span className="min-w-0 flex-1">
        <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          <span className="truncate text-sm font-medium text-foreground">
            {plugin.name}
          </span>
          <span className="text-xs text-muted-foreground">
            {PROVIDER_LABELS[plugin.provider]} plugin
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
            {plugin.skillCount} {plugin.skillCount === 1 ? "skill" : "skills"}
          </span>
        )}
      </span>
    </div>
  );
}

function AutomationListRow({
  entry,
  pending,
  onToggle,
}: {
  entry: AutomationOverviewEntry;
  pending: boolean;
  onToggle: (entry: AutomationOverviewEntry) => void;
}) {
  const { automation, project } = entry;
  const completedOneShot = isCompletedOneShotAutomation({
    enabled: automation.enabled,
    trigger: automation.trigger,
    runCount: automation.runCount,
  });
  const detailPath = getAutomationDetailRoutePath({
    projectId: automation.projectId,
    automationId: automation.id,
  });
  return (
    <div className="group flex min-w-0 items-center gap-2 rounded-md px-3 py-2 text-left transition-colors hover:bg-state-hover">
      <Icon
        name={
          automation.execution.mode === "script"
            ? "ComputerTerminal01"
            : "ArrowReloadHorizontal"
        }
        className="size-4 shrink-0 text-muted-foreground"
        aria-hidden
      />
      <StatusDot tone={automation.enabled ? "success" : "muted"} />
      <Link
        to={detailPath}
        className="min-w-0 flex-1 truncate rounded-sm text-sm font-medium text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
      >
        {automation.name}
      </Link>
      {project.id === PERSONAL_PROJECT_ID ? null : (
        <Pill variant="outline" className="shrink-0">
          {project.name}
        </Pill>
      )}
      <span className="shrink-0 text-xs text-muted-foreground">
        {formatScheduleStatusLabel({
          enabled: automation.enabled,
          nextRunAt: automation.nextRunAt,
          trigger: automation.trigger,
          runCount: automation.runCount,
        })}
      </span>
      <Switch
        checked={automation.enabled}
        disabled={pending || completedOneShot}
        aria-label={`${automation.enabled ? "Pause" : "Resume"} ${automation.name}`}
        onCheckedChange={() => onToggle(entry)}
      />
      <Link
        to={detailPath}
        aria-label={`Open ${automation.name}`}
        className="rounded-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
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

function AutomationsLoadingRows() {
  return (
    <div className="space-y-0.5" aria-busy aria-label="Loading automations">
      {["w-40", "w-56", "w-32"].map((nameWidth) => (
        <div key={nameWidth} className="flex items-center gap-2 px-3 py-2">
          <Skeleton className="size-4 shrink-0 rounded" />
          <Skeleton className="size-1.5 shrink-0 rounded-full" />
          <Skeleton className={cn("h-3.5", nameWidth)} />
          <Skeleton className="ml-auto h-3 w-24" />
        </div>
      ))}
    </div>
  );
}

function AutomationsToolView() {
  const navigate = useNavigate();
  const automationsQuery = useQuery({
    queryKey: ["tools-hub", "automations-overview"],
    queryFn: async () =>
      parseAutomationOverview(
        await callPluginRpc(
          fetch,
          AUTOMATIONS_PLUGIN_ID,
          "automations_overview",
        ),
      ),
    staleTime: 15_000,
  });
  const automationToggle = useMutation({
    mutationFn: async (entry: AutomationOverviewEntry) => {
      await callPluginRpc(
        fetch,
        AUTOMATIONS_PLUGIN_ID,
        entry.automation.enabled ? "automations_pause" : "automations_resume",
        {
          projectId: entry.automation.projectId,
          automationId: entry.automation.id,
        },
      );
    },
    onSuccess: () => void automationsQuery.refetch(),
    onError: (error) => {
      appToast.error(error instanceof Error ? error.message : String(error));
    },
  });
  const entries = automationsQuery.data ?? [];
  const pendingAutomationId =
    automationToggle.isPending && automationToggle.variables
      ? automationToggle.variables.automation.id
      : null;
  const isLoading =
    automationsQuery.isFetching && automationsQuery.data === undefined;
  const handleCreateAutomation = (prompt?: string) => {
    navigate(getRootComposeRoutePath(), {
      state: {
        focusPrompt: true,
        initialPrompt: prompt ?? CREATE_AUTOMATION_PROMPT,
        replaceInitialPrompt: true,
        createDraftKind: "automation",
      },
    });
  };
  const createButton = (
    <div className="flex justify-end">
      <CreateWithTemplatesButton
        kind="automation"
        label="New automation"
        onCreate={handleCreateAutomation}
      />
    </div>
  );

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto w-full max-w-5xl space-y-4 px-4 pb-4 pt-3 md:px-5 md:pt-4">
        {automationsQuery.isError ? (
          <>
            {createButton}
            <EmptyStatePanel role="alert" className="py-6">
              Couldn't load automations.
            </EmptyStatePanel>
          </>
        ) : isLoading ? (
          <>
            {createButton}
            <AutomationsLoadingRows />
          </>
        ) : entries.length === 0 ? (
          <>
            {createButton}
            <EmptyStatePanel className="py-6">
              No automations yet.
            </EmptyStatePanel>
          </>
        ) : (
          <>
            {createButton}
            <div className="space-y-0.5">
              {entries.map((entry) => (
                <AutomationListRow
                  key={entry.automation.id}
                  entry={entry}
                  pending={pendingAutomationId === entry.automation.id}
                  onToggle={(target) => automationToggle.mutate(target)}
                />
              ))}
            </div>
          </>
        )}
      </div>
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
      <div className="rounded-md border border-border">
        <PluginRow plugin={plugin} />
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
          <PluginDetail isLoading={isLoading} plugin={selectedPlugin} />
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
                <ProviderInstalledPluginRow
                  key={`${plugin.provider}:${plugin.name}`}
                  plugin={plugin}
                />
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

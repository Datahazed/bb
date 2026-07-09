import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import {
  matchPath,
  useLocation,
  useNavigate,
  useParams,
} from "react-router-dom";
import { WorkerPoolContextProvider } from "@pierre/diffs/react";
import { useMutation } from "@tanstack/react-query";
import { PERSONAL_PROJECT_ID } from "@bb/domain";
import type { SkillProvider, SkillSummary } from "@bb/server-contract";
import {
  CREATE_PLUGIN_PROMPT,
  CreateWithTemplatesButton,
  getCreateExamples,
} from "@/components/create-via-prompt-examples";
import { appToast } from "@/components/ui/app-toast";
import { Button } from "@bb/shared-ui/button";
import {
  ResourceActionButton,
  ResourceBrowseCard,
  ResourceListPanel,
  ResourceListState,
  ResourceMultiSelectMenu,
  ResourceRow,
  ResourceShelfSeeAllAction,
  ResourceSortMenu,
  ResourceSourceItem,
  ResourceSourceShelf,
  ResourceTabDescription,
  ResourceToolbar,
} from "@bb/shared-ui/resource-list";
import { EmptyStatePanel } from "@bb/shared-ui/empty-state";
import { Icon } from "@bb/shared-ui/icon";
import { Skeleton } from "@bb/shared-ui/skeleton";
import { PluginSlotMount } from "@/components/plugin/PluginSlotMount";
import {
  PluginDetailView,
  type PluginDetailHealth,
} from "@/components/tools/PluginDetailView";
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
  TOOLS_AUTOMATION_EDIT_ROUTE_PATH,
  getAutomationBrowseRoutePath,
  getAutomationsRoutePath,
  getPluginBrowseRoutePath,
  getPluginDetailRoutePath,
  getPluginsRoutePath,
  getRootComposeRoutePath,
} from "@/lib/route-paths";
import { cn } from "@bb/shared-ui/lib/utils";
import { ProviderLogo, SkillsLibrary } from "./SkillsView";

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

function pluginDetailHealth(
  plugin: PluginListItem,
): PluginDetailHealth | undefined {
  if (!plugin.enabled || plugin.status === "running") return undefined;
  const tone = pluginStatusTone(plugin);
  if (tone === "success" || tone === "muted") return undefined;
  return { label: plugin.status, tone };
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

function PluginListRow({
  plugin,
  pending,
  onToggle,
}: {
  plugin: PluginListItem;
  pending: boolean;
  onToggle: (plugin: PluginListItem) => void;
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
      title={
        <>
          {plugin.id}
          <span className="ml-2 text-xs font-normal text-muted-foreground">
            v{plugin.version}
          </span>
        </>
      }
      description={description}
      onOpen={() => void navigate(detailPath)}
      actions={
        <>
          <ResourceActionButton
            label={`${plugin.enabled ? "Disable" : "Enable"} ${plugin.id}`}
            icon={plugin.enabled ? "Pause" : "Play"}
            disabled={pending}
            onClick={() => onToggle(plugin)}
          />
          <ResourceActionButton
            label={`Open ${plugin.id}`}
            icon="ChevronRight"
            disabled={pending}
            onClick={() => void navigate(detailPath)}
          />
        </>
      }
    />
  );
}

interface ProviderInstalledPlugin {
  name: string;
  providers: SkillProvider[];
  skillCount: number;
  skillNames: string[];
  description: string | null;
}

const PROVIDER_LABELS: Record<SkillProvider, string> = {
  "claude-code": "Claude Code",
  codex: "Codex",
};

type ToolProviderFilter = "bb" | SkillProvider;
type ToolSortMode = "provider" | "alpha";
type ToolSortDirection = "asc" | "desc";

const TOOL_PROVIDER_FILTERS: readonly ToolProviderFilter[] = [
  "bb",
  "claude-code",
  "codex",
];

function toolProviderLabel(provider: ToolProviderFilter): string {
  if (provider === "bb") return "bb";
  return PROVIDER_LABELS[provider];
}

function compareProviderFilters(
  left: ToolProviderFilter,
  right: ToolProviderFilter,
): number {
  return toolProviderLabel(left).localeCompare(toolProviderLabel(right));
}

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

function ProviderPluginLogoStack({
  providers,
}: {
  providers: readonly SkillProvider[];
}) {
  return (
    <span className="flex -space-x-1">
      {providers.slice(0, 2).map((provider) => (
        <ProviderLogo
          key={provider}
          providerId={provider}
          className="size-4 rounded-sm bg-background"
        />
      ))}
    </span>
  );
}

function providerPluginNameFromSkill(skillName: string): string | null {
  const separatorIndex = skillName.indexOf(":");
  if (separatorIndex <= 0) return null;
  return skillName.slice(0, separatorIndex);
}

const PROVIDER_PLUGIN_ROUTE_PREFIX = "provider:";

function getProviderPluginRouteId(pluginName: string): string {
  return `${PROVIDER_PLUGIN_ROUTE_PREFIX}${pluginName}`;
}

function getProviderPluginNameFromRouteId(pluginId: string): string | null {
  return pluginId.startsWith(PROVIDER_PLUGIN_ROUTE_PREFIX)
    ? pluginId.slice(PROVIDER_PLUGIN_ROUTE_PREFIX.length)
    : null;
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
      skillNames: Set<string>;
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
      existing.skillNames.add(skill.name);
      if (existing.description === null && skill.description) {
        existing.description = skill.description;
      }
      continue;
    }
    byKey.set(name, {
      name,
      providers: new Set([skill.provider]),
      skills: new Set([`${skill.provider}:${skill.name}`]),
      skillNames: new Set([skill.name]),
      description: skill.description,
    });
  }
  return [...byKey.values()]
    .map((plugin) => ({
      name: plugin.name,
      providers: [...plugin.providers].sort(),
      skillCount: plugin.skills.size,
      skillNames: [...plugin.skillNames].sort(),
      description: plugin.description,
    }))
    .sort((left, right) => left.name.localeCompare(right.name));
}

function ProviderInstalledPluginRow({
  plugin,
}: {
  plugin: ProviderInstalledPlugin;
}) {
  const navigate = useNavigate();
  const detailPath = getPluginDetailRoutePath({
    pluginId: getProviderPluginRouteId(plugin.name),
  });
  const description =
    plugin.description ??
    `${plugin.providers
      .map((provider) => PROVIDER_LABELS[provider])
      .join(", ")} · ${plugin.skillCount} ${
      plugin.skillCount === 1 ? "skill" : "skills"
    }`;
  return (
    <ResourceRow
      leading={<ProviderPluginLogoStack providers={plugin.providers} />}
      title={plugin.name}
      description={description}
      onOpen={() => void navigate(detailPath)}
      actions={
        <ResourceActionButton
          label={`Open ${plugin.name}`}
          icon="ChevronRight"
          onClick={() => void navigate(detailPath)}
        />
      }
    />
  );
}

function PluginsLoadingRows() {
  return <ResourceListState state="loading" message="Loading plugins" />;
}

type PluginToolRow =
  | {
      kind: "bb";
      id: string;
      name: string;
      provider: "bb";
      description: string;
      plugin: PluginListItem;
    }
  | {
      kind: "provider";
      id: string;
      name: string;
      provider: SkillProvider;
      providers: readonly SkillProvider[];
      description: string;
      plugin: ProviderInstalledPlugin;
    };

function buildPluginRows({
  plugins,
  providerPlugins,
}: {
  plugins: readonly PluginListItem[];
  providerPlugins: readonly ProviderInstalledPlugin[];
}): PluginToolRow[] {
  return [
    ...plugins.map(
      (plugin): PluginToolRow => ({
        kind: "bb",
        id: `bb:${plugin.id}`,
        name: plugin.id,
        provider: "bb",
        description: plugin.description ?? plugin.statusDetail ?? "",
        plugin,
      }),
    ),
    ...providerPlugins.map((plugin): PluginToolRow => {
      const provider = plugin.providers[0] ?? "codex";
      return {
        kind: "provider",
        id: `provider:${plugin.name}`,
        name: plugin.name,
        provider,
        providers: plugin.providers,
        description:
          plugin.description ??
          `${plugin.providers
            .map((providerId) => PROVIDER_LABELS[providerId])
            .join(", ")} · ${plugin.skillCount} ${
            plugin.skillCount === 1 ? "skill" : "skills"
          }`,
        plugin,
      };
    }),
  ];
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
    location.pathname === getAutomationBrowseRoutePath()
      ? "browse"
      : projectId && automationId
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

function PluginDetail({
  isLoading,
  plugin,
  pending,
  onToggle,
  onReload,
}: {
  isLoading: boolean;
  plugin: PluginListItem | null;
  pending: boolean;
  onToggle: (plugin: PluginListItem) => void;
  onReload: (plugin: PluginListItem) => void;
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
    <PluginDetailView
      leading={<PluginListLogo plugin={plugin} />}
      title={plugin.id}
      health={pluginDetailHealth(plugin)}
      metadata={[`v${plugin.version}`]}
      description={plugin.description ?? plugin.statusDetail}
      enabled={plugin.enabled}
      lifecycleDisabled={pending}
      onEnabledChange={() => onToggle(plugin)}
      overflowItems={[
        {
          label: "Reload",
          icon: "ArrowReloadHorizontal",
          disabled: pending,
          onSelect: () => onReload(plugin),
        },
      ]}
      properties={
        plugin.statusDetail
          ? [{ label: "Status detail", value: plugin.statusDetail }]
          : []
      }
    />
  );
}

function ProviderPluginDetail({
  plugin,
}: {
  plugin: ProviderInstalledPlugin | null;
}) {
  if (plugin === null) {
    return (
      <EmptyStatePanel className="py-6">Plugin not found.</EmptyStatePanel>
    );
  }

  return (
    <PluginDetailView
      leading={<ProviderPluginLogoStack providers={plugin.providers} />}
      title={plugin.name}
      metadata={[
        plugin.providers
          .map((provider) => PROVIDER_LABELS[provider])
          .join(", "),
        `${plugin.skillCount} ${plugin.skillCount === 1 ? "skill" : "skills"}`,
      ]}
      description={plugin.description}
      properties={[]}
      sections={[
        {
          label: "Skills",
          content: (
            <div className="space-y-1">
              {plugin.skillNames.map((skillName) => (
                <div
                  key={skillName}
                  className="flex items-center gap-2 rounded-md px-3 py-2 text-sm"
                >
                  <Icon
                    name="Zap"
                    className="size-4 shrink-0 text-muted-foreground"
                    aria-hidden
                  />
                  <span className="min-w-0 flex-1 truncate">{skillName}</span>
                </div>
              ))}
            </div>
          ),
        },
      ]}
    />
  );
}

function PluginBrowseCard({
  example,
  onCreate,
}: {
  example: ReturnType<typeof getCreateExamples>["examples"][number];
  onCreate: (prompt?: string) => void;
}) {
  return (
    <ResourceBrowseCard
      leading={
        <Icon
          name="ElectricPlugs"
          className="size-5 text-muted-foreground"
          aria-hidden
        />
      }
      title={example.label}
      byline="Starter template"
      description={example.description}
      openLabel={`Use ${example.label} template`}
      headerAction={
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-7 px-2 text-xs"
          onClick={() => onCreate(example.prompt)}
        >
          Use template
        </Button>
      }
      onOpen={() => onCreate(example.prompt)}
    />
  );
}

function PluginBrowseShelf({
  onCreate,
  onBrowseAll,
}: {
  onCreate: (prompt?: string) => void;
  onBrowseAll: () => void;
}) {
  const { examples } = getCreateExamples("plugin");
  return (
    <ResourceSourceShelf
      label="Browse"
      leading={
        <Icon
          name="ElectricPlugs"
          className="size-3.5 shrink-0 text-muted-foreground"
          aria-hidden
        />
      }
      browseAction={
        <ResourceShelfSeeAllAction type="button" onClick={onBrowseAll} />
      }
    >
      {examples.map((example) => (
        <ResourceSourceItem key={example.label}>
          <PluginBrowseCard example={example} onCreate={onCreate} />
        </ResourceSourceItem>
      ))}
    </ResourceSourceShelf>
  );
}

function PluginBrowsePage({
  onCreate,
}: {
  onCreate: (prompt?: string) => void;
}) {
  const [query, setQuery] = useState("");
  const { examples } = getCreateExamples("plugin");
  const normalizedQuery = query.trim().toLowerCase();
  const visibleExamples = examples.filter((example) =>
    [example.label, example.description]
      .join(" ")
      .toLowerCase()
      .includes(normalizedQuery),
  );

  return (
    <>
      <ResourceToolbar
        searchValue={query}
        searchPlaceholder="Search plugin templates"
        onSearchChange={setQuery}
        action={
          <CreateWithTemplatesButton
            kind="plugin"
            label="New plugin"
            onCreate={onCreate}
          />
        }
      />
      {visibleExamples.length === 0 ? (
        <EmptyStatePanel className="py-6">
          No plugin templates match "{query}".
        </EmptyStatePanel>
      ) : (
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {visibleExamples.map((example) => (
            <PluginBrowseCard
              key={example.label}
              example={example}
              onCreate={onCreate}
            />
          ))}
        </div>
      )}
    </>
  );
}

function PluginsToolView({ pluginId }: { pluginId: string | undefined }) {
  const navigate = useNavigate();
  const location = useLocation();
  const [query, setQuery] = useState("");
  const [providerFilters, setProviderFilters] = useState<ToolProviderFilter[]>(
    [],
  );
  const [sortMode, setSortMode] = useState<ToolSortMode>("alpha");
  const [sortDirection, setSortDirection] = useState<ToolSortDirection>("asc");
  const listQuery = usePluginList({ includeExperimentDisabled: true });
  const plugins = useMemo(() => listQuery.data ?? [], [listQuery.data]);
  const skillsQuery = useProjectSkills(PERSONAL_PROJECT_ID);
  const providerPlugins = useMemo(
    () => providerPluginsFromSkills(skillsQuery.data?.skills ?? []),
    [skillsQuery.data],
  );
  const normalizedQuery = query.trim().toLowerCase();
  const pluginRows = useMemo(
    () => buildPluginRows({ plugins, providerPlugins }),
    [plugins, providerPlugins],
  );
  const providerCounts = useMemo(() => {
    const counts = new Map<ToolProviderFilter, number>();
    for (const row of pluginRows) {
      if (row.kind === "provider") {
        for (const provider of row.providers) {
          counts.set(provider, (counts.get(provider) ?? 0) + 1);
        }
      } else {
        counts.set("bb", (counts.get("bb") ?? 0) + 1);
      }
    }
    return counts;
  }, [pluginRows]);
  const providerBucketCount = providerCounts.size;
  const providerOptions = useMemo(() => {
    return TOOL_PROVIDER_FILTERS.map((provider) => ({
      id: provider,
      label: toolProviderLabel(provider),
      disabled: !providerCounts.has(provider),
    }));
  }, [providerCounts]);
  useEffect(() => {
    setProviderFilters((current) =>
      current.filter((provider) => providerCounts.has(provider)),
    );
  }, [providerCounts]);
  useEffect(() => {
    if (sortMode === "provider" && providerBucketCount <= 1) {
      setSortMode("alpha");
      setSortDirection("asc");
    }
  }, [providerBucketCount, sortMode]);
  const visiblePluginRows = useMemo(() => {
    return pluginRows
      .filter((row) => {
        if (providerFilters.length > 0) {
          if (row.kind === "provider") {
            if (
              !providerFilters.some((provider) =>
                row.providers.includes(provider as SkillProvider),
              )
            ) {
              return false;
            }
          } else if (!providerFilters.includes("bb")) {
            return false;
          }
        }
        if (normalizedQuery.length === 0) return true;
        return [
          row.name,
          row.description,
          toolProviderLabel(row.provider),
          row.kind === "bb"
            ? row.plugin.version
            : row.plugin.skillNames.join(" "),
        ]
          .join(" ")
          .toLowerCase()
          .includes(normalizedQuery);
      })
      .sort((left, right) => {
        const base =
          sortMode === "provider"
            ? compareProviderFilters(left.provider, right.provider) ||
              left.name.localeCompare(right.name)
            : left.name.localeCompare(right.name);
        return applyToolSortDirection(base, sortDirection);
      });
  }, [normalizedQuery, pluginRows, providerFilters, sortDirection, sortMode]);
  const handleSortChange = useCallback(
    (nextSort: string) => {
      if (nextSort !== "provider" && nextSort !== "alpha") return;
      if (nextSort === "provider" && providerBucketCount <= 1) return;
      if (nextSort === sortMode) {
        setSortDirection((current) => (current === "asc" ? "desc" : "asc"));
        return;
      }
      setSortMode(nextSort);
      setSortDirection("asc");
    },
    [providerBucketCount, sortMode],
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
  const isLoading = listQuery.isFetching && listQuery.data === undefined;
  const selectedPlugin =
    pluginId !== undefined
      ? (plugins.find((plugin) => plugin.id === pluginId) ?? null)
      : null;
  const selectedProviderPluginName =
    pluginId !== undefined ? getProviderPluginNameFromRouteId(pluginId) : null;
  const selectedProviderPlugin =
    selectedProviderPluginName !== null
      ? (providerPlugins.find(
          (plugin) => plugin.name === selectedProviderPluginName,
        ) ?? null)
      : null;
  const isProviderPluginsLoading =
    skillsQuery.isFetching && skillsQuery.data === undefined;
  const pendingPluginId =
    pluginToggle.isPending && pluginToggle.variables
      ? pluginToggle.variables.id
      : pluginReload.isPending && pluginReload.variables
        ? pluginReload.variables.id
        : null;
  const hasPluginRows = pluginRows.length > 0;
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
  const isBrowsePage = location.pathname === getPluginBrowseRoutePath();

  const toolbar =
    pluginId === undefined && !isBrowsePage ? (
      <ResourceToolbar
        searchValue={query}
        searchPlaceholder="Search plugins"
        onSearchChange={setQuery}
        controls={
          <>
            <ResourceMultiSelectMenu
              label="Agent"
              icon="Layers"
              selectedValues={providerFilters}
              options={providerOptions}
              onChange={(values) =>
                setProviderFilters(values as ToolProviderFilter[])
              }
            />
            <ResourceSortMenu
              value={sortMode}
              direction={sortDirection}
              options={[
                {
                  id: "provider",
                  label: "Agent",
                  disabled: providerBucketCount <= 1,
                },
                { id: "alpha", label: "Alphabetical" },
              ]}
              onChange={handleSortChange}
            />
          </>
        }
        action={
          <CreateWithTemplatesButton
            kind="plugin"
            label="New plugin"
            onCreate={handleCreatePlugin}
          />
        }
      />
    ) : null;
  const overviewHeader =
    pluginId === undefined && !isBrowsePage ? (
      <>
        <ResourceTabDescription>
          Plugins add bb surfaces, commands, background services, and
          provider-specific capabilities. Browse installable templates first,
          then search and manage installed plugins.
        </ResourceTabDescription>
        <PluginBrowseShelf
          onCreate={handleCreatePlugin}
          onBrowseAll={() => navigate(getPluginBrowseRoutePath())}
        />
        {toolbar}
      </>
    ) : null;

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto w-full max-w-5xl space-y-4 px-4 pb-4 pt-3 md:px-5 md:pt-4">
        {isBrowsePage ? (
          <PluginBrowsePage onCreate={handleCreatePlugin} />
        ) : pluginId !== undefined ? (
          selectedProviderPluginName !== null ? (
            skillsQuery.isError ? (
              <ResourceListState
                state="error"
                message="Couldn't load plugin."
                onRetry={() => void skillsQuery.refetch()}
              />
            ) : isProviderPluginsLoading ? (
              <PluginsLoadingRows />
            ) : (
              <ProviderPluginDetail plugin={selectedProviderPlugin} />
            )
          ) : listQuery.isError ? (
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
              onToggle={(target) => pluginToggle.mutate(target)}
              onReload={(target) => pluginReload.mutate(target)}
            />
          )
        ) : listQuery.isError ? (
          <>
            {overviewHeader}
            <ResourceListState
              state="error"
              message="Couldn't load plugins."
              onRetry={() => void listQuery.refetch()}
            />
          </>
        ) : isLoading || (!hasPluginRows && isProviderPluginsLoading) ? (
          <>
            {overviewHeader}
            <PluginsLoadingRows />
          </>
        ) : !hasPluginRows ? (
          <>
            {overviewHeader}
            <ResourceListState state="empty" message="No plugins installed." />
          </>
        ) : visiblePluginRows.length === 0 ? (
          <>
            {overviewHeader}
            <ResourceListState
              state="empty"
              message={
                normalizedQuery === ""
                  ? "No plugins match these agents."
                  : `No plugins match "${query}"`
              }
            />
          </>
        ) : (
          <>
            {overviewHeader}
            <ResourceListPanel>
              {visiblePluginRows.map((row) =>
                row.kind === "provider" ? (
                  <ProviderInstalledPluginRow
                    key={row.id}
                    plugin={row.plugin}
                  />
                ) : (
                  <PluginListRow
                    key={row.id}
                    plugin={row.plugin}
                    pending={pendingPluginId === row.plugin.id}
                    onToggle={(target) => pluginToggle.mutate(target)}
                  />
                ),
              )}
            </ResourceListPanel>
          </>
        )}
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

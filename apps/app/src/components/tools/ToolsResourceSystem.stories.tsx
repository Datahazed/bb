import { useState, type ReactNode } from "react";
import { Button } from "@bb/shared-ui/button";
import { Icon, type IconName } from "@bb/shared-ui/icon";
import { cn } from "@bb/shared-ui/lib/utils";
import { Skeleton } from "@bb/shared-ui/skeleton";
import {
  ResourceActionButton,
  ResourceBrowseCard,
  ResourceCreateButton,
  ResourceDetailPage,
  ResourceMeta,
  ResourceOptionMenu,
  ResourceOverflowMenu,
  ResourceProperty,
  ResourcePropertyList,
  ResourceRow,
  ResourceSortMenu,
  ResourceSourceItem,
  ResourceSourceShelf,
  ResourceState,
  ResourceToolbar,
} from "@bb/shared-ui/resource-list";
import { Switch } from "@bb/shared-ui/switch";
import { ClaudeIcon } from "@/components/icons/ClaudeIcon";
import { OpenAiIcon } from "@/components/icons/OpenAiIcon";
import { StoryCard, StoryRow } from "../../../.ladle/story-card";

export default {
  title: "Tools/Resource System",
};

const NOOP = () => {};
const CREATE_TEMPLATES = [
  {
    label: "PR review",
    description:
      "reviews a GitHub PR, checks changed files, runs focused tests, and returns blocking findings first",
    prompt: "Create a new bb skill that reviews a GitHub PR.",
  },
  {
    label: "Release readiness",
    description:
      "checks the release branch hourly, summarizes blocking checks, and alerts only when the status changes",
    prompt: "Create a new bb automation to check release readiness.",
  },
  {
    label: "GitHub triage",
    description:
      "adds a GitHub panel that lists assigned PRs and lets agents open review threads",
    prompt: "Create a new bb plugin that adds GitHub triage.",
  },
] as const;

type ToolsTabId = "skills" | "plugins" | "automations";
type ProviderId = "bb" | "codex" | "claude-code";
type ProviderFilterId = ProviderId | "all";

interface ToolTab {
  id: ToolsTabId;
  label: string;
  icon: IconName;
}

interface ResourceListRowFixture {
  id: string;
  title: string;
  description: string;
  provider?: ProviderId;
  icon?: IconName;
  state?: ReactNode;
  project?: string;
  folder?: string;
  muted?: boolean;
  selected?: boolean;
}

interface ResourceSectionFixture {
  key: string;
  label: string;
  provider?: ProviderId;
  icon?: IconName;
  rows: ResourceListRowFixture[];
}

const TOOL_TABS: readonly ToolTab[] = [
  { id: "skills", label: "Skills", icon: "Zap" },
  { id: "plugins", label: "Plugins", icon: "ElectricPlugs" },
  { id: "automations", label: "Automations", icon: "TimeSchedule" },
];
const PROVIDER_FILTERS: readonly ProviderFilterId[] = [
  "all",
  "bb",
  "codex",
  "claude-code",
];
const PROVIDER_FILTER_LABELS: Record<ProviderFilterId, string> = {
  all: "All providers",
  bb: "bb",
  codex: "Codex",
  "claude-code": "Claude Code",
};

const SKILL_SECTIONS: readonly ResourceSectionFixture[] = [
  {
    key: "bb",
    label: "bb",
    provider: "bb",
    rows: [
      {
        id: "bb-cli",
        title: "bb-cli",
        description: "Inspect and orchestrate bb from the CLI.",
      },
      {
        id: "skill-creator",
        title: "skill-creator",
        description: "Create new bb skills and improve existing ones.",
      },
    ],
  },
  {
    key: "codex",
    label: "Codex",
    provider: "codex",
    rows: [
      {
        id: "imagegen",
        title: "imagegen",
        description: "Generate or edit raster images.",
      },
      {
        id: "openai-docs",
        title: "openai-docs",
        description: "Use current official OpenAI documentation.",
      },
    ],
  },
];

const REGISTRY_SOURCE_ROWS: readonly ResourceListRowFixture[] = [
  {
    id: "moss-notes",
    title: "moss-skills/moss-notes",
    description: "3,412 installs · writing · Codex, Claude Code",
    state: <ResourceState tone="success">Installed</ResourceState>,
  },
  {
    id: "review-loop",
    title: "bb/review-loop",
    description: "1,280 installs · code review · Codex",
    state: <ResourceState tone="muted">Available</ResourceState>,
  },
];

const PLUGIN_SECTIONS: readonly ResourceSectionFixture[] = [
  {
    key: "bb",
    label: "bb",
    provider: "bb",
    rows: [
      {
        id: "automations",
        title: "automations",
        description: "Schedule agent or script runs.",
      },
      {
        id: "connect",
        title: "connect",
        description: "Remote access via getbb.app.",
      },
    ],
  },
  {
    key: "codex",
    label: "Codex",
    provider: "codex",
    rows: [
      {
        id: "github",
        title: "github",
        description: "Address actionable GitHub PR review feedback.",
      },
      {
        id: "notion",
        title: "notion",
        description: "Capture and retrieve connected Notion context.",
      },
    ],
  },
  {
    key: "claude-code",
    label: "Claude Code",
    provider: "claude-code",
    rows: [
      {
        id: "linear",
        title: "linear",
        description: "Triage issues and keep project context current.",
      },
    ],
  },
];

const AUTOMATION_ROWS: readonly ResourceListRowFixture[] = [
  {
    id: "weekly-pr-review",
    title: "Weekly PR review queue",
    description: "10AM Mon · America/Los_Angeles",
    icon: "Calendar",
    state: <ResourceState tone="success">Active</ResourceState>,
    project: "bb",
    folder: "Reviews",
    selected: true,
  },
  {
    id: "stale-worktree-cleanup",
    title: "Stale worktree cleanup reminder",
    description: "4PM Fri · America/Los_Angeles",
    icon: "ComputerTerminal01",
    state: <ResourceState tone="muted">Paused</ResourceState>,
    project: "bb",
    folder: "Maintenance",
  },
  {
    id: "ci-failure-watcher",
    title: "CI failure watcher",
    description: "Every 15 min · Project workspace",
    icon: "Calendar",
    state: <ResourceState tone="warning">Needs attention</ResourceState>,
    project: "moss",
    folder: "CI",
  },
];

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

function CodexMark({ className = "size-4" }: { className?: string }) {
  return <OpenAiIcon className={cn("text-foreground", className)} />;
}

function ClaudeMark({ className = "size-4" }: { className?: string }) {
  return <ClaudeIcon className={cn("text-[#D97757]", className)} />;
}

function ProviderMark({
  provider,
  className = "size-4",
}: {
  provider: ProviderId;
  className?: string;
}) {
  if (provider === "bb") return <BbMark className={className} />;
  if (provider === "codex") return <CodexMark className={className} />;
  return <ClaudeMark className={className} />;
}

function ResourceLeading({
  row,
  fallbackIcon,
}: {
  row: ResourceListRowFixture;
  fallbackIcon: IconName;
}) {
  if (row.provider) {
    return <ProviderMark provider={row.provider} />;
  }
  return (
    <Icon
      name={row.icon ?? fallbackIcon}
      className="size-4 text-muted-foreground"
      aria-hidden
    />
  );
}

function RowOpenAction({ label }: { label: string }) {
  return (
    <ResourceActionButton label={label} icon="ChevronRight" onClick={NOOP} />
  );
}

function AutomationRowActions() {
  return (
    <>
      <ResourceActionButton label="Run now" icon="Play" onClick={NOOP} />
      <ResourceActionButton label="Edit" icon="Edit" onClick={NOOP} />
      <ResourceActionButton
        label="Delete"
        icon="Trash2"
        tone="destructive"
        onClick={NOOP}
      />
    </>
  );
}

function providerBucketsForSections(
  sections: readonly ResourceSectionFixture[],
): ReadonlySet<ProviderId> {
  const providers = new Set<ProviderId>();
  for (const section of sections) {
    for (const row of section.rows) {
      providers.add(row.provider ?? section.provider ?? "bb");
    }
  }
  return providers;
}

function StoryListControls({
  provider,
  sort,
  direction,
  availableProviders,
  onProviderChange,
  onSortChange,
}: {
  provider: ProviderFilterId;
  sort: "provider" | "alpha";
  direction: "asc" | "desc";
  availableProviders: ReadonlySet<ProviderId>;
  onProviderChange: (provider: ProviderFilterId) => void;
  onSortChange: (sort: "provider" | "alpha") => void;
}) {
  const providerSortDisabled = availableProviders.size <= 1;
  return (
    <>
      <ResourceOptionMenu
        label="Provider"
        icon="Layers"
        value={provider}
        options={PROVIDER_FILTERS.map((id) => ({
          id,
          label: PROVIDER_FILTER_LABELS[id],
          disabled: id !== "all" && !availableProviders.has(id),
        }))}
        onChange={(value) => onProviderChange(value as ProviderFilterId)}
      />
      <ResourceSortMenu
        value={sort}
        direction={direction}
        options={[
          {
            id: "provider",
            label: "Provider",
            disabled: providerSortDisabled,
          },
          { id: "alpha", label: "Alphabetical" },
        ]}
        onChange={(value) => onSortChange(value as "provider" | "alpha")}
      />
    </>
  );
}

function ToolsTabBar({
  activeTab,
  onChange,
}: {
  activeTab: ToolsTabId;
  onChange: (tab: ToolsTabId) => void;
}) {
  return (
    <nav
      aria-label="Tools"
      role="tablist"
      className="flex min-w-0 items-center gap-1"
    >
      {TOOL_TABS.map((tab) => {
        const active = tab.id === activeTab;
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={active}
            className={cn(
              "inline-flex h-8 min-w-0 items-center gap-1.5 rounded-md px-2.5 text-sm transition-colors",
              active
                ? "bg-state-active text-foreground"
                : "text-muted-foreground hover:bg-state-hover hover:text-foreground",
            )}
            onClick={() => onChange(tab.id)}
          >
            <Icon name={tab.icon} className="size-4 shrink-0" aria-hidden />
            <span className="truncate">{tab.label}</span>
          </button>
        );
      })}
    </nav>
  );
}

function PreviewStage({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "w-full rounded-md border border-border bg-background p-4",
        className,
      )}
    >
      {children}
    </div>
  );
}

function DetailSection({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <section className="space-y-2">
      <p className="text-xs font-medium uppercase text-muted-foreground">
        {label}
      </p>
      {children}
    </section>
  );
}

function ScopeControl() {
  const [scope, setScope] = useState<"user" | "project">("user");
  return (
    <div className="flex rounded-md bg-surface-recessed p-0.5">
      {(["user", "project"] as const).map((option) => (
        <button
          key={option}
          type="button"
          className={cn(
            "h-7 rounded px-2 text-xs capitalize",
            scope === option
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground",
          )}
          onClick={() => setScope(option)}
        >
          {option}
        </button>
      ))}
    </div>
  );
}

function ResourceRowsList({
  sections,
  query,
  providerFilter,
  sortMode,
  sortDirection,
  fallbackIcon,
}: {
  sections: readonly ResourceSectionFixture[];
  query: string;
  providerFilter: ProviderFilterId;
  sortMode: "provider" | "alpha";
  sortDirection: "asc" | "desc";
  fallbackIcon: IconName;
}) {
  const normalizedQuery = query.trim().toLowerCase();
  const rows = sections
    .flatMap((section) =>
      section.rows.map((row) => ({
        ...row,
        provider: row.provider ?? section.provider,
      })),
    )
    .filter((row) => {
      if (providerFilter !== "all" && row.provider !== providerFilter) {
        return false;
      }
      return [row.provider, row.title, row.description]
        .join(" ")
        .toLowerCase()
        .includes(normalizedQuery);
    })
    .sort((left, right) => {
      const base =
        sortMode === "provider"
          ? (left.provider ?? "bb").localeCompare(right.provider ?? "bb") ||
            left.title.localeCompare(right.title)
          : left.title.localeCompare(right.title);
      return sortDirection === "asc" ? base : -base;
    });

  if (rows.length === 0) {
    return (
      <p className="rounded-md border border-border bg-popover px-3 py-4 text-sm text-muted-foreground">
        No resources match this search.
      </p>
    );
  }

  return (
    <div className="space-y-0.5">
      {rows.map((row) => (
        <ResourceRow
          key={row.id}
          leading={<ResourceLeading row={row} fallbackIcon={fallbackIcon} />}
          title={row.title}
          description={row.description}
          state={row.state}
          muted={row.muted}
          onOpen={NOOP}
          actions={<RowOpenAction label={`Open ${row.title}`} />}
        />
      ))}
    </div>
  );
}

function RegistryBrowseSource({ query }: { query: string }) {
  const normalizedQuery = query.trim().toLowerCase();
  const rows = REGISTRY_SOURCE_ROWS.filter((row) =>
    [row.title, row.description]
      .join(" ")
      .toLowerCase()
      .includes(normalizedQuery),
  );
  if (rows.length === 0) {
    if (normalizedQuery === "") return null;
    return (
      <p className="rounded-md border border-border bg-popover px-3 py-4 text-sm text-muted-foreground">
        No skills.sh resources match this search.
      </p>
    );
  }
  return (
    <ResourceSourceShelf
      label="Browse skills.sh"
      count={rows.length}
      leading={<Icon name="Zap" className="size-3.5 shrink-0" aria-hidden />}
      action={
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-6 gap-1 px-2"
        >
          Browse all
          <Icon name="ChevronRight" className="size-3.5" aria-hidden />
        </Button>
      }
    >
      {rows.map((row) => (
        <ResourceSourceItem key={row.id}>
          <ResourceBrowseCard
            leading={
              <Icon
                name="Zap"
                className="size-5 text-muted-foreground"
                aria-hidden
              />
            }
            title={row.title}
            meta="skills.sh"
            description="Reusable skill package with provider compatibility, usage signal, and topic metadata."
            tags={row.description.split(" · ")}
            state={row.state}
            onOpen={NOOP}
            action={
              <>
                <Button type="button" variant="outline" size="sm">
                  {row.id === "moss-notes" ? "Add provider" : "Install"}
                </Button>
                <ResourceOverflowMenu
                  label={`${row.title} install options`}
                  items={[
                    { label: "Install for user", onSelect: NOOP },
                    { label: "Install for project", onSelect: NOOP },
                  ]}
                />
              </>
            }
          />
        </ResourceSourceItem>
      ))}
    </ResourceSourceShelf>
  );
}

function RegistryBrowseSourceLoading() {
  return (
    <ResourceSourceShelf
      label="Browse skills.sh"
      leading={<Icon name="Zap" className="size-3.5 shrink-0" aria-hidden />}
    >
      {["w-40", "w-52", "w-36"].map((nameWidth) => (
        <ResourceSourceItem key={nameWidth}>
          <div className="flex min-w-0 items-center gap-3 px-3 py-2">
            <Skeleton className="size-4 rounded" />
            <div className="min-w-0 flex-1 space-y-1.5">
              <Skeleton className={cn("h-3.5", nameWidth)} />
              <Skeleton className="h-3 w-56 max-w-full" />
            </div>
            <Skeleton className="h-7 w-20" />
          </div>
        </ResourceSourceItem>
      ))}
    </ResourceSourceShelf>
  );
}

function TemplateBrowseCards({
  label,
  icon,
}: {
  label: string;
  icon: IconName;
}) {
  return (
    <ResourceSourceShelf
      label={label}
      count={CREATE_TEMPLATES.length}
      leading={<Icon name={icon} className="size-3.5 shrink-0" aria-hidden />}
      action={
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-6 gap-1 px-2"
        >
          Browse all
          <Icon name="ChevronRight" className="size-3.5" aria-hidden />
        </Button>
      }
    >
      {CREATE_TEMPLATES.map((template) => (
        <ResourceSourceItem key={`${label}-${template.label}`}>
          <ResourceBrowseCard
            leading={
              <Icon
                name={icon}
                className="size-5 text-muted-foreground"
                aria-hidden
              />
            }
            title={template.label}
            meta="Starter template"
            description={template.description}
            tags={["template", "installable", label.replace("Browse ", "")]}
            action={
              <Button type="button" variant="outline" size="sm">
                Use template
              </Button>
            }
            onOpen={NOOP}
          />
        </ResourceSourceItem>
      ))}
    </ResourceSourceShelf>
  );
}

function PluginBrowseCards() {
  return <TemplateBrowseCards label="Browse plugins" icon="ElectricPlugs" />;
}

function AutomationBrowseCards() {
  return <TemplateBrowseCards label="Browse automations" icon="TimeSchedule" />;
}

function AutomationsList({
  query,
  location,
  sort,
  direction,
}: {
  query: string;
  location: string;
  sort: "location" | "alpha";
  direction: "asc" | "desc";
}) {
  const normalizedQuery = query.trim().toLowerCase();
  const rows = AUTOMATION_ROWS.filter((row) =>
    [row.project, row.folder, row.title, row.description]
      .join(" ")
      .toLowerCase()
      .includes(normalizedQuery),
  )
    .filter((row) => {
      if (location === "all") return true;
      return (
        `${row.project?.toLowerCase()}/${row.folder?.toLowerCase()}` ===
        location
      );
    })
    .sort((left, right) => {
      const leftLocation = `${left.project ?? ""} / ${left.folder ?? ""}`;
      const rightLocation = `${right.project ?? ""} / ${right.folder ?? ""}`;
      const base =
        sort === "location"
          ? leftLocation.localeCompare(rightLocation) ||
            left.title.localeCompare(right.title)
          : left.title.localeCompare(right.title);
      return direction === "asc" ? base : -base;
    });

  if (rows.length === 0) {
    return (
      <p className="rounded-md border border-border bg-popover px-3 py-4 text-sm text-muted-foreground">
        No automations match this search.
      </p>
    );
  }
  return (
    <div className="space-y-0.5">
      {rows.map((row) => (
        <ResourceRow
          key={row.id}
          leading={<ResourceLeading row={row} fallbackIcon="TimeSchedule" />}
          title={row.title}
          description={`${row.description} · ${row.project}${row.folder ? ` / ${row.folder}` : ""}`}
          state={row.state}
          selected={row.selected}
          onOpen={NOOP}
          actions={<AutomationRowActions />}
        />
      ))}
    </div>
  );
}

function SkillsTab() {
  const [query, setQuery] = useState("");
  const [provider, setProvider] = useState<ProviderFilterId>("all");
  const [sort, setSort] = useState<"provider" | "alpha">("alpha");
  const [direction, setDirection] = useState<"asc" | "desc">("asc");
  const providerBuckets = providerBucketsForSections(SKILL_SECTIONS);
  function updateSort(nextSort: "provider" | "alpha") {
    if (nextSort === "provider" && providerBuckets.size <= 1) return;
    if (nextSort === sort) {
      setDirection((current) => (current === "asc" ? "desc" : "asc"));
    } else {
      setSort(nextSort);
      setDirection("asc");
    }
  }
  return (
    <div className="space-y-3">
      <ResourceToolbar
        searchValue={query}
        searchPlaceholder="Search skills"
        onSearchChange={setQuery}
        controls={
          <StoryListControls
            provider={provider}
            sort={sort}
            direction={direction}
            availableProviders={providerBuckets}
            onProviderChange={setProvider}
            onSortChange={updateSort}
          />
        }
        action={
          <ResourceCreateButton
            label="New bb skill"
            templates={CREATE_TEMPLATES}
            onCreate={NOOP}
          />
        }
      />
      <RegistryBrowseSource query={query} />
      <ResourceRowsList
        sections={SKILL_SECTIONS}
        query={query}
        providerFilter={provider}
        sortMode={sort}
        sortDirection={direction}
        fallbackIcon="Zap"
      />
    </div>
  );
}

function PluginsTab() {
  const [query, setQuery] = useState("");
  const [provider, setProvider] = useState<ProviderFilterId>("all");
  const [sort, setSort] = useState<"provider" | "alpha">("alpha");
  const [direction, setDirection] = useState<"asc" | "desc">("asc");
  const providerBuckets = providerBucketsForSections(PLUGIN_SECTIONS);
  function updateSort(nextSort: "provider" | "alpha") {
    if (nextSort === "provider" && providerBuckets.size <= 1) return;
    if (nextSort === sort) {
      setDirection((current) => (current === "asc" ? "desc" : "asc"));
    } else {
      setSort(nextSort);
      setDirection("asc");
    }
  }
  return (
    <div className="space-y-3">
      <ResourceToolbar
        searchValue={query}
        searchPlaceholder="Search plugins"
        onSearchChange={setQuery}
        controls={
          <StoryListControls
            provider={provider}
            sort={sort}
            direction={direction}
            availableProviders={providerBuckets}
            onProviderChange={setProvider}
            onSortChange={updateSort}
          />
        }
        action={
          <ResourceCreateButton
            label="New plugin"
            templates={CREATE_TEMPLATES}
            onCreate={NOOP}
          />
        }
      />
      <PluginBrowseCards />
      <ResourceRowsList
        sections={PLUGIN_SECTIONS}
        query={query}
        providerFilter={provider}
        sortMode={sort}
        sortDirection={direction}
        fallbackIcon="ElectricPlugs"
      />
    </div>
  );
}

function AutomationsTab() {
  const [query, setQuery] = useState("");
  const [location, setLocation] = useState("all");
  const [sort, setSort] = useState<"location" | "alpha">("alpha");
  const [direction, setDirection] = useState<"asc" | "desc">("asc");
  const locationBucketCount = new Set(
    AUTOMATION_ROWS.map((row) => `${row.project ?? ""}/${row.folder ?? ""}`),
  ).size;
  function updateSort(nextSort: "location" | "alpha") {
    if (nextSort === "location" && locationBucketCount <= 1) return;
    if (nextSort === sort) {
      setDirection((current) => (current === "asc" ? "desc" : "asc"));
    } else {
      setSort(nextSort);
      setDirection("asc");
    }
  }
  return (
    <div className="space-y-3">
      <ResourceToolbar
        searchValue={query}
        searchPlaceholder="Search automations"
        onSearchChange={setQuery}
        controls={
          <>
            <ResourceOptionMenu
              label="Location"
              icon="Folder"
              value={location}
              options={[
                { id: "all", label: "All locations" },
                { id: "bb/reviews", label: "bb / Reviews" },
                { id: "bb/maintenance", label: "bb / Maintenance" },
                { id: "moss/ci", label: "moss / CI" },
              ]}
              onChange={setLocation}
            />
            <ResourceSortMenu
              value={sort}
              direction={direction}
              options={[
                {
                  id: "location",
                  label: "Project / folder",
                  disabled: locationBucketCount <= 1,
                },
                { id: "alpha", label: "Alphabetical" },
              ]}
              onChange={(value) => updateSort(value as "location" | "alpha")}
            />
          </>
        }
        action={
          <ResourceCreateButton
            label="New automation"
            templates={CREATE_TEMPLATES}
            onCreate={NOOP}
          />
        }
      />
      <AutomationBrowseCards />
      <AutomationsList
        query={query}
        location={location}
        sort={sort}
        direction={direction}
      />
    </div>
  );
}

function ActiveTabPanel({ activeTab }: { activeTab: ToolsTabId }) {
  if (activeTab === "plugins") return <PluginsTab />;
  if (activeTab === "automations") return <AutomationsTab />;
  return <SkillsTab />;
}

function AutomationDetail() {
  return (
    <ResourceDetailPage
      leading={
        <Icon
          name="ComputerTerminal01"
          className="size-4 text-muted-foreground"
          aria-hidden
        />
      }
      title="Stale worktree cleanup reminder"
      status={<ResourceState tone="muted">Paused</ResourceState>}
      headerActions={
        <>
          <Switch
            checked={false}
            aria-label="Resume automation"
            onCheckedChange={NOOP}
          />
          <ResourceOverflowMenu
            label="Automation actions"
            items={[
              {
                label: "Run now",
                icon: "ArrowReloadHorizontal",
                onSelect: NOOP,
              },
              { kind: "separator" },
              {
                label: "Delete",
                icon: "Trash2",
                tone: "destructive",
                onSelect: NOOP,
              },
            ]}
          />
        </>
      }
      meta={
        <ResourceMeta
          items={["Automation", "Script", "Next run Friday, 4:00 PM"]}
        />
      }
    >
      <DetailSection label="Configuration">
        <ResourcePropertyList>
          <ResourceProperty label="Schedule">
            4PM Fri · America/Los_Angeles
          </ResourceProperty>
          <ResourceProperty label="Execution">
            Script · bash script.sh · 120s timeout
          </ResourceProperty>
          <ResourceProperty label="Origin">App-created</ResourceProperty>
          <ResourceProperty label="Environment">
            Local workspace
          </ResourceProperty>
          <ResourceProperty label="Script file">script.sh</ResourceProperty>
        </ResourcePropertyList>
      </DetailSection>
      <DetailSection label="Run history">
        <ResourcePropertyList>
          <ResourceProperty label="Skipped">
            Jul 7, 6:02 PM · 0.7s
          </ResourceProperty>
          <ResourceProperty label="Failed">
            Jul 5, 2:00 PM · 1.0s
          </ResourceProperty>
        </ResourcePropertyList>
      </DetailSection>
    </ResourceDetailPage>
  );
}

function SkillDetail() {
  return (
    <ResourceDetailPage
      leading={<Icon name="Zap" className="size-4 text-muted-foreground" />}
      title="bb-cli"
      status={<ResourceState tone="success">bb built-in</ResourceState>}
      headerActions={
        <ResourceOverflowMenu
          label="Skill actions"
          items={[
            { label: "Edit", icon: "Edit", onSelect: NOOP },
            { label: "Open in editor", icon: "ExternalLink", onSelect: NOOP },
            { kind: "separator" },
            {
              label: "Delete",
              icon: "Trash2",
              tone: "destructive",
              onSelect: NOOP,
            },
          ]}
        />
      }
      meta={<ResourceMeta items={["Skill", "bb", "built-in"]} />}
      description="Inspect and orchestrate bb from the CLI."
    >
      <DetailSection label="Details">
        <ResourcePropertyList>
          <ResourceProperty label="Kind">Skill</ResourceProperty>
          <ResourceProperty label="Provider">bb</ResourceProperty>
          <ResourceProperty label="Scope">built-in</ResourceProperty>
          <ResourceProperty label="File">SKILL.md</ResourceProperty>
        </ResourcePropertyList>
      </DetailSection>
      <DetailSection label="SKILL.md">
        <ResourcePropertyList>
          <ResourceProperty label="Description">
            Use this when controlling bb. The bb CLI lets you inspect, create,
            and orchestrate bb threads, automations, projects, providers, and
            environments.
          </ResourceProperty>
          <ResourceProperty label="Path">
            ~/.bb/runtime/global-skills/bb-cli/SKILL.md
          </ResourceProperty>
        </ResourcePropertyList>
      </DetailSection>
    </ResourceDetailPage>
  );
}

function RegistrySkillDetail() {
  return (
    <ResourceDetailPage
      leading={<Icon name="Zap" className="size-4 text-muted-foreground" />}
      title="moss-skills/moss-notes"
      status={<ResourceState tone="success">Installed</ResourceState>}
      meta={<ResourceMeta items={["skills.sh", "moss-skills", "writing"]} />}
      description="Author and edit Moss notes with the current Moss syntax."
      actions={
        <>
          <ScopeControl />
          <Button type="button" size="sm" onClick={NOOP}>
            Add provider
          </Button>
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="size-8"
            aria-label="Provider picker"
            onClick={NOOP}
          >
            <Icon name="ChevronDown" className="size-4" />
          </Button>
        </>
      }
    >
      <DetailSection label="Details">
        <ResourcePropertyList>
          <ResourceProperty label="Installs">3,412</ResourceProperty>
          <ResourceProperty label="Works with">
            Codex, Claude Code
          </ResourceProperty>
          <ResourceProperty label="Installed on">Codex</ResourceProperty>
        </ResourcePropertyList>
      </DetailSection>
    </ResourceDetailPage>
  );
}

function PluginDetail() {
  const [enabled, setEnabled] = useState(true);
  return (
    <ResourceDetailPage
      leading={<BbMark />}
      title="automations"
      status={
        <ResourceState tone={enabled ? "success" : "muted"}>
          {enabled ? "Running" : "Disabled"}
        </ResourceState>
      }
      meta={
        <ResourceMeta
          items={["bb plugin", "v0.1.0", enabled ? "Running" : "Disabled"]}
        />
      }
      description="Schedule agent or script runs."
      actions={
        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          <Switch
            checked={enabled}
            aria-label={enabled ? "Disable automations" : "Enable automations"}
            onCheckedChange={setEnabled}
          />
          {enabled ? "Enabled" : "Disabled"}
        </label>
      }
    >
      <DetailSection label="Details">
        <ResourcePropertyList>
          <ResourceProperty label="Kind">bb plugin</ResourceProperty>
          <ResourceProperty label="Status">
            {enabled ? "Running" : "Disabled"}
          </ResourceProperty>
          <ResourceProperty label="Version">0.1.0</ResourceProperty>
        </ResourcePropertyList>
      </DetailSection>
    </ResourceDetailPage>
  );
}

function ProviderPluginDetail() {
  return (
    <ResourceDetailPage
      leading={
        <Icon
          name="ElectricPlugs"
          className="size-4 shrink-0 text-muted-foreground"
          aria-hidden
        />
      }
      title="github"
      status={
        <span className="flex shrink-0 items-center gap-2">
          <CodexMark className="size-4" />
          <ResourceState tone="success">Installed</ResourceState>
        </span>
      }
      meta={<ResourceMeta items={["Provider plugin", "Codex", "2 skills"]} />}
      description="Address actionable GitHub PR review feedback."
    >
      <DetailSection label="Skills">
        <div className="space-y-1">
          {["github:gh-address-comments", "github:gh-fix-ci"].map((skill) => (
            <div
              key={skill}
              className="flex items-center gap-2 rounded-md px-3 py-2 text-sm"
            >
              <Icon
                name="Zap"
                className="size-4 shrink-0 text-muted-foreground"
                aria-hidden
              />
              <span className="min-w-0 flex-1 truncate">{skill}</span>
            </div>
          ))}
        </div>
      </DetailSection>
    </ResourceDetailPage>
  );
}

function OverviewToolbarSample() {
  const [query, setQuery] = useState("");
  return (
    <ResourceToolbar
      searchValue={query}
      searchPlaceholder="Search resources"
      onSearchChange={setQuery}
      action={
        <ResourceCreateButton
          label="New resource"
          templates={CREATE_TEMPLATES}
          onCreate={NOOP}
        />
      }
    />
  );
}

function OverviewTabsSample() {
  const [activeTab, setActiveTab] = useState<ToolsTabId>("skills");
  return <ToolsTabBar activeTab={activeTab} onChange={setActiveTab} />;
}

function StatusAndActionSamples() {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <ResourceState tone="success">Active</ResourceState>
      <ResourceState tone="warning">Needs attention</ResourceState>
      <ResourceState tone="muted">Paused</ResourceState>
      <span className="flex items-center gap-0.5">
        <AutomationRowActions />
      </span>
    </div>
  );
}

function DetailHeaderSamples() {
  const [enabled, setEnabled] = useState(true);
  return (
    <div className="flex flex-wrap items-center gap-4">
      <span className="flex items-center gap-2">
        <Icon name="Zap" className="size-4 text-muted-foreground" />
        <span className="text-sm font-medium">Resource title</span>
        <ResourceState tone="success">Active</ResourceState>
      </span>
      <span className="flex items-center gap-1">
        <Switch
          checked={enabled}
          aria-label="Enable resource"
          onCheckedChange={setEnabled}
        />
        <ResourceOverflowMenu
          label="More actions"
          items={[
            { label: "Edit", icon: "Edit", onSelect: NOOP },
            { kind: "separator" },
            {
              label: "Delete",
              icon: "Trash2",
              tone: "destructive",
              onSelect: NOOP,
            },
          ]}
        />
      </span>
    </div>
  );
}

function DetailPropertiesSample() {
  return (
    <ResourcePropertyList>
      <ResourceProperty label="Schedule">
        Every hour · America/New_York
      </ResourceProperty>
      <ResourceProperty label="Execution">gpt-5.4 · Low</ResourceProperty>
      <ResourceProperty label="Environment">Local workspace</ResourceProperty>
    </ResourcePropertyList>
  );
}

export function ToolsOverviewPage() {
  const [activeTab, setActiveTab] = useState<ToolsTabId>("skills");

  return (
    <main className="min-h-[720px] bg-background">
      <div className="mx-auto w-full max-w-5xl px-4 py-4 md:px-5">
        <div className="mb-4 flex items-center gap-3">
          <ToolsTabBar activeTab={activeTab} onChange={setActiveTab} />
        </div>
        <ActiveTabPanel activeTab={activeTab} />
      </div>
    </main>
  );
}

function SkillsSourceAboveInstalledPreview() {
  const [query, setQuery] = useState("");
  return (
    <div className="space-y-3">
      <ResourceToolbar
        searchValue={query}
        searchPlaceholder="Search skills"
        onSearchChange={setQuery}
        action={
          <ResourceCreateButton
            label="New bb skill"
            templates={CREATE_TEMPLATES}
            onCreate={NOOP}
          />
        }
      />
      <RegistryBrowseSource query={query} />
      <ResourceRowsList
        sections={SKILL_SECTIONS}
        query={query}
        providerFilter="all"
        sortMode="alpha"
        sortDirection="asc"
        fallbackIcon="Zap"
      />
    </div>
  );
}

export function SkillsShSourceSystem() {
  return (
    <StoryCard labelWidth="260px">
      <StoryRow
        label="source carousel"
        hint="browse source for installable skills; not a provider section"
      >
        <PreviewStage className="max-w-[760px]">
          <RegistryBrowseSource query="" />
        </PreviewStage>
      </StoryRow>
      <StoryRow
        label="source loading"
        hint="source loading is independent from installed provider groups"
      >
        <PreviewStage className="max-w-[760px]">
          <RegistryBrowseSourceLoading />
        </PreviewStage>
      </StoryRow>
      <StoryRow
        label="source search miss"
        hint="no source results for the active query"
      >
        <PreviewStage className="max-w-[760px]">
          <RegistryBrowseSource query="database" />
        </PreviewStage>
      </StoryRow>
      <StoryRow
        label="source above installed"
        hint="toolbar, skills.sh source carousel, then flat installed skill rows"
      >
        <PreviewStage className="max-w-[760px]">
          <SkillsSourceAboveInstalledPreview />
        </PreviewStage>
      </StoryRow>
    </StoryCard>
  );
}

export function DetailPageSystem() {
  return (
    <StoryCard labelWidth="260px">
      <StoryRow
        label="automation detail page"
        hint="full-page resource shell with status, compact header actions, configuration, and run history"
      >
        <PreviewStage className="max-w-[760px]">
          <AutomationDetail />
        </PreviewStage>
      </StoryRow>
      <StoryRow
        label="skill detail page"
        hint="shared detail shell for installed skills, SKILL.md metadata, and edit/open/delete actions"
      >
        <PreviewStage className="max-w-[760px]">
          <SkillDetail />
        </PreviewStage>
      </StoryRow>
      <StoryRow
        label="skills.sh source detail"
        hint="source results use the shared detail taxonomy, with install scope and provider actions as resource state"
      >
        <PreviewStage className="max-w-[760px]">
          <RegistrySkillDetail />
        </PreviewStage>
      </StoryRow>
      <StoryRow
        label="bb plugin detail page"
        hint="plugin resource detail keeps status and enablement in the header/action area"
      >
        <PreviewStage className="max-w-[760px]">
          <PluginDetail />
        </PreviewStage>
      </StoryRow>
      <StoryRow
        label="provider plugin detail page"
        hint="provider-specific plugins share the same detail shell and expose their bundled skills"
      >
        <PreviewStage className="max-w-[760px]">
          <ProviderPluginDetail />
        </PreviewStage>
      </StoryRow>
      <StoryRow
        label="detail header primitives"
        hint="leading icon, title, status, enable switch, and compact overflow action"
      >
        <PreviewStage>
          <DetailHeaderSamples />
        </PreviewStage>
      </StoryRow>
      <StoryRow
        label="property list"
        hint="shared key/value surface used by automation, skill, and plugin details"
      >
        <PreviewStage className="max-w-[560px]">
          <DetailPropertiesSample />
        </PreviewStage>
      </StoryRow>
    </StoryCard>
  );
}

export function OverviewPageSystem() {
  return (
    <StoryCard labelWidth="260px">
      <StoryRow
        label="tools tabs"
        hint="filter-style tabs for switching between skills, plugins, and automations"
      >
        <PreviewStage>
          <OverviewTabsSample />
        </PreviewStage>
      </StoryRow>
      <StoryRow
        label="overview toolbar"
        hint="shared search field and aligned primary New action"
      >
        <PreviewStage className="max-w-[760px]">
          <OverviewToolbarSample />
        </PreviewStage>
      </StoryRow>
      <StoryRow
        label="automation rows"
        hint="status appears once beside the title; hover/focus reveals the shared overflow action"
      >
        <PreviewStage className="max-w-[760px]">
          <AutomationsList
            query=""
            location="all"
            sort="alpha"
            direction="asc"
          />
        </PreviewStage>
      </StoryRow>
      <StoryRow
        label="skills.sh source carousel"
        hint="discovery source for installable skills, separate from installed provider sections"
      >
        <PreviewStage className="max-w-[760px]">
          <RegistryBrowseSource query="" />
        </PreviewStage>
      </StoryRow>
      <StoryRow
        label="skills rows"
        hint="flat installed skill rows controlled by provider filter and sort"
      >
        <PreviewStage className="max-w-[760px]">
          <ResourceRowsList
            sections={SKILL_SECTIONS}
            query=""
            providerFilter="all"
            sortMode="alpha"
            sortDirection="asc"
            fallbackIcon="Zap"
          />
        </PreviewStage>
      </StoryRow>
      <StoryRow
        label="plugins rows"
        hint="bb and provider-specific plugins use the same flat row grammar as skills"
      >
        <PreviewStage className="max-w-[760px]">
          <ResourceRowsList
            sections={PLUGIN_SECTIONS}
            query=""
            providerFilter="all"
            sortMode="alpha"
            sortDirection="asc"
            fallbackIcon="ElectricPlugs"
          />
        </PreviewStage>
      </StoryRow>
      <StoryRow
        label="states and row actions"
        hint="shared status dot labels and compact icon actions with tooltips"
      >
        <PreviewStage>
          <StatusAndActionSamples />
        </PreviewStage>
      </StoryRow>
    </StoryCard>
  );
}

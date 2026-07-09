import { useState, type ReactNode } from "react";
import { Button } from "@bb/shared-ui/button";
import { Icon, type IconName } from "@bb/shared-ui/icon";
import { cn } from "@bb/shared-ui/lib/utils";
import {
  ResourceActionButton,
  ResourceBrowseCard,
  ResourceCardStat,
  ResourceCreateButton,
  ResourceDetailPage,
  ResourceListPanel,
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
  ResourceTabDescription,
  ResourceToolbar,
} from "@bb/shared-ui/resource-list";
import { Switch } from "@bb/shared-ui/switch";
import { ClaudeIcon } from "@/components/icons/ClaudeIcon";
import { OpenAiIcon } from "@/components/icons/OpenAiIcon";

export default {
  title: "Tools/Resource System",
};

const NOOP = () => {};
const SKILL_CREATE_TEMPLATES = [
  {
    label: "PR review",
    description:
      "reviews a GitHub PR, checks changed files, runs focused tests, and returns blocking findings first",
    prompt: "Create a new bb skill that reviews a GitHub PR.",
  },
  {
    label: "Usage pattern skill",
    description:
      "turns repeated thread behavior into a reusable agent instruction",
    prompt: "Create a new bb skill for a repeated workflow.",
  },
] as const;

const PLUGIN_CREATE_TEMPLATES = [
  {
    label: "GitHub triage",
    description:
      "adds a GitHub panel that lists assigned PRs and lets agents open review threads",
    prompt: "Create a new bb plugin that adds GitHub triage.",
  },
  {
    label: "Status panel",
    description:
      "adds a compact nav panel for surfacing workspace health and shortcuts",
    prompt: "Create a new bb plugin that adds a workspace status panel.",
  },
] as const;

const AUTOMATION_CREATE_TEMPLATES = [
  {
    label: "Release readiness",
    description:
      "checks the release branch hourly, summarizes blocking checks, and alerts only when the status changes",
    prompt: "Create a new bb automation to check release readiness.",
  },
  {
    label: "Standup digest",
    description: "summarizes yesterday's thread activity every weekday morning",
    prompt: "Create a new bb automation that sends a weekday standup digest.",
  },
] as const;

type ProviderId = "bb" | "codex" | "claude-code";
type ProviderFilterId = ProviderId | "all";

interface ResourceListRowFixture {
  id: string;
  title: string;
  description: string;
  environment?: StoryEnvironmentDisplay;
  provider?: ProviderId;
  icon?: IconName;
  state?: ReactNode;
  project?: string;
  folder?: string;
  muted?: boolean;
  selected?: boolean;
}

interface RegistrySourceFixture {
  id: string;
  title: string;
  source: string;
  summary: string;
  installs: string;
  stars: string;
}

interface ResourceSectionFixture {
  key: string;
  label: string;
  provider?: ProviderId;
  icon?: IconName;
  rows: ResourceListRowFixture[];
}

interface StoryEnvironmentDisplay {
  label: string;
  title: string;
  icon: IconName;
}

const LOCAL_ENVIRONMENT_DISPLAY: StoryEnvironmentDisplay = {
  label: "Local",
  title: "Working locally",
  icon: "Laptop",
};

const PROVIDER_FILTERS: readonly ProviderFilterId[] = [
  "all",
  "bb",
  "codex",
  "claude-code",
];

const PROVIDER_FILTER_LABELS: Record<ProviderFilterId, string> = {
  all: "All agents",
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

const REGISTRY_SOURCE_ROWS: readonly RegistrySourceFixture[] = [
  {
    id: "moss-notes",
    title: "moss-skills/moss-notes",
    source: "moss-skills",
    summary: "Author and edit Moss notes with the current Moss syntax.",
    installs: "3.4K installs",
    stars: "25.6K stars",
  },
  {
    id: "review-loop",
    title: "bb/review-loop",
    source: "bb",
    summary: "Run a staged review loop and apply prioritized fixes.",
    installs: "1.3K installs",
    stars: "4.8K stars",
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
    environment: LOCAL_ENVIRONMENT_DISPLAY,
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
    environment: LOCAL_ENVIRONMENT_DISPLAY,
    icon: "ComputerTerminal01",
    state: <ResourceState tone="muted">Paused</ResourceState>,
    project: "bb",
    folder: "Maintenance",
  },
  {
    id: "ci-failure-watcher",
    title: "CI failure watcher",
    description: "Every 15 min",
    environment: LOCAL_ENVIRONMENT_DISPLAY,
    icon: "Calendar",
    state: <ResourceState tone="warning">Failed</ResourceState>,
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

function StoryEnvironmentInline({
  display,
}: {
  display: StoryEnvironmentDisplay;
}) {
  return (
    <span
      className="inline-flex min-w-0 items-center gap-1"
      title={display.title}
    >
      <Icon name={display.icon} className="size-3.5 shrink-0" aria-hidden />
      <span className="truncate">{display.label}</span>
    </span>
  );
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
        label="Agent"
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
            label: "Agent",
            disabled: providerSortDisabled,
          },
          { id: "alpha", label: "Alphabetical" },
        ]}
        onChange={(value) => onSortChange(value as "provider" | "alpha")}
      />
    </>
  );
}

function PageStory({ children }: { children: ReactNode }) {
  return (
    <main className="min-h-[720px] bg-background px-4 py-4 md:px-5">
      <div className="mx-auto w-full max-w-5xl">{children}</div>
    </main>
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
    <ResourceListPanel>
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
    </ResourceListPanel>
  );
}

function StorySocialProof({
  installs,
  stars,
}: {
  installs: string;
  stars: string;
}) {
  return (
    <span className="inline-flex flex-wrap items-center gap-1 text-[11px] leading-none">
      <ResourceCardStat icon="Download">{installs}</ResourceCardStat>
      <ResourceCardStat icon="Star">{stars}</ResourceCardStat>
    </span>
  );
}

function RegistryBrowseSource() {
  return (
    <ResourceSourceShelf
      label="Browse"
      leading={<Icon name="Zap" className="size-3.5 shrink-0" aria-hidden />}
      action={
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-6 gap-1 px-2"
        >
          See all
          <Icon name="ChevronRight" className="size-3.5" aria-hidden />
        </Button>
      }
    >
      {REGISTRY_SOURCE_ROWS.map((row) => (
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
            meta={row.source}
            description={row.summary}
            state={
              <StorySocialProof installs={row.installs} stars={row.stars} />
            }
            onOpen={NOOP}
            action={
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-7 gap-1 px-2 text-xs"
              >
                Install
                <Icon name="ChevronDown" className="size-3.5" aria-hidden />
              </Button>
            }
          />
        </ResourceSourceItem>
      ))}
    </ResourceSourceShelf>
  );
}

function TemplateBrowseCards({
  label,
  icon,
  templates,
}: {
  label: string;
  icon: IconName;
  templates: readonly {
    label: string;
    description: string;
    prompt: string;
  }[];
}) {
  return (
    <ResourceSourceShelf
      label={label}
      leading={<Icon name={icon} className="size-3.5 shrink-0" aria-hidden />}
      action={
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-6 gap-1 px-2"
        >
          See all
          <Icon name="ChevronRight" className="size-3.5" aria-hidden />
        </Button>
      }
    >
      {templates.map((template) => (
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
            action={
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-7 px-2 text-xs"
              >
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
  return (
    <TemplateBrowseCards
      label="Browse plugins"
      icon="ElectricPlugs"
      templates={PLUGIN_CREATE_TEMPLATES}
    />
  );
}

function AutomationBrowseCards() {
  return (
    <TemplateBrowseCards
      label="Browse automations"
      icon="TimeSchedule"
      templates={AUTOMATION_CREATE_TEMPLATES}
    />
  );
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
    [
      row.project,
      row.folder,
      row.title,
      row.description,
      row.environment?.label,
    ]
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
    <ResourceListPanel>
      {rows.map((row) => (
        <ResourceRow
          key={row.id}
          leading={<ResourceLeading row={row} fallbackIcon="TimeSchedule" />}
          title={row.title}
          description={
            <span className="inline-flex min-w-0 items-center gap-1.5">
              <span className="truncate">{row.description}</span>
              {row.environment ? (
                <>
                  <span aria-hidden>·</span>
                  <StoryEnvironmentInline display={row.environment} />
                </>
              ) : null}
              <span aria-hidden>·</span>
              <span className="truncate">
                {row.project}
                {row.folder ? ` / ${row.folder}` : ""}
              </span>
            </span>
          }
          state={row.state}
          selected={row.selected}
          onOpen={NOOP}
          actions={<AutomationRowActions />}
        />
      ))}
    </ResourceListPanel>
  );
}

function SkillsOverviewSurface() {
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
    <div className="space-y-4">
      <ResourceTabDescription>
        Skills are reusable instructions available to agents in bb. Browse
        installable skills first, then search and manage the skills already
        available in this workspace.
      </ResourceTabDescription>
      <RegistryBrowseSource />
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
            templates={SKILL_CREATE_TEMPLATES}
            onCreate={NOOP}
          />
        }
      />
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

function PluginsOverviewSurface() {
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
    <div className="space-y-4">
      <ResourceTabDescription>
        Plugins add bb surfaces, commands, background services, and
        provider-specific capabilities. Browse installable templates first, then
        search and manage installed plugins.
      </ResourceTabDescription>
      <PluginBrowseCards />
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
            templates={PLUGIN_CREATE_TEMPLATES}
            onCreate={NOOP}
          />
        }
      />
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

function AutomationsOverviewSurface() {
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
    <div className="space-y-4">
      <ResourceTabDescription>
        Automations run scheduled bb work across projects and folders. Browse
        starter automations first, then search and manage the automations
        already installed in this workspace.
      </ResourceTabDescription>
      <AutomationBrowseCards />
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
            templates={AUTOMATION_CREATE_TEMPLATES}
            onCreate={NOOP}
          />
        }
      />
      <AutomationsList
        query={query}
        location={location}
        sort={sort}
        direction={direction}
      />
    </div>
  );
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
            <StoryEnvironmentInline display={LOCAL_ENVIRONMENT_DISPLAY} />
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

export function SkillsOverviewPage() {
  return (
    <PageStory>
      <SkillsOverviewSurface />
    </PageStory>
  );
}

export function PluginsOverviewPage() {
  return (
    <PageStory>
      <PluginsOverviewSurface />
    </PageStory>
  );
}

export function AutomationsOverviewPage() {
  return (
    <PageStory>
      <AutomationsOverviewSurface />
    </PageStory>
  );
}

export function SkillDetailPage() {
  return (
    <PageStory>
      <SkillDetail />
    </PageStory>
  );
}

export function PluginDetailPage() {
  return (
    <PageStory>
      <PluginDetail />
    </PageStory>
  );
}

export function AutomationDetailPage() {
  return (
    <PageStory>
      <AutomationDetail />
    </PageStory>
  );
}

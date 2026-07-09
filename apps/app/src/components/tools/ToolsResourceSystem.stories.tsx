import { useState, type ReactNode } from "react";
import { Button } from "@bb/shared-ui/button";
import { EmptyStatePanel } from "@bb/shared-ui/empty-state";
import { Icon, type IconName } from "@bb/shared-ui/icon";
import { cn } from "@bb/shared-ui/lib/utils";
import { Skeleton } from "@bb/shared-ui/skeleton";
import {
  ResourceActionButton,
  ResourceBrowseCard,
  ResourceCardStat,
  ResourceCreateButton,
  ResourceDetailPage,
  ResourceListPanel,
  ResourceMeta,
  ResourceOverflowMenu,
  ResourceProperty,
  ResourcePropertyList,
  ResourceRow,
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

type ResourceSurfaceId = "skills" | "plugins" | "automations";
type ProviderId = "bb" | "codex" | "claude-code";
type ProviderFilterId = ProviderId | "all";

interface ResourceSurface {
  id: ResourceSurfaceId;
  label: string;
  icon: IconName;
}

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

const RESOURCE_SURFACES: readonly ResourceSurface[] = [
  { id: "skills", label: "Skills", icon: "Zap" },
  { id: "plugins", label: "Plugins", icon: "ElectricPlugs" },
  { id: "automations", label: "Automations", icon: "TimeSchedule" },
];
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

function ResourceSurfaceSelector({
  activeSurface,
  onChange,
}: {
  activeSurface: ResourceSurfaceId;
  onChange: (surface: ResourceSurfaceId) => void;
}) {
  return (
    <nav aria-label="Resource pages" className="grid min-w-0 gap-1">
      {RESOURCE_SURFACES.map((surface) => {
        const active = surface.id === activeSurface;
        return (
          <button
            key={surface.id}
            type="button"
            aria-current={active ? "page" : undefined}
            className={cn(
              "inline-flex h-8 min-w-0 items-center gap-2 rounded-md px-2.5 text-sm transition-colors",
              active
                ? "bg-state-active text-foreground"
                : "text-muted-foreground hover:bg-state-hover hover:text-foreground",
            )}
            onClick={() => onChange(surface.id)}
          >
            <Icon name={surface.icon} className="size-4 shrink-0" aria-hidden />
            <span className="truncate">{surface.label}</span>
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

function RegistryBrowseSourceLoading() {
  return (
    <ResourceSourceShelf
      label="Browse"
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

function RegistryBrowseSourceEmpty() {
  return (
    <ResourceSourceShelf
      label="Browse"
      leading={<Icon name="Zap" className="size-3.5 shrink-0" aria-hidden />}
    >
      <ResourceSourceItem>
        <EmptyStatePanel className="min-h-36 justify-center py-5">
          No skills.sh results match this search.
        </EmptyStatePanel>
      </ResourceSourceItem>
    </ResourceSourceShelf>
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

function RegistrySkillDetail() {
  return (
    <ResourceDetailPage
      leading={<Icon name="Zap" className="size-4 text-muted-foreground" />}
      title="moss-skills/moss-notes"
      status={<StorySocialProof installs="3.4K installs" stars="25.6K stars" />}
      meta={<ResourceMeta items={["skills.sh", "moss-skills", "writing"]} />}
      description="Author and edit Moss notes with the current Moss syntax."
      actions={
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-7 gap-1 px-2 text-xs"
          disabled
          onClick={NOOP}
        >
          Installed
        </Button>
      }
    >
      <DetailSection label="Details">
        <ResourcePropertyList>
          <ResourceProperty label="Installs">3,412</ResourceProperty>
          <ResourceProperty label="GitHub stars">25,561</ResourceProperty>
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
      leading={<CodexMark className="size-4" />}
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

function ResourceSidebarEntrySample() {
  const [activeSurface, setActiveSurface] =
    useState<ResourceSurfaceId>("skills");
  return (
    <div className="w-48">
      <ResourceSurfaceSelector
        activeSurface={activeSurface}
        onChange={setActiveSurface}
      />
    </div>
  );
}

function StatusAndActionSamples() {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <ResourceState tone="success">Active</ResourceState>
      <ResourceState tone="warning">Failed</ResourceState>
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
      <ResourceProperty label="Environment">
        <StoryEnvironmentInline display={LOCAL_ENVIRONMENT_DISPLAY} />
      </ResourceProperty>
    </ResourcePropertyList>
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
      <RegistryBrowseSource />
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
          <RegistryBrowseSource />
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
          <RegistryBrowseSourceEmpty />
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
        label="sidebar entries"
        hint="three direct resource destinations; no mixed hub page and no in-page tab strip"
      >
        <PreviewStage className="max-w-[300px]">
          <ResourceSidebarEntrySample />
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
        hint="scrolling row panel; status appears once beside the title and hover/focus reveals actions"
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
          <RegistryBrowseSource />
        </PreviewStage>
      </StoryRow>
      <StoryRow
        label="skills rows"
        hint="scrolling row panel controlled by agent filter and alphabetical/provider sort"
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
        hint="bb and provider-specific plugins use the same scrolling row grammar as skills"
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

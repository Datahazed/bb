import { useState, type ReactNode } from "react";
import type { Story } from "@ladle/react";
import { Button } from "@bb/shared-ui/button";
import { COARSE_POINTER_ICON_SIZE_CLASS } from "@bb/shared-ui/coarse-pointer-sizing";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@bb/shared-ui/dropdown-menu";
import { Icon, type IconName } from "@bb/shared-ui/icon";
import { Input } from "@bb/shared-ui/input";
import { cn } from "@bb/shared-ui/lib/utils";
import {
  ResourceActionButton,
  ResourceBrowseCard,
  ResourceCardStat,
  ResourceCreateButton,
  ResourceDetailPage,
  ResourceDetailSection,
  ResourceListPanel,
  ResourceMeta,
  ResourceMultiSelectMenu,
  ResourceOverflowMenu,
  ResourceProperty,
  ResourcePropertyList,
  ResourceRow,
  ResourceShelfAction,
  ResourceSortMenu,
  ResourceSourceItem,
  ResourceSourceShelf,
  ResourceState,
  ResourceTabDescription,
  ResourceToolbar,
} from "@bb/shared-ui/resource-list";
import { Switch } from "@bb/shared-ui/switch";
import { Textarea } from "@bb/shared-ui/textarea";
import { ClaudeIcon } from "@/components/icons/ClaudeIcon";
import { OpenAiIcon } from "@/components/icons/OpenAiIcon";
import { FilePreview } from "@/components/secondary-panel/FilePreview.js";
import { PluginDetailView } from "@/components/tools/PluginDetailView";

export default {
  title: "Tools/Resource System",
};

const NOOP = () => {};
const SKILLS_SH_URL = "https://www.skills.sh/";
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
type ProviderFilterId = ProviderId;

interface ResourceListRowFixture {
  id: string;
  title: string;
  description: string;
  environment?: StoryEnvironmentDisplay;
  provider?: ProviderId;
  icon?: IconName;
  rowSignal?: "failed" | "running";
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

const WORKTREE_ENVIRONMENT_DISPLAY: StoryEnvironmentDisplay = {
  label: "Worktree",
  title: "Worktree",
  icon: "FolderGit",
};

const EXISTING_ENVIRONMENT_DISPLAY: StoryEnvironmentDisplay = {
  label: "Existing environment",
  title: "Reuses an existing environment",
  icon: "FolderGit",
};

const PROVIDER_FILTERS: readonly ProviderFilterId[] = [
  "bb",
  "codex",
  "claude-code",
];

const PROVIDER_FILTER_LABELS: Record<ProviderFilterId, string> = {
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
        description:
          "Inspect and manage bb projects, threads, and automations.",
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
    installs: "3.4K",
    stars: "25.6K",
  },
  {
    id: "review-loop",
    title: "bb/review-loop",
    source: "bb",
    summary: "Run a staged review loop and apply prioritized fixes.",
    installs: "1.3K",
    stars: "4.8K",
  },
  {
    id: "product-design-audit",
    title: "openai/product-design-audit",
    source: "openai",
    summary: "Capture screenshots and critique a product flow before build.",
    installs: "920",
    stars: "2.1K",
  },
  {
    id: "github-triage",
    title: "bb/github-triage",
    source: "bb",
    summary: "Find actionable GitHub PR and issue follow-up for agents.",
    installs: "740",
    stars: "1.5K",
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
        description: "Run scheduled bb work across projects and folders.",
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
    project: "bb",
    folder: "Maintenance",
  },
  {
    id: "release-readiness",
    title: "Release readiness sweep",
    description: "Every hour",
    environment: LOCAL_ENVIRONMENT_DISPLAY,
    icon: "Calendar",
    rowSignal: "running",
    project: "bb",
    folder: "Releases",
  },
  {
    id: "ci-failure-watcher",
    title: "CI failure watcher",
    description: "Every 15 min",
    environment: LOCAL_ENVIRONMENT_DISPLAY,
    icon: "Calendar",
    rowSignal: "failed",
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
  if (row.rowSignal === "failed") {
    return (
      <Icon
        name="CircleX"
        className="size-4 text-destructive"
        aria-label="Failed"
      />
    );
  }
  if (row.rowSignal === "running") {
    return (
      <Icon
        name="Loading"
        className={cn(
          "animate-spin text-muted-foreground/50",
          COARSE_POINTER_ICON_SIZE_CLASS,
        )}
        aria-label="Running"
      />
    );
  }
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
  providerFilters,
  sort,
  direction,
  availableProviders,
  onProviderFiltersChange,
  onSortChange,
}: {
  providerFilters: readonly ProviderFilterId[];
  sort: "provider" | "alpha";
  direction: "asc" | "desc";
  availableProviders: ReadonlySet<ProviderId>;
  onProviderFiltersChange: (providers: ProviderFilterId[]) => void;
  onSortChange: (sort: "provider" | "alpha") => void;
}) {
  const providerSortDisabled = availableProviders.size <= 1;
  return (
    <>
      <ResourceMultiSelectMenu
        label="Agent"
        icon="Layers"
        selectedValues={providerFilters}
        options={PROVIDER_FILTERS.map((id) => ({
          id,
          label: PROVIDER_FILTER_LABELS[id],
          disabled: !availableProviders.has(id),
        }))}
        onChange={(values) =>
          onProviderFiltersChange(values as ProviderFilterId[])
        }
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

function ResourceRowsList({
  sections,
  query,
  providerFilters,
  sortMode,
  sortDirection,
  fallbackIcon,
  kind,
}: {
  sections: readonly ResourceSectionFixture[];
  query: string;
  providerFilters: readonly ProviderFilterId[];
  sortMode: "provider" | "alpha";
  sortDirection: "asc" | "desc";
  fallbackIcon: IconName;
  kind: "skill" | "plugin";
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
      if (
        providerFilters.length > 0 &&
        !providerFilters.includes(row.provider ?? "bb")
      ) {
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
          actions={
            kind === "plugin" ? (
              <>
                <ResourceActionButton
                  label={row.muted ? "Enable" : "Disable"}
                  icon={row.muted ? "Play" : "Pause"}
                  onClick={NOOP}
                />
                <RowOpenAction label={`Open ${row.title}`} />
              </>
            ) : (
              <RowOpenAction label={`Open ${row.title}`} />
            )
          }
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
      <ResourceCardStat
        icon="Download"
        accessibleLabel={`${installs} installs`}
      >
        {installs}
      </ResourceCardStat>
      <ResourceCardStat icon="Star" accessibleLabel={`${stars} stars`}>
        {stars}
      </ResourceCardStat>
    </span>
  );
}

function SkillsShAttributionLink() {
  return (
    <a
      href={SKILLS_SH_URL}
      target="_blank"
      rel="noreferrer"
      className="inline-flex items-center gap-1 rounded-sm text-[11px] text-subtle-foreground hover:text-muted-foreground hover:underline focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
    >
      <span>powered by skills.sh</span>
    </a>
  );
}

function StoryInstallComboButton({
  installed,
  onInstall,
}: {
  installed: boolean;
  onInstall: (target: string) => void;
}) {
  if (installed) {
    return (
      <Button
        type="button"
        variant="secondary"
        size="sm"
        className="h-7 px-2 text-xs"
        disabled
      >
        Installed
      </Button>
    );
  }
  return (
    <span className="inline-flex items-stretch">
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="h-7 rounded-r-none px-2 text-xs"
        onClick={() => onInstall("Codex")}
      >
        Install
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="outline"
            size="sm"
            aria-label="Choose install target"
            className="-ml-px h-7 rounded-l-none px-1.5"
          >
            <Icon name="ChevronDown" className="size-3.5" aria-hidden />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-44">
          <DropdownMenuItem onSelect={() => onInstall("Codex")}>
            Install for Codex
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => onInstall("Claude Code")}>
            Install for Claude Code
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => onInstall("Project scope")}>
            Project scope
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </span>
  );
}

function RegistryBrowseSource({
  showAll,
  installedSkillIds,
  onInstall,
  onSeeAll,
}: {
  showAll: boolean;
  installedSkillIds: ReadonlySet<string>;
  onInstall: (id: string, target: string) => void;
  onSeeAll: () => void;
}) {
  const rows = showAll
    ? REGISTRY_SOURCE_ROWS
    : REGISTRY_SOURCE_ROWS.slice(0, 2);
  return (
    <ResourceSourceShelf
      label="Browse"
      attribution={<SkillsShAttributionLink />}
      browseAction={
        <ResourceShelfAction type="button" onClick={onSeeAll}>
          {showAll ? "Showing all" : "See all"}
        </ResourceShelfAction>
      }
    >
      {rows.map((row) => (
        <ResourceSourceItem key={row.id}>
          <ResourceBrowseCard
            title={row.title}
            byline={`by ${row.source}`}
            description={row.summary}
            openLabel={`Open ${row.title}`}
            onOpen={NOOP}
            headerAction={
              <StoryInstallComboButton
                installed={installedSkillIds.has(row.id)}
                onInstall={(target) => onInstall(row.id, target)}
              />
            }
            footerMeta={
              <StorySocialProof installs={row.installs} stars={row.stars} />
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
      browseAction={
        <ResourceShelfAction type="button">See all</ResourceShelfAction>
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
            byline="Starter template"
            description={template.description}
            openLabel={`Use ${template.label} template`}
            headerAction={
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
      label="Browse"
      icon="ElectricPlugs"
      templates={PLUGIN_CREATE_TEMPLATES}
    />
  );
}

function AutomationBrowseCards() {
  return (
    <TemplateBrowseCards
      label="Browse"
      icon="TimeSchedule"
      templates={AUTOMATION_CREATE_TEMPLATES}
    />
  );
}

function AutomationsList({
  query,
  locationFilters,
  sort,
  direction,
}: {
  query: string;
  locationFilters: readonly string[];
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
      if (locationFilters.length === 0) return true;
      return locationFilters.includes(
        `${row.project?.toLowerCase()}/${row.folder?.toLowerCase()}`,
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
  const [providerFilters, setProviderFilters] = useState<ProviderFilterId[]>(
    [],
  );
  const [sort, setSort] = useState<"provider" | "alpha">("alpha");
  const [direction, setDirection] = useState<"asc" | "desc">("asc");
  const [showAllBrowse, setShowAllBrowse] = useState(false);
  const [installedSkillIds, setInstalledSkillIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [draftSkill, setDraftSkill] = useState<ResourceListRowFixture | null>(
    null,
  );
  const skillSections = draftSkill
    ? SKILL_SECTIONS.map((section, index) =>
        index === 0
          ? { ...section, rows: [draftSkill, ...section.rows] }
          : section,
      )
    : SKILL_SECTIONS;
  const providerBuckets = providerBucketsForSections(skillSections);
  function updateSort(nextSort: "provider" | "alpha") {
    if (nextSort === "provider" && providerBuckets.size <= 1) return;
    if (nextSort === sort) {
      setDirection((current) => (current === "asc" ? "desc" : "asc"));
    } else {
      setSort(nextSort);
      setDirection("asc");
    }
  }
  function handleRegistryInstall(id: string, _target: string) {
    setInstalledSkillIds((current) => {
      const next = new Set(current);
      next.add(id);
      return next;
    });
    const row = REGISTRY_SOURCE_ROWS.find((candidate) => candidate.id === id);
    if (!row) return;
    setDraftSkill({
      id: `installed-${id}`,
      title: row.title,
      description: row.summary,
      provider: "bb",
      icon: "Zap",
    });
  }
  function handleCreateSkill(prompt?: string) {
    const template = SKILL_CREATE_TEMPLATES.find(
      (candidate) => candidate.prompt === prompt,
    );
    setDraftSkill({
      id: `draft-${template?.label ?? "blank"}`,
      title: template ? `Draft: ${template.label}` : "Untitled bb skill",
      description:
        prompt ??
        "New skill draft created from the story's primary create action.",
      provider: "bb",
      icon: "Zap",
    });
  }
  return (
    <div className="space-y-4">
      <ResourceTabDescription>
        All skills from bb and your configured agents, in one place. Skills
        created in bb are available across every agent you use in bb.
      </ResourceTabDescription>
      <RegistryBrowseSource
        showAll={showAllBrowse}
        installedSkillIds={installedSkillIds}
        onInstall={handleRegistryInstall}
        onSeeAll={() => setShowAllBrowse(true)}
      />
      <ResourceToolbar
        searchValue={query}
        searchPlaceholder="Search skills"
        onSearchChange={setQuery}
        controls={
          <StoryListControls
            providerFilters={providerFilters}
            sort={sort}
            direction={direction}
            availableProviders={providerBuckets}
            onProviderFiltersChange={setProviderFilters}
            onSortChange={updateSort}
          />
        }
        action={
          <ResourceCreateButton
            label="New bb skill"
            templates={SKILL_CREATE_TEMPLATES}
            onCreate={handleCreateSkill}
          />
        }
      />
      <ResourceRowsList
        sections={skillSections}
        query={query}
        providerFilters={providerFilters}
        sortMode={sort}
        sortDirection={direction}
        fallbackIcon="Zap"
        kind="skill"
      />
    </div>
  );
}

function PluginsOverviewSurface() {
  const [query, setQuery] = useState("");
  const [providerFilters, setProviderFilters] = useState<ProviderFilterId[]>(
    [],
  );
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
            providerFilters={providerFilters}
            sort={sort}
            direction={direction}
            availableProviders={providerBuckets}
            onProviderFiltersChange={setProviderFilters}
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
        providerFilters={providerFilters}
        sortMode={sort}
        sortDirection={direction}
        fallbackIcon="ElectricPlugs"
        kind="plugin"
      />
    </div>
  );
}

function AutomationsOverviewSurface() {
  const [query, setQuery] = useState("");
  const [locationFilters, setLocationFilters] = useState<string[]>([]);
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
            <ResourceMultiSelectMenu
              label="Project / folder"
              icon="Layers"
              selectedValues={locationFilters}
              options={[
                { id: "bb/reviews", label: "bb / Reviews" },
                { id: "bb/maintenance", label: "bb / Maintenance" },
                { id: "moss/ci", label: "moss / CI" },
              ]}
              onChange={setLocationFilters}
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
        locationFilters={locationFilters}
        sort={sort}
        direction={direction}
      />
    </div>
  );
}

interface AutomationDetailRunFixture {
  id: string;
  status: "Succeeded" | "Failed" | "Running" | "Skipped";
  when: string;
  duration?: string;
  thread?: string;
}

interface AutomationDetailFixture {
  id: string;
  title: string;
  icon: IconName;
  enabled: boolean;
  switchDisabled?: boolean;
  status?: {
    label: string;
    tone: "muted" | "success" | "warning" | "error";
  };
  executionKind: "Agent" | "Script";
  scheduleLabel: string;
  schedule: string;
  execution: string;
  origin: string;
  environment?: StoryEnvironmentDisplay;
  prompt?: string;
  script?: string;
  scriptFile?: string;
  runs: readonly AutomationDetailRunFixture[];
}

const AUTOMATION_DETAIL_FIXTURES: readonly AutomationDetailFixture[] = [
  {
    id: "pr-review",
    title: "PR review queue",
    icon: "Calendar",
    enabled: true,
    executionKind: "Agent",
    scheduleLabel: "Next run today, 1:00 PM",
    schedule: "Every hour · America/Los_Angeles",
    execution: "Agent · codex/gpt-5.5 · Workspace write",
    origin: "Agent-created",
    environment: LOCAL_ENVIRONMENT_DISPLAY,
    prompt:
      "Review open PRs assigned to me, summarize blocking feedback, and open a follow-up thread only when a PR needs action.",
    runs: [
      {
        id: "pr-1",
        status: "Succeeded",
        when: "Jul 9, 12:13 PM",
        duration: "22s",
        thread: "View thread",
      },
      {
        id: "pr-2",
        status: "Succeeded",
        when: "Jul 9, 11:00 AM",
        duration: "20s",
        thread: "View thread",
      },
      {
        id: "pr-3",
        status: "Skipped",
        when: "Jul 9, 10:00 AM",
        duration: "0.8s",
      },
    ],
  },
  {
    id: "release-readiness",
    title: "Release readiness check",
    icon: "Calendar",
    enabled: true,
    status: { label: "Failed", tone: "error" },
    executionKind: "Agent",
    scheduleLabel: "Next run today, 5:00 PM",
    schedule: "Every 2 hours · America/Los_Angeles",
    execution: "Agent · claude-code/sonnet · Workspace write",
    origin: "Human-created",
    environment: WORKTREE_ENVIRONMENT_DISPLAY,
    prompt:
      "Check release branch status, failed CI, unresolved launch blockers, and summarize only changes since the previous run.",
    runs: [
      {
        id: "release-1",
        status: "Failed",
        when: "Jul 9, 3:00 PM",
        duration: "1m 04s",
        thread: "View thread",
      },
      {
        id: "release-2",
        status: "Succeeded",
        when: "Jul 9, 1:00 PM",
        duration: "38s",
        thread: "View thread",
      },
      {
        id: "release-3",
        status: "Succeeded",
        when: "Jul 9, 11:00 AM",
        duration: "41s",
        thread: "View thread",
      },
    ],
  },
  {
    id: "stale-worktree",
    title: "Stale worktree cleanup reminder",
    icon: "ComputerTerminal01",
    enabled: false,
    executionKind: "Script",
    scheduleLabel: "Paused",
    schedule: "4PM Fri · America/Los_Angeles",
    execution: "Script · bash script.sh · 120s timeout",
    origin: "App-created",
    scriptFile: "script.sh",
    runs: [
      {
        id: "stale-1",
        status: "Skipped",
        when: "Jul 7, 6:02 PM",
        duration: "0.7s",
      },
      {
        id: "stale-2",
        status: "Failed",
        when: "Jul 5, 2:00 PM",
        duration: "1.0s",
      },
    ],
  },
  {
    id: "digest-running",
    title: "Daily workspace digest",
    icon: "Calendar",
    enabled: true,
    status: { label: "Running", tone: "muted" },
    executionKind: "Agent",
    scheduleLabel: "Next run tomorrow, 9:00 AM",
    schedule: "9AM Mon-Fri · America/New_York",
    execution: "Agent · codex/gpt-5.5-medium · Read-only",
    origin: "Agent-created",
    environment: EXISTING_ENVIRONMENT_DISPLAY,
    prompt:
      "Summarize yesterday's active threads, blocked work, merged PRs, and unresolved questions into a short morning digest.",
    runs: [
      {
        id: "digest-1",
        status: "Running",
        when: "Now",
      },
      {
        id: "digest-2",
        status: "Succeeded",
        when: "Jul 8, 9:00 AM",
        duration: "31s",
        thread: "View thread",
      },
      {
        id: "digest-3",
        status: "Succeeded",
        when: "Jul 7, 9:00 AM",
        duration: "28s",
        thread: "View thread",
      },
    ],
  },
  {
    id: "one-shot",
    title: "Launch note follow-up",
    icon: "Calendar",
    enabled: false,
    switchDisabled: true,
    status: { label: "Completed", tone: "muted" },
    executionKind: "Agent",
    scheduleLabel: "Completed",
    schedule: "Once · Jul 8, 4:00 PM · America/Los_Angeles",
    execution: "Agent · codex/gpt-5.5 · Workspace write",
    origin: "Human-created",
    environment: LOCAL_ENVIRONMENT_DISPLAY,
    prompt:
      "Check whether the launch note received review comments and open a reminder thread if the doc is still waiting.",
    runs: [
      {
        id: "launch-1",
        status: "Succeeded",
        when: "Jul 8, 4:00 PM",
        duration: "18s",
        thread: "View thread",
      },
    ],
  },
];

function automationFixtureBodyLabel(
  fixture: AutomationDetailFixture,
): "Prompt" | "Script" | "Script file" {
  if (fixture.prompt !== undefined) return "Prompt";
  if (fixture.script !== undefined) return "Script";
  return "Script file";
}

function automationFixtureBodyValue(fixture: AutomationDetailFixture): string {
  return fixture.prompt ?? fixture.script ?? fixture.scriptFile ?? "";
}

function automationFixtureScheduleMeta(
  fixture: AutomationDetailFixture,
  enabled: boolean,
): string {
  if (fixture.switchDisabled) return fixture.scheduleLabel;
  if (!enabled) return "Paused";
  return fixture.scheduleLabel === "Paused"
    ? fixture.schedule
    : fixture.scheduleLabel;
}

function AutomationRunHistory({
  runs,
}: {
  runs: readonly AutomationDetailRunFixture[];
}) {
  const iconForStatus = (status: AutomationDetailRunFixture["status"]) => {
    if (status === "Failed") return "CircleX";
    if (status === "Running") return "Loading";
    if (status === "Skipped") return "CircleDashed";
    return "CircleCheck";
  };
  const classForStatus = (status: AutomationDetailRunFixture["status"]) =>
    cn(
      "size-4 shrink-0",
      status === "Failed" && "text-destructive",
      status === "Running" && "animate-spin text-muted-foreground",
      status === "Skipped" && "text-muted-foreground",
      status === "Succeeded" && "text-success",
    );

  return (
    <div className="space-y-2">
      {runs.map((run) => (
        <div
          key={run.id}
          className="flex min-w-0 items-center gap-3 rounded-md border border-border bg-surface-raised px-3 py-2 shadow-sm"
        >
          <Icon
            name={iconForStatus(run.status)}
            className={classForStatus(run.status)}
            aria-hidden
          />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{run.status}</p>
            <p className="truncate text-xs text-muted-foreground">
              {[run.when, run.duration].filter(Boolean).join(" · ")}
            </p>
          </div>
          {run.thread ? (
            <Button variant="ghost" size="sm" className="h-7 px-2 text-xs">
              {run.thread}
            </Button>
          ) : null}
        </div>
      ))}
    </div>
  );
}

function AutomationDetailContent({
  fixture,
}: {
  fixture: AutomationDetailFixture;
}) {
  const [enabled, setEnabled] = useState(fixture.enabled);
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(fixture.title);
  const [body, setBody] = useState(automationFixtureBodyValue(fixture));
  const [draftTitle, setDraftTitle] = useState(fixture.title);
  const [draftBody, setDraftBody] = useState(
    automationFixtureBodyValue(fixture),
  );

  function startEditing() {
    setDraftTitle(title);
    setDraftBody(body);
    setEditing(true);
  }

  function cancelEditing() {
    setDraftTitle(title);
    setDraftBody(body);
    setEditing(false);
  }

  function saveEditing() {
    if (draftTitle.trim().length === 0 || draftBody.trim().length === 0) {
      return;
    }
    setTitle(draftTitle.trim());
    setBody(draftBody);
    setEditing(false);
  }

  const bodyLabel = automationFixtureBodyLabel(fixture);
  const canSave = draftTitle.trim().length > 0 && draftBody.trim().length > 0;

  return (
    <ResourceDetailPage
      leading={
        <Icon
          name={fixture.icon}
          className="size-4 text-muted-foreground"
          aria-hidden
        />
      }
      title={editing ? draftTitle || title : title}
      info={
        fixture.status ? (
          <ResourceState tone={fixture.status.tone}>
            {fixture.status.label}
          </ResourceState>
        ) : undefined
      }
      lifecycleControl={
        <Switch
          size="sm"
          checked={enabled}
          disabled={fixture.switchDisabled}
          aria-label={enabled ? "Pause automation" : "Resume automation"}
          onCheckedChange={setEnabled}
        />
      }
      overflowMenu={
        <ResourceOverflowMenu
          label="Automation actions"
          items={[
            {
              label: "Edit",
              icon: "Edit",
              disabled: editing,
              onSelect: startEditing,
            },
            { kind: "separator" },
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
      }
      metadata={
        <ResourceMeta
          items={[automationFixtureScheduleMeta(fixture, enabled)]}
        />
      }
      modeActions={
        editing ? (
          <>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={cancelEditing}
            >
              Cancel
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={!canSave}
              onClick={saveEditing}
            >
              Save
            </Button>
          </>
        ) : null
      }
    >
      <ResourceDetailSection label="Configuration">
        <ResourcePropertyList>
          {editing ? (
            <ResourceProperty label="Name">
              <Input
                value={draftTitle}
                onChange={(event) => setDraftTitle(event.target.value)}
                aria-label="Automation name"
                className="h-8"
              />
            </ResourceProperty>
          ) : null}
          <ResourceProperty label="Schedule">
            {fixture.schedule}
          </ResourceProperty>
          <ResourceProperty label="Execution">
            {fixture.execution}
          </ResourceProperty>
          <ResourceProperty label="Origin">{fixture.origin}</ResourceProperty>
          {fixture.environment ? (
            <ResourceProperty label="Environment">
              <StoryEnvironmentInline display={fixture.environment} />
            </ResourceProperty>
          ) : null}
          {fixture.prompt ? (
            <ResourceProperty label="Prompt">
              {editing ? (
                <Textarea
                  value={draftBody}
                  onChange={(event) => setDraftBody(event.target.value)}
                  aria-label="Automation prompt"
                  className="min-h-40 resize-y text-sm leading-relaxed"
                />
              ) : (
                <span className="whitespace-pre-wrap">{body}</span>
              )}
            </ResourceProperty>
          ) : fixture.script ? (
            <ResourceProperty label="Script">
              {editing ? (
                <Textarea
                  value={draftBody}
                  onChange={(event) => setDraftBody(event.target.value)}
                  aria-label="Automation script"
                  className="min-h-40 resize-y font-mono text-xs leading-relaxed"
                />
              ) : (
                <pre className="whitespace-pre-wrap font-mono text-xs leading-relaxed">
                  {body}
                </pre>
              )}
            </ResourceProperty>
          ) : fixture.scriptFile ? (
            <ResourceProperty label={bodyLabel}>
              {editing ? (
                <Input
                  value={draftBody}
                  onChange={(event) => setDraftBody(event.target.value)}
                  aria-label="Automation script file"
                  className="h-8 font-mono text-xs"
                />
              ) : (
                body
              )}
            </ResourceProperty>
          ) : null}
        </ResourcePropertyList>
      </ResourceDetailSection>
      <ResourceDetailSection label="Run history">
        <AutomationRunHistory runs={fixture.runs} />
      </ResourceDetailSection>
    </ResourceDetailPage>
  );
}

function AutomationDetail({ selectedId }: { selectedId: string }) {
  const fixture =
    AUTOMATION_DETAIL_FIXTURES.find(
      (candidate) => candidate.id === selectedId,
    ) ?? AUTOMATION_DETAIL_FIXTURES[0];

  return <AutomationDetailContent key={fixture.id} fixture={fixture} />;
}

interface SkillDetailFileFixture {
  path: string;
  contents: string;
}

interface SkillDetailFixture {
  id: string;
  exampleLabel: string;
  title: string;
  provider: ProviderId;
  status: string;
  statusTone: "muted" | "success";
  path: string;
  markdown: string;
  includedFiles?: readonly SkillDetailFileFixture[];
}

const SKILL_DETAIL_FIXTURES: readonly SkillDetailFixture[] = [
  {
    id: "bb-cli",
    exampleLabel: "bb-cli · Built-in",
    title: "bb-cli",
    provider: "bb",
    status: "Built-in",
    statusTone: "muted",
    path: "~/.bb/runtime/global-skills/bb-cli/SKILL.md",
    markdown: [
      "---",
      "name: bb-cli",
      "description: Use this when controlling bb. The bb CLI lets you inspect, create, and orchestrate bb threads, automations, projects, providers, and environments.",
      "---",
      "",
      "# bb CLI",
      "",
      "Use `bb` when controlling bb itself: inspect current context, coordinate threads, message agents, or inspect projects, providers, and environments.",
      "",
      "## Start With Context",
      "",
      "- Use `bb status` to identify the current project, thread, and environment.",
      "- Prefer `--json` when command output will drive follow-up work.",
      "- Run `bb guide` for the system overview and `bb guide <chapter>` for command reference.",
      "",
      "## Coordinating Work",
      "",
      "- Use one clear owner per task.",
      "- Spawn independent tasks separately when parallel work is useful.",
      "- Use `bb thread wait <thread-id>` when you explicitly need to block until a thread finishes.",
    ].join("\n"),
  },
  {
    id: "skill-creator",
    exampleLabel: "skill-creator · Built-in",
    title: "skill-creator",
    provider: "bb",
    status: "Built-in",
    statusTone: "muted",
    path: "~/.bb/runtime/global-skills/skill-creator/SKILL.md",
    markdown: [
      "---",
      "name: skill-creator",
      "description: Create new bb skills and improve existing ones. Use this whenever the user wants to make, write, edit, refine, or optimize a skill.",
      "---",
      "",
      "# Skill Creator",
      "",
      "A skill for creating new bb skills and iteratively improving them.",
      "",
      "## How skills work in bb",
      "",
      "- **Location.** User skills live under `~/.bb/skills/<name>/`.",
      "- **Frontmatter.** `SKILL.md` begins with `name` and `description`.",
      "- **Discovery.** New or edited skills are picked up by the next thread you spawn.",
      "- **Bundled resources.** `scripts/`, `references/`, and `assets/` ship with the skill.",
      "",
      "## Workflow",
      "",
      "1. Capture what the skill should enable and when it should trigger.",
      "2. Write a focused `SKILL.md` and move deep detail into bundled resources.",
      "3. Test realistic prompts in fresh bb threads.",
      "4. Compare outcomes, revise, and repeat until the behavior is reliable.",
    ].join("\n"),
  },
  {
    id: "documents-multifolder",
    exampleLabel: "documents · Multi-folder",
    title: "documents",
    provider: "codex",
    status: "Read-only",
    statusTone: "muted",
    path: "~/.codex/plugins/openai-primary-runtime/documents/skills/documents/SKILL.md",
    markdown: [
      "---",
      "name: documents",
      "description: Create, edit, redline, and comment on DOCX, Word, and Google Docs-targeted document artifacts.",
      "---",
      "",
      "# Documents Skill",
      "",
      "Use this skill to create or modify document artifacts and verify them visually.",
      "",
      "## Render and verify",
      "",
      "1. Use the appropriate task guide and design preset.",
      "2. Build or edit the DOCX.",
      "3. Run `render_docx.py` to produce page images.",
      "4. Inspect every rendered page and iterate until the layout is clean.",
      "",
      "## Bundled resources",
      "",
      "Read the relevant reference page or run a bundled script only when that part of the workflow is needed.",
    ].join("\n"),
    includedFiles: [
      {
        path: "references/design_presets.md",
        contents: [
          "# Document Design Presets",
          "",
          "Choose one preset before drafting a new document.",
          "",
          "## standard_business_brief",
          "",
          "Use for formal memos, decision documents, and board-facing briefs.",
          "",
          "## compact_reference_guide",
          "",
          "Use for launch guides, checklists, and dense operator references.",
          "",
          "## narrative_proposal",
          "",
          "Use for grants and persuasive documents with longer prose.",
        ].join("\n"),
      },
      {
        path: "references/header_templates.md",
        contents: [
          "# Header Templates",
          "",
          "Use a restrained first-page header that matches the document archetype.",
          "",
          "- Memo: title, decision owner, date, and status.",
          "- Proposal: title, subtitle, organization, and prepared-for line.",
          "- Guide: compact title with version and last-updated metadata.",
        ].join("\n"),
      },
      {
        path: "ooxml/comments.md",
        contents: [
          "# Word Comments",
          "",
          "Comments are represented across the document body, comments part, and relationship metadata.",
          "",
          "When editing comments, preserve existing IDs and verify the document after patching the OOXML package.",
        ].join("\n"),
      },
      {
        path: "scripts/a11y_audit.py",
        contents: [
          "from pathlib import Path",
          "",
          "def audit_document(path: Path) -> list[str]:",
          "    issues: list[str] = []",
          "    # Inspect headings, image alt text, table headers, and link labels.",
          "    return issues",
        ].join("\n"),
      },
    ],
  },
];

function StoryPathCopyButton({ path }: { path: string }) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(path);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    } catch {
      setCopied(false);
    }
  }

  return (
    <button
      type="button"
      aria-label={`Copy skill path: ${path}`}
      onClick={handleCopy}
      className="group inline-flex max-w-full items-center gap-1 rounded-sm text-xs text-subtle-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
    >
      <span className="truncate font-mono">{path}</span>
      <Icon
        name={copied ? "Check" : "Copy"}
        className="size-3 shrink-0 opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
        aria-hidden
      />
    </button>
  );
}

function SkillIncludedFiles({
  rootPath,
  files,
}: {
  rootPath: string;
  files: readonly SkillDetailFileFixture[];
}) {
  const [selectedPath, setSelectedPath] = useState(files[0]?.path ?? "");
  const selectedFile =
    files.find((file) => file.path === selectedPath) ?? files[0];

  if (selectedFile === undefined) return null;

  return (
    <div className="grid min-h-64 gap-2 md:grid-cols-[14rem_minmax(0,1fr)]">
      <div className="max-h-[44dvh] overflow-auto rounded-md border border-border bg-surface-raised p-1 shadow-sm">
        {files.map((file) => (
          <button
            key={file.path}
            type="button"
            aria-pressed={file.path === selectedFile.path}
            onClick={() => setSelectedPath(file.path)}
            className="flex w-full min-w-0 items-center gap-2 rounded-sm px-2 py-1.5 text-left font-mono text-xs text-muted-foreground hover:bg-state-hover hover:text-foreground aria-pressed:bg-state-active aria-pressed:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          >
            <Icon name="FileText" className="size-3.5 shrink-0" aria-hidden />
            <span className="min-w-0 truncate">{file.path}</span>
          </button>
        ))}
      </div>
      <div className="max-h-[44dvh] min-h-64 overflow-auto rounded-md border border-border bg-surface-raised">
        <FilePreview
          path={`${rootPath.replace(/\/SKILL\.md$/, "")}/${selectedFile.path}`}
          headerMode="none"
          state={{
            kind: "ready",
            file: {
              name: selectedFile.path.split("/").at(-1) ?? selectedFile.path,
              contents: selectedFile.contents,
            },
            lineRange: null,
            showMarkdownModeToggle: false,
          }}
        />
      </div>
    </div>
  );
}

function SkillDetailContent({ fixture }: { fixture: SkillDetailFixture }) {
  const [editing, setEditing] = useState(false);
  const [savedMarkdown, setSavedMarkdown] = useState(fixture.markdown);
  const [draft, setDraft] = useState(fixture.markdown);

  const actions = editing ? (
    <>
      <Button variant="outline" size="sm" onClick={() => setEditing(false)}>
        Cancel
      </Button>
      <Button
        size="sm"
        onClick={() => {
          setSavedMarkdown(draft);
          setEditing(false);
        }}
      >
        Save
      </Button>
    </>
  ) : null;

  return (
    <ResourceDetailPage
      leading={<ProviderMark provider={fixture.provider} />}
      title={fixture.title}
      info={
        <ResourceState tone={fixture.statusTone}>
          {fixture.status}
        </ResourceState>
      }
      overflowMenu={
        <ResourceOverflowMenu
          label="Skill actions"
          items={[
            {
              label: "Edit",
              icon: "Edit",
              onSelect: () => setEditing(true),
            },
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
      metadata={<StoryPathCopyButton path={fixture.path} />}
      modeActions={actions}
    >
      <ResourceDetailSection label="SKILL.md">
        {editing ? (
          <textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            aria-label="SKILL.md"
            className="h-[52dvh] w-full resize-none rounded-md border border-border bg-surface-raised p-3 font-mono text-xs leading-relaxed focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          />
        ) : (
          <div className="max-h-[52dvh] overflow-auto rounded-md border border-border">
            <FilePreview
              path={fixture.path}
              headerMode="none"
              state={{
                kind: "ready",
                file: { name: "SKILL.md", contents: savedMarkdown },
                lineRange: null,
                showMarkdownModeToggle: false,
              }}
            />
          </div>
        )}
      </ResourceDetailSection>
      {fixture.includedFiles ? (
        <ResourceDetailSection label="Included files">
          <SkillIncludedFiles
            rootPath={fixture.path}
            files={fixture.includedFiles}
          />
        </ResourceDetailSection>
      ) : null}
    </ResourceDetailPage>
  );
}

function SkillDetail({ selectedId }: { selectedId: string }) {
  const fixture =
    SKILL_DETAIL_FIXTURES.find((candidate) => candidate.id === selectedId) ??
    SKILL_DETAIL_FIXTURES[0];
  return <SkillDetailContent key={fixture.id} fixture={fixture} />;
}

interface PluginSettingFixture {
  label: string;
  value: ReactNode;
}

interface PluginDetailFixture {
  id: string;
  title: string;
  provider: ProviderId;
  version: string;
  enabled: boolean;
  status: {
    label: string;
    tone: "muted" | "success" | "warning" | "error";
  };
  source: string;
  description: string;
  statusDetail?: string;
  capabilities: readonly string[];
  settings: readonly PluginSettingFixture[];
}

const PLUGIN_DETAIL_FIXTURES: readonly PluginDetailFixture[] = [
  {
    id: "bb-automations",
    title: "automations",
    provider: "bb",
    version: "0.1.0",
    enabled: true,
    status: { label: "Running", tone: "success" },
    source: "Built-in",
    description: "Run scheduled bb work across projects and folders.",
    capabilities: [
      "Tools navigation surface",
      "Automation list and detail views",
      "Create-via-chat templates",
      "Run history",
    ],
    settings: [],
  },
  {
    id: "bb-connect",
    title: "connect",
    provider: "bb",
    version: "0.2.0",
    enabled: true,
    status: { label: "Needs configuration", tone: "warning" },
    source: "Built-in",
    description: "Remote access via getbb.app.",
    statusDetail: "Sign in before remote hosts and browser access are enabled.",
    capabilities: [
      "Remote host pairing",
      "Browser access",
      "Connection status panel",
    ],
    settings: [
      { label: "Account", value: "Not connected" },
      { label: "Remote access", value: "Off until sign-in" },
    ],
  },
  {
    id: "codex-github",
    title: "github",
    provider: "codex",
    version: "0.1.8",
    enabled: true,
    status: { label: "Running", tone: "success" },
    source: "openai-curated-remote",
    description: "Inspect repositories, issues, pull requests, and CI state.",
    capabilities: [
      "GitHub MCP tools",
      "PR review skills",
      "CI investigation workflows",
      "Repository metadata lookup",
    ],
    settings: [
      { label: "Account", value: "Connected" },
      { label: "Default repository", value: "ymichael/bb" },
      { label: "Write access", value: "Enabled" },
    ],
  },
  {
    id: "codex-notion",
    title: "notion",
    provider: "codex",
    version: "0.1.7",
    enabled: false,
    status: { label: "Running", tone: "success" },
    source: "openai-curated-remote",
    description: "Capture and retrieve connected Notion context.",
    capabilities: [
      "Knowledge capture",
      "Research documentation",
      "Meeting intelligence",
    ],
    settings: [
      { label: "Workspace", value: "Product" },
      { label: "Default database", value: "Knowledge base" },
    ],
  },
  {
    id: "claude-linear",
    title: "linear",
    provider: "claude-code",
    version: "0.3.1",
    enabled: true,
    status: { label: "Degraded", tone: "warning" },
    source: "Claude Code",
    description: "Read Linear issues and create follow-up implementation work.",
    statusDetail:
      "Issue search is available; write actions are waiting on a refreshed token.",
    capabilities: [
      "Issue search",
      "Project and cycle lookup",
      "Implementation handoff prompts",
    ],
    settings: [
      { label: "Workspace", value: "bb" },
      { label: "Token", value: "[set]" },
      { label: "Write actions", value: "Paused" },
    ],
  },
  {
    id: "codex-product-design",
    title: "product-design",
    provider: "codex",
    version: "0.1.50",
    enabled: true,
    status: { label: "Running", tone: "success" },
    source: "openai-curated-remote",
    description: "Audit product flows and turn visual references into code.",
    capabilities: [
      "Product design audit skill",
      "Image-to-code skill",
      "URL-to-code skill",
      "Design critique workflow",
    ],
    settings: [
      { label: "Screenshot capture", value: "Browser" },
      { label: "Review depth", value: "Thorough" },
    ],
  },
];

function PluginCapabilitiesList({
  capabilities,
}: {
  capabilities: readonly string[];
}) {
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {capabilities.map((capability) => (
        <div
          key={capability}
          className="rounded-md border border-border bg-surface-raised px-3 py-2 text-sm shadow-sm"
        >
          {capability}
        </div>
      ))}
    </div>
  );
}

function PluginDetailContent({ fixture }: { fixture: PluginDetailFixture }) {
  const [enabled, setEnabled] = useState(fixture.enabled);

  const health =
    enabled &&
    (fixture.status.tone === "warning" || fixture.status.tone === "error")
      ? fixture.status
      : undefined;

  return (
    <PluginDetailView
      leading={<ProviderMark provider={fixture.provider} />}
      title={fixture.title}
      health={health}
      metadata={[fixture.source, `v${fixture.version}`]}
      description={fixture.description}
      enabled={enabled}
      onEnabledChange={setEnabled}
      overflowItems={[
        {
          label: "Reload",
          icon: "ArrowReloadHorizontal",
          onSelect: NOOP,
        },
      ]}
      properties={[
        {
          label: "Agent",
          value: (
            <span className="inline-flex items-center gap-1.5">
              <ProviderMark provider={fixture.provider} className="size-3.5" />
              {PROVIDER_FILTER_LABELS[fixture.provider]}
            </span>
          ),
        },
        { label: "Source", value: fixture.source },
        ...(fixture.statusDetail
          ? [{ label: "Status detail", value: fixture.statusDetail }]
          : []),
        ...fixture.settings,
      ]}
      sections={[
        {
          label: "Capabilities",
          content: (
            <PluginCapabilitiesList capabilities={fixture.capabilities} />
          ),
        },
      ]}
    />
  );
}

function PluginDetail({ selectedId }: { selectedId: string }) {
  const fixture =
    PLUGIN_DETAIL_FIXTURES.find((candidate) => candidate.id === selectedId) ??
    PLUGIN_DETAIL_FIXTURES[0];

  return <PluginDetailContent key={fixture.id} fixture={fixture} />;
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

export const SkillDetailPage: Story<{ example: string }> = ({ example }) => {
  return (
    <PageStory>
      <SkillDetail selectedId={example} />
    </PageStory>
  );
};
SkillDetailPage.args = { example: SKILL_DETAIL_FIXTURES[0].id };
SkillDetailPage.argTypes = {
  example: {
    options: SKILL_DETAIL_FIXTURES.map(({ id }) => id),
    control: {
      type: "select",
      labels: Object.fromEntries(
        SKILL_DETAIL_FIXTURES.map(({ id, exampleLabel }) => [id, exampleLabel]),
      ),
    },
  },
};

export const PluginDetailPage: Story<{ example: string }> = ({ example }) => {
  return (
    <PageStory>
      <PluginDetail selectedId={example} />
    </PageStory>
  );
};
PluginDetailPage.args = { example: PLUGIN_DETAIL_FIXTURES[0].id };
PluginDetailPage.argTypes = {
  example: {
    options: PLUGIN_DETAIL_FIXTURES.map(({ id }) => id),
    control: {
      type: "select",
      labels: Object.fromEntries(
        PLUGIN_DETAIL_FIXTURES.map(({ id, title }) => [id, title]),
      ),
    },
  },
};

export const AutomationDetailPage: Story<{ example: string }> = ({
  example,
}) => {
  return (
    <PageStory>
      <AutomationDetail selectedId={example} />
    </PageStory>
  );
};
AutomationDetailPage.args = { example: AUTOMATION_DETAIL_FIXTURES[0].id };
AutomationDetailPage.argTypes = {
  example: {
    options: AUTOMATION_DETAIL_FIXTURES.map(({ id }) => id),
    control: {
      type: "select",
      labels: Object.fromEntries(
        AUTOMATION_DETAIL_FIXTURES.map(({ id, title }) => [id, title]),
      ),
    },
  },
};

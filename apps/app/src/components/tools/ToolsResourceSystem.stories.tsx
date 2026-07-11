import {
  useEffect,
  useRef,
  useState,
  type ComponentProps,
  type FC,
  type ReactNode,
} from "react";
import type { PromptTextMention } from "@bb/domain";
import { Button } from "@bb/shared-ui/button";
import { COARSE_POINTER_ICON_SIZE_CLASS } from "@bb/shared-ui/coarse-pointer-sizing";
import { Icon, type IconName } from "@bb/shared-ui/icon";
import { Input } from "@bb/shared-ui/input";
import { cn } from "@bb/shared-ui/lib/utils";
import {
  ResourceActionButton,
  ResourceBrowseCard,
  ResourceCardStat,
  ResourceDetailPage,
  ResourceDetailSection,
  ResourceListPanel,
  ResourceLocationMeta,
  ResourceMeta,
  ResourceMultiSelectMenu,
  ResourceBrowseSection,
  ResourceOverviewPage,
  ResourceOverflowMenu,
  ResourceProperty,
  ResourcePropertyList,
  ResourceRow,
  ResourceRowDetailChevron,
  ResourceSortMenu,
  ResourceState,
  ResourceTabDescription,
  ResourceTemplateBrowseCard,
  ResourceToolbar,
} from "@bb/shared-ui/resource-list";
import { Switch } from "@bb/shared-ui/switch";
import { Textarea } from "@bb/shared-ui/textarea";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@bb/shared-ui/tooltip";
import { ClaudeIcon } from "@/components/icons/ClaudeIcon";
import { OpenAiIcon } from "@/components/icons/OpenAiIcon";
import {
  CREATE_PLUGIN_PROMPT,
  CreateWithTemplatesButton,
  getCreateExamples,
  type CreateViaPromptKind,
} from "@/components/create-via-prompt-examples";
import {
  NewThreadPromptBoxUI,
  type NewThreadModeConfig,
  type NewThreadProjectConfig,
} from "@/components/promptbox/NewThreadPromptBox";
import type {
  PromptBoxAction,
  PromptBoxHandle,
} from "@/components/promptbox/PromptBoxInternal";
import { FilePreview } from "@/components/secondary-panel/FilePreview.js";
import { PluginDetailView } from "@/components/tools/PluginDetailView";
import {
  CREATE_AUTOMATION_PROMPT,
  CREATE_SKILL_PROMPT,
} from "@/lib/automation-prompt";
import { ModelPickerStoryQueryProvider } from "../../../.ladle/model-picker-query-provider";
import {
  HOST_IDS,
  PROJECT_IDS,
  STORY_BRANCH_OPTIONS,
  STORY_PROJECTS,
  STORY_PROJECT_SOURCES,
  STORY_WORKTREE_OPTIONS,
  makeAttachmentsConfig,
  makeExecutionControlsProps,
  makeHost,
  makeTypeaheadConfig,
} from "../../../.ladle/story-fixtures";

interface StoryArgType {
  options?: readonly unknown[];
  control?: {
    type: string;
    labels?: Record<string, string>;
  };
}

type Story<Props> = FC<Props> & {
  args?: Partial<Props>;
  argTypes?: Partial<Record<keyof Props, StoryArgType>>;
  storyName?: string;
};

export default {
  title: "Tools/Resource System",
};

const NOOP = () => {};
const SKILLS_SH_URL = "https://www.skills.sh/";

type ProviderId = "bb" | "codex" | "claude-code";
type ProviderFilterId = ProviderId;

interface ResourceListRowFixture {
  id: string;
  title: string;
  description: string;
  manageable?: boolean;
  builtIn?: boolean;
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
        builtIn: true,
      },
      {
        id: "skill-creator",
        title: "skill-creator",
        description: "Create new bb skills and improve existing ones.",
        builtIn: true,
      },
      {
        id: "release-playbook",
        title: "release-playbook",
        description: "Apply the team's reusable release process.",
        manageable: true,
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
  {
    key: "claude-code",
    label: "Claude Code",
    provider: "claude-code",
    rows: [
      {
        id: "moss-notes",
        title: "moss-notes",
        description: "Author and edit Moss notes.",
      },
    ],
  },
];

const REGISTRY_FIRST_PAGE_ROWS: readonly RegistrySourceFixture[] = [
  {
    id: "find-skills",
    title: "find-skills",
    source: "vercel-labs/skills",
    summary: "Discover and install specialized agent skills.",
    installs: "2.4M",
    stars: "25.8K",
  },
  {
    id: "frontend-design",
    title: "frontend-design",
    source: "anthropics/skills",
    summary: "Build distinctive, production-grade frontend interfaces.",
    installs: "649.6K",
    stars: "160.2K",
  },
  {
    id: "vercel-react-best-practices",
    title: "vercel-react-best-practices",
    source: "vercel-labs/agent-skills",
    summary: "Apply React and Next.js performance conventions.",
    installs: "542.2K",
    stars: "28.9K",
  },
  {
    id: "agent-browser",
    title: "agent-browser",
    source: "vercel-labs/agent-browser",
    summary:
      "Automate browser navigation, interaction, screenshots, form filling, and local UI verification from an agent-friendly command-line workflow with reusable browser sessions.",
    installs: "533.3K",
    stars: "38.3K",
  },
  {
    id: "grill-me",
    title: "grill-me",
    source: "mattpocock/skills",
    summary: "Pressure-test your understanding through focused questions.",
    installs: "516.0K",
    stars: "164.9K",
  },
  {
    id: "web-design-guidelines",
    title: "web-design-guidelines",
    source: "vercel-labs/agent-skills",
    summary: "Review web interfaces against practical design guidelines.",
    installs: "454.4K",
    stars: "28.9K",
  },
  {
    id: "microsoft-foundry",
    title: "microsoft-foundry",
    source: "microsoft/azure-skills",
    summary: "Build and operate AI solutions with Microsoft Foundry.",
    installs: "446.6K",
    stars: "1.3K",
  },
  {
    id: "azure-ai",
    title: "azure-ai",
    source: "microsoft/azure-skills",
    summary: "Design and implement AI workloads on Azure.",
    installs: "443.3K",
    stars: "1.3K",
  },
  {
    id: "azure-deploy",
    title: "azure-deploy",
    source: "microsoft/azure-skills",
    summary: "Deploy applications and infrastructure to Azure.",
    installs: "443.0K",
    stars: "1.3K",
  },
  {
    id: "azure-diagnostics",
    title: "azure-diagnostics",
    source: "microsoft/azure-skills",
    summary: "Investigate and resolve Azure service issues.",
    installs: "442.9K",
    stars: "1.3K",
  },
  {
    id: "azure-prepare",
    title: "azure-prepare",
    source: "microsoft/azure-skills",
    summary: "Prepare projects and environments for Azure deployment.",
    installs: "442.8K",
    stars: "1.3K",
  },
  {
    id: "azure-storage",
    title: "azure-storage",
    source: "microsoft/azure-skills",
    summary: "Choose and configure Azure storage services.",
    installs: "442.4K",
    stars: "1.3K",
  },
  {
    id: "azure-validate",
    title: "azure-validate",
    source: "microsoft/azure-skills",
    summary: "Validate Azure projects before deployment.",
    installs: "442.1K",
    stars: "1.3K",
  },
  {
    id: "entra-app-registration",
    title: "entra-app-registration",
    source: "microsoft/azure-skills",
    summary: "Configure Microsoft Entra application registrations.",
    installs: "442.0K",
    stars: "1.3K",
  },
  {
    id: "appinsights-instrumentation",
    title: "appinsights-instrumentation",
    source: "microsoft/azure-skills",
    summary: "Instrument applications with Azure Application Insights.",
    installs: "441.9K",
    stars: "1.3K",
  },
  {
    id: "azure-compliance",
    title: "azure-compliance",
    source: "microsoft/azure-skills",
    summary: "Assess Azure resources against compliance requirements.",
    installs: "441.8K",
    stars: "1.3K",
  },
  {
    id: "azure-resource-lookup",
    title: "azure-resource-lookup",
    source: "microsoft/azure-skills",
    summary: "Find and inspect resources across Azure environments.",
    installs: "441.8K",
    stars: "1.3K",
  },
  {
    id: "azure-rbac",
    title: "azure-rbac",
    source: "microsoft/azure-skills",
    summary: "Design and troubleshoot Azure role-based access control.",
    installs: "441.8K",
    stars: "1.3K",
  },
  {
    id: "azure-aigateway",
    title: "azure-aigateway",
    source: "microsoft/azure-skills",
    summary: "Configure gateway patterns for Azure AI services.",
    installs: "441.7K",
    stars: "1.3K",
  },
  {
    id: "azure-kusto",
    title: "azure-kusto",
    source: "microsoft/azure-skills",
    summary: "Query and analyze telemetry with Azure Data Explorer.",
    installs: "441.7K",
    stars: "1.3K",
  },
  {
    id: "azure-resource-visualizer",
    title: "azure-resource-visualizer",
    source: "microsoft/azure-skills",
    summary: "Visualize relationships between Azure resources.",
    installs: "441.7K",
    stars: "1.3K",
  },
  {
    id: "grill-with-docs",
    title: "grill-with-docs",
    source: "mattpocock/skills",
    summary: "Test your knowledge against a supplied documentation set.",
    installs: "432.2K",
    stars: "164.9K",
  },
  {
    id: "azure-messaging",
    title: "azure-messaging",
    source: "microsoft/azure-skills",
    summary: "Build messaging workflows with Azure services.",
    installs: "431.4K",
    stars: "1.3K",
  },
  {
    id: "improve-codebase-architecture",
    title: "improve-codebase-architecture",
    source: "mattpocock/skills",
    summary: "Identify and execute high-value architectural improvements.",
    installs: "425.5K",
    stars: "164.9K",
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
        manageable: true,
      },
      {
        id: "connect",
        title: "connect",
        description: "Remote access via getbb.app.",
        manageable: true,
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

function ResourceLeading({ row }: { row: ResourceListRowFixture }) {
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
  return row.icon ? (
    <Icon
      name={row.icon}
      className="size-4 text-muted-foreground"
      aria-hidden
    />
  ) : null;
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
  alphaLabel = "Alphabetical",
}: {
  providerFilters: readonly ProviderFilterId[];
  sort: "provider" | "alpha";
  direction: "asc" | "desc";
  availableProviders: ReadonlySet<ProviderId>;
  onProviderFiltersChange: (providers: ProviderFilterId[]) => void;
  onSortChange: (sort: "provider" | "alpha") => void;
  alphaLabel?: string;
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
          { id: "alpha", label: alphaLabel },
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

const CREATE_PROMPT_PREFIX: Record<CreateViaPromptKind, string> = {
  skill: CREATE_SKILL_PROMPT,
  plugin: CREATE_PLUGIN_PROMPT,
  automation: CREATE_AUTOMATION_PROMPT,
};

const CREATE_PROMPT_MODE_CONFIG: NewThreadModeConfig = {
  environment: {
    value: `host:${HOST_IDS.local}:local`,
    onChange: NOOP,
    sources: STORY_PROJECT_SOURCES,
    host: makeHost({ id: HOST_IDS.local }),
    isLocal: true,
  },
  branch: {
    value: null,
    currentBranch: "main",
    isNew: false,
    options: STORY_BRANCH_OPTIONS,
    loading: false,
    currentOptionLabel: "Current: main",
    placeholder: "Current checkout",
    triggerLabel: "Current (main)",
    triggerTitle: "Current: main",
    onChange: NOOP,
    onClear: NOOP,
    onCreate: NOOP,
  },
  worktree: {
    options: STORY_WORKTREE_OPTIONS,
    value: null,
    onChange: NOOP,
  },
  permission: {
    value: "workspace-write",
    options: [
      { value: "full", label: "Full Access", tone: "warning" },
      { value: "workspace-write", label: "Workspace Write" },
      { value: "readonly", label: "Readonly" },
    ],
    onChange: NOOP,
    supported: true,
  },
};

const CREATE_PROMPT_PROJECT_CONFIG: NewThreadProjectConfig = {
  projects: STORY_PROJECTS,
  value: PROJECT_IDS.bb,
  onChange: NOOP,
};

const CREATE_PROMPT_ACTIONS: readonly PromptBoxAction[] = [
  { kind: "skills", text: "/" },
  {
    kind: "plan",
    command: { trigger: "/", name: "plan", trailingText: " " },
    text: "/plan ",
  },
  {
    kind: "goal",
    command: { trigger: "/", name: "goal", trailingText: " " },
    text: "/goal ",
  },
];

function CreatePromptSurface({
  kind,
  initialPrompt,
}: {
  kind: CreateViaPromptKind;
  initialPrompt: string;
}) {
  const [value, setValue] = useState(initialPrompt);
  const [mentionRanges, setMentionRanges] = useState<PromptTextMention[]>([]);
  const promptBoxRef = useRef<PromptBoxHandle>(null);

  useEffect(() => {
    promptBoxRef.current?.focusEnd();
  }, []);

  return (
    <ModelPickerStoryQueryProvider>
      <div className="mx-auto flex min-h-[680px] w-full max-w-[760px] items-center">
        <NewThreadPromptBoxUI
          id={`story-create-${kind}`}
          value={value}
          mentionRanges={mentionRanges}
          onChange={(nextValue, nextMentions) => {
            setValue(nextValue);
            setMentionRanges(nextMentions);
          }}
          onSubmit={NOOP}
          promptBoxRef={promptBoxRef}
          isSubmitting={false}
          disabled={false}
          zenModeStorageKey={`bb.story.tools.create-${kind}`}
          history={{
            currentDraft: {
              text: value,
              mentions: mentionRanges,
              attachments: [],
            },
            entries: [],
            onSelectEntry: NOOP,
          }}
          typeahead={makeTypeaheadConfig()}
          attachments={makeAttachmentsConfig()}
          promptActions={CREATE_PROMPT_ACTIONS}
          modeConfig={CREATE_PROMPT_MODE_CONFIG}
          project={CREATE_PROMPT_PROJECT_CONFIG}
          execution={makeExecutionControlsProps()}
        />
      </div>
    </ModelPickerStoryQueryProvider>
  );
}

function CreateViaPromptStory({
  kind,
  children,
}: {
  kind: CreateViaPromptKind;
  children: (onCreate: (prompt?: string) => void) => ReactNode;
}) {
  const [initialPrompt, setInitialPrompt] = useState<string | null>(null);
  if (initialPrompt !== null) {
    return <CreatePromptSurface kind={kind} initialPrompt={initialPrompt} />;
  }
  return children((prompt) =>
    setInitialPrompt(prompt ?? CREATE_PROMPT_PREFIX[kind]),
  );
}

function ResourceRowsList({
  sections,
  query,
  providerFilters,
  sortMode,
  sortDirection,
  showOpenAction = false,
  showDisabledManageActions = false,
}: {
  sections: readonly ResourceSectionFixture[];
  query: string;
  providerFilters: readonly ProviderFilterId[];
  sortMode: "provider" | "alpha";
  sortDirection: "asc" | "desc";
  showOpenAction?: boolean;
  showDisabledManageActions?: boolean;
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
          leading={<ResourceLeading row={row} />}
          title={row.title}
          description={row.description}
          state={row.state}
          muted={row.muted}
          onOpen={NOOP}
          actions={
            row.manageable || row.builtIn || showDisabledManageActions ? (
              <>
                {row.manageable || row.builtIn || showDisabledManageActions ? (
                  <>
                    <ResourceActionButton
                      label={`Edit ${row.title}`}
                      icon="Edit"
                      disabled={!row.manageable}
                      disabledReason={
                        !row.manageable
                          ? row.builtIn
                            ? "Built-in skill"
                            : row.provider
                              ? `Managed by ${PROVIDER_FILTER_LABELS[row.provider]}`
                              : "Read-only skill"
                          : undefined
                      }
                      onClick={NOOP}
                    />
                    <ResourceActionButton
                      label={`Delete ${row.title}`}
                      icon="Trash2"
                      tone="destructive"
                      disabled={!row.manageable}
                      disabledReason={
                        !row.manageable
                          ? row.builtIn
                            ? "Built-in skill"
                            : row.provider
                              ? `Managed by ${PROVIDER_FILTER_LABELS[row.provider]}`
                              : "Read-only skill"
                          : undefined
                      }
                      onClick={NOOP}
                    />
                  </>
                ) : null}
              </>
            ) : undefined
          }
          trailingVisual={
            showOpenAction ? <ResourceRowDetailChevron /> : undefined
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
        iconClassName="text-success"
        accessibleLabel={`${installs} installs`}
      >
        {installs}
      </ResourceCardStat>
      <ResourceCardStat
        icon="Star"
        iconClassName="fill-attention/20 text-attention"
        accessibleLabel={`${stars} stars`}
      >
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
      className="inline-flex items-center gap-1 rounded-sm text-[11px] text-subtle-foreground/65 hover:text-subtle-foreground/90 hover:underline focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
    >
      <span className="font-mono">skills.sh</span>
    </a>
  );
}

function registryFixtureProvider(row: RegistrySourceFixture): ProviderId {
  return row.source.startsWith("anthropics/") ? "claude-code" : "codex";
}

function StoryInstallButton({
  installed,
  skillName,
  onInstall,
}: {
  installed: boolean;
  skillName: string;
  onInstall: () => void;
}) {
  if (installed) {
    return (
      <span
        aria-label={`Installed ${skillName} as a bb skill`}
        className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md bg-surface-recessed-soft-solid px-2 text-xs text-muted-foreground"
      >
        <Icon name="Download" className="size-3.5 text-success" aria-hidden />
        Installed
      </span>
    );
  }
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className="h-7 bg-transparent px-2 text-xs text-muted-foreground hover:bg-state-hover hover:text-foreground"
      aria-label={`Install ${skillName} as a bb skill`}
      onClick={onInstall}
    >
      <Icon
        name="Download"
        className="size-3.5 text-muted-foreground"
        aria-hidden
      />
      Install
    </Button>
  );
}

function registryBrowseConfig({
  installedSkillIds,
  onInstall,
  onSelect,
  onSeeAll,
}: {
  installedSkillIds: ReadonlySet<string>;
  onInstall: (id: string) => void;
  onSelect: (id: string) => void;
  onSeeAll: () => void;
}): ComponentProps<typeof ResourceBrowseSection> {
  const rows = REGISTRY_FIRST_PAGE_ROWS;
  return {
    icon: "Zap",
    attribution: <SkillsShAttributionLink />,
    onBrowseAll: onSeeAll,
    items: rows.map((row) => ({
      id: row.id,
      content: (
        <ResourceBrowseCard
          title={row.title}
          byline={`by ${row.source}`}
          description={row.summary}
          openLabel={`View details for ${row.title}`}
          onOpen={() => onSelect(row.id)}
          headerAction={
            <StoryInstallButton
              installed={installedSkillIds.has(row.id)}
              skillName={row.title}
              onInstall={() => onInstall(row.id)}
            />
          }
          footerMeta={
            <StorySocialProof installs={row.installs} stars={row.stars} />
          }
        />
      ),
    })),
  };
}

function RegistryBrowseAllSurface({
  installedSkillIds,
  onInstall,
  onSelect,
}: {
  installedSkillIds: ReadonlySet<string>;
  onInstall: (id: string) => void;
  onSelect: (id: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<"installs" | "stars" | "alpha">("installs");
  const [direction, setDirection] = useState<"asc" | "desc">("desc");
  const normalizedQuery = query.trim().toLowerCase();
  const rows = REGISTRY_FIRST_PAGE_ROWS.filter((row) =>
    [row.title, row.source, row.summary]
      .join(" ")
      .toLowerCase()
      .includes(normalizedQuery),
  ).sort((left, right) => {
    const metric = (value: string) => {
      const amount = Number.parseFloat(value);
      return value.endsWith("K") ? amount * 1_000 : amount;
    };
    const base =
      sort === "installs"
        ? metric(left.installs) - metric(right.installs)
        : sort === "stars"
          ? metric(left.stars) - metric(right.stars)
          : left.title.localeCompare(right.title);
    return direction === "asc" ? base : -base;
  });

  function updateSort(nextSort: "installs" | "stars" | "alpha") {
    if (nextSort === sort) {
      setDirection((current) => (current === "asc" ? "desc" : "asc"));
      return;
    }
    setSort(nextSort);
    setDirection(nextSort === "alpha" ? "asc" : "desc");
  }

  return (
    <div className="space-y-4">
      <ResourceTabDescription>
        Browse every skill available from skills.sh and import it as a
        manageable bb user skill.
      </ResourceTabDescription>
      <ResourceToolbar
        searchValue={query}
        searchPlaceholder="Search skills.sh"
        onSearchChange={setQuery}
        controls={
          <ResourceSortMenu
            value={sort}
            direction={direction}
            options={[
              { id: "installs", label: "Install count" },
              { id: "stars", label: "Stars" },
              { id: "alpha", label: "Skill name" },
            ]}
            onChange={(value) =>
              updateSort(value as "installs" | "stars" | "alpha")
            }
          />
        }
      />
      <div className="flex justify-end px-1">
        <SkillsShAttributionLink />
      </div>
      <ResourceListPanel maxHeightClassName="max-h-none">
        {rows.map((row) => (
          <ResourceRow
            key={row.id}
            leading={<ProviderMark provider={registryFixtureProvider(row)} />}
            title={row.title}
            description={
              <span className="inline-flex min-w-0 items-center gap-1.5">
                <span className="shrink-0">by {row.source}</span>
                <span aria-hidden>·</span>
                <span className="truncate">{row.summary}</span>
              </span>
            }
            state={
              <StorySocialProof installs={row.installs} stars={row.stars} />
            }
            onOpen={() => onSelect(row.id)}
            actionsVisibility="always"
            actions={
              <StoryInstallButton
                installed={installedSkillIds.has(row.id)}
                skillName={row.title}
                onInstall={() => onInstall(row.id)}
              />
            }
          />
        ))}
      </ResourceListPanel>
      <div className="flex items-center justify-between px-1 text-xs text-subtle-foreground">
        <span>
          {rows.length === 0 ? 0 : 1}–{rows.length} of {rows.length}
        </span>
        <span>Page 1</span>
      </div>
    </div>
  );
}

function RegistrySkillStoryDetail({
  id,
  installed,
  onBack,
  onInstall,
}: {
  id: string;
  installed: boolean;
  onBack: () => void;
  onInstall: () => void;
}) {
  const row =
    REGISTRY_FIRST_PAGE_ROWS.find((candidate) => candidate.id === id) ??
    REGISTRY_FIRST_PAGE_ROWS[0];
  return (
    <ResourceDetailPage
      back={
        <Button type="button" variant="ghost" size="sm" onClick={onBack}>
          <Icon name="ChevronLeft" aria-hidden />
          Back to skills
        </Button>
      }
      leading={<ProviderMark provider={registryFixtureProvider(row)} />}
      title={row.title}
      info={<StorySocialProof installs={row.installs} stars={row.stars} />}
      metadata={<ResourceMeta items={["skills.sh", row.source]} />}
      description={row.summary}
      modeActions={
        <StoryInstallButton
          installed={installed}
          skillName={row.title}
          onInstall={onInstall}
        />
      }
    >
      <ResourceDetailSection label="Details">
        <ResourcePropertyList>
          <ResourceProperty label="Source">{row.source}</ResourceProperty>
          <ResourceProperty label="Installs">{row.installs}</ResourceProperty>
          <ResourceProperty label="GitHub stars">{row.stars}</ResourceProperty>
          {installed ? (
            <ResourceProperty label="Installed as">
              bb user skill
            </ResourceProperty>
          ) : null}
        </ResourcePropertyList>
      </ResourceDetailSection>
    </ResourceDetailPage>
  );
}

function templateBrowseConfig({
  icon,
  templates,
  onCreate,
}: {
  icon: IconName;
  templates: readonly {
    label: string;
    description: string;
    prompt: string;
  }[];
  onCreate: (prompt: string) => void;
}): ComponentProps<typeof ResourceBrowseSection> {
  return {
    icon,
    onBrowseAll: NOOP,
    items: templates.map((template) => ({
      id: template.label,
      content: (
        <ResourceTemplateBrowseCard
          title={template.label}
          description={template.description}
          onUse={() => onCreate(template.prompt)}
        />
      ),
    })),
  };
}

function AutomationsList({
  query,
  projectFilters,
  sort,
  direction,
}: {
  query: string;
  projectFilters: readonly string[];
  sort: "project" | "alpha";
  direction: "asc" | "desc";
}) {
  const normalizedQuery = query.trim().toLowerCase();
  const rows = AUTOMATION_ROWS.filter((row) =>
    [row.project, row.title, row.description, row.environment?.label]
      .join(" ")
      .toLowerCase()
      .includes(normalizedQuery),
  )
    .filter((row) => {
      if (projectFilters.length === 0) return true;
      return projectFilters.includes(row.project?.toLowerCase() ?? "");
    })
    .sort((left, right) => {
      const base =
        sort === "project"
          ? (left.project ?? "").localeCompare(right.project ?? "") ||
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
          leading={<ResourceLeading row={row} />}
          title={row.title}
          description={
            <ResourceMeta
              items={[
                row.description,
                row.environment ? (
                  <StoryEnvironmentInline display={row.environment} />
                ) : null,
                <ResourceLocationMeta label={row.project ?? "Workspace"} />,
              ]}
            />
          }
          state={row.state}
          selected={row.selected}
          onOpen={NOOP}
          actions={<AutomationRowActions />}
          trailingVisual={<ResourceRowDetailChevron />}
        />
      ))}
    </ResourceListPanel>
  );
}

function SkillsOverviewSurface({
  onCreate,
}: {
  onCreate: (prompt?: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [providerFilters, setProviderFilters] = useState<ProviderFilterId[]>(
    [],
  );
  const [sort, setSort] = useState<"provider" | "alpha">("alpha");
  const [direction, setDirection] = useState<"asc" | "desc">("asc");
  const [showAllBrowse, setShowAllBrowse] = useState(false);
  const [selectedRegistryId, setSelectedRegistryId] = useState<string | null>(
    null,
  );
  const [installedSkillIds, setInstalledSkillIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [installedSkill, setInstalledSkill] =
    useState<ResourceListRowFixture | null>(null);
  const skillSections = installedSkill
    ? SKILL_SECTIONS.map((section) =>
        section.provider === "bb"
          ? {
              ...section,
              rows: [
                {
                  ...installedSkill,
                  provider: "bb" as const,
                  manageable: true,
                },
                ...section.rows,
              ],
            }
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
  function handleRegistryInstall(id: string) {
    setInstalledSkillIds((current) => {
      const next = new Set(current);
      next.add(id);
      return next;
    });
    const row = REGISTRY_FIRST_PAGE_ROWS.find(
      (candidate) => candidate.id === id,
    );
    if (!row) return;
    setInstalledSkill({
      id: `installed-${id}`,
      title: row.title,
      description: row.summary,
    });
  }
  if (selectedRegistryId !== null) {
    return (
      <RegistrySkillStoryDetail
        id={selectedRegistryId}
        installed={installedSkillIds.has(selectedRegistryId)}
        onBack={() => setSelectedRegistryId(null)}
        onInstall={() => handleRegistryInstall(selectedRegistryId)}
      />
    );
  }
  if (showAllBrowse) {
    return (
      <RegistryBrowseAllSurface
        installedSkillIds={installedSkillIds}
        onInstall={handleRegistryInstall}
        onSelect={setSelectedRegistryId}
      />
    );
  }
  return (
    <ResourceOverviewPage
      description="Manage skills from bb and your configured agents. bb skills work across every agent you use in bb."
      browse={registryBrowseConfig({
        installedSkillIds,
        onInstall: handleRegistryInstall,
        onSelect: setSelectedRegistryId,
        onSeeAll: () => setShowAllBrowse(true),
      })}
      installed={{
        headingId: "story-installed-skills",
        label: "Installed skills",
        searchValue: query,
        searchPlaceholder: "Search skills",
        onSearchChange: setQuery,
        controls: (
          <StoryListControls
            providerFilters={providerFilters}
            sort={sort}
            direction={direction}
            availableProviders={providerBuckets}
            onProviderFiltersChange={setProviderFilters}
            onSortChange={updateSort}
            alphaLabel="Skill name"
          />
        ),
        action: (
          <CreateWithTemplatesButton
            kind="skill"
            label="New bb skill"
            onCreate={onCreate}
          />
        ),
        body: (
          <ResourceRowsList
            sections={skillSections}
            query={query}
            providerFilters={providerFilters}
            sortMode={sort}
            sortDirection={direction}
            showOpenAction
            showDisabledManageActions
          />
        ),
      }}
    />
  );
}

function PluginsOverviewSurface({
  onCreate,
}: {
  onCreate: (prompt?: string) => void;
}) {
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
    <ResourceOverviewPage
      description="Manage bb plugins and provider capabilities. Plugins add surfaces, commands, background services, and reusable capabilities."
      browse={templateBrowseConfig({
        icon: "ElectricPlugs",
        templates: getCreateExamples("plugin").examples,
        onCreate,
      })}
      installed={{
        headingId: "story-installed-plugins",
        label: "Installed plugins",
        searchValue: query,
        searchPlaceholder: "Search plugins",
        onSearchChange: setQuery,
        controls: (
          <StoryListControls
            providerFilters={providerFilters}
            sort={sort}
            direction={direction}
            availableProviders={providerBuckets}
            onProviderFiltersChange={setProviderFilters}
            onSortChange={updateSort}
            alphaLabel="Plugin name"
          />
        ),
        action: (
          <CreateWithTemplatesButton
            kind="plugin"
            label="New plugin"
            onCreate={onCreate}
          />
        ),
        body: (
          <ResourceRowsList
            sections={PLUGIN_SECTIONS}
            query={query}
            providerFilters={providerFilters}
            sortMode={sort}
            sortDirection={direction}
            showOpenAction
          />
        ),
      }}
    />
  );
}

function AutomationsOverviewSurface({
  onCreate,
}: {
  onCreate: (prompt?: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [projectFilters, setProjectFilters] = useState<string[]>([]);
  const [sort, setSort] = useState<"project" | "alpha">("alpha");
  const [direction, setDirection] = useState<"asc" | "desc">("asc");
  const projectBucketCount = new Set(
    AUTOMATION_ROWS.map((row) => row.project ?? ""),
  ).size;
  function updateSort(nextSort: "project" | "alpha") {
    if (nextSort === "project" && projectBucketCount <= 1) return;
    if (nextSort === sort) {
      setDirection((current) => (current === "asc" ? "desc" : "asc"));
    } else {
      setSort(nextSort);
      setDirection("asc");
    }
  }
  return (
    <ResourceOverviewPage
      description="Manage scheduled bb work across projects and folders. Automations run recurring or one-time tasks without manual prompting."
      browse={templateBrowseConfig({
        icon: "TimeSchedule",
        templates: getCreateExamples("automation").examples,
        onCreate,
      })}
      installed={{
        headingId: "story-installed-automations",
        label: "Installed automations",
        searchValue: query,
        searchPlaceholder: "Search automations",
        onSearchChange: setQuery,
        controls: (
          <>
            <ResourceMultiSelectMenu
              label="Projects"
              icon="Layers"
              selectedValues={projectFilters}
              options={[
                { id: "bb", label: "bb" },
                { id: "moss", label: "moss" },
              ]}
              onChange={setProjectFilters}
            />
            <ResourceSortMenu
              value={sort}
              direction={direction}
              options={[
                {
                  id: "project",
                  label: "Project",
                  disabled: projectBucketCount <= 1,
                },
                { id: "alpha", label: "Automation name" },
              ]}
              onChange={(value) => updateSort(value as "project" | "alpha")}
            />
          </>
        ),
        action: (
          <CreateWithTemplatesButton
            kind="automation"
            label="New automation"
            onCreate={onCreate}
          />
        ),
        body: (
          <AutomationsList
            query={query}
            projectFilters={projectFilters}
            sort={sort}
            direction={direction}
          />
        ),
      }}
    />
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
              icon: "Play",
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
    >
      <ResourceDetailSection
        label="Configuration"
        actions={
          editing ? (
            <>
              <ResourceActionButton
                label="Cancel editing"
                icon="X"
                onClick={cancelEditing}
              />
              <ResourceActionButton
                label="Save automation"
                icon="Check"
                disabled={!canSave}
                onClick={saveEditing}
              />
            </>
          ) : undefined
        }
      >
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
    id: "release-playbook",
    exampleLabel: "release-playbook · User skill",
    title: "release-playbook",
    provider: "bb",
    status: "User skill",
    statusTone: "success",
    path: "~/.bb/skills/release-playbook/SKILL.md",
    markdown: [
      "---",
      "name: release-playbook",
      "description: Apply the team's reusable release process from final verification through rollout.",
      "---",
      "",
      "# Release playbook",
      "",
      "Use this skill to prepare a release without skipping verification, communication, or cleanup.",
      "",
      "## Before release",
      "",
      "1. Confirm the release branch is current and CI is green.",
      "2. Review user-facing changes and draft concise release notes.",
      "3. Verify migrations, feature flags, and rollback steps.",
      "",
      "## Rollout",
      "",
      "- Ship the smallest safe increment.",
      "- Watch release health and error telemetry.",
      "- Record follow-up work rather than expanding the release scope.",
    ].join("\n"),
  },
  {
    id: "imagegen",
    exampleLabel: "imagegen · Codex",
    title: "imagegen",
    provider: "codex",
    status: "Read-only",
    statusTone: "muted",
    path: "~/.codex/skills/.system/imagegen/SKILL.md",
    markdown: [
      "---",
      "name: imagegen",
      "description: Generate or edit raster images when the task benefits from AI-created bitmap visuals.",
      "---",
      "",
      "# Image generation",
      "",
      "Use image generation for raster assets such as illustrations, textures, mockups, and transparent-background cutouts.",
      "",
      "## Choose the right medium",
      "",
      "- Use image generation for new bitmap artwork or edits to an existing raster image.",
      "- Keep established SVG, icon, and logo systems code-native.",
      "- Prefer HTML and CSS for interface visuals that belong in the product implementation.",
      "",
      "## Editing",
      "",
      "Inspect the source image first, preserve the requested composition, and make only the requested visual changes.",
    ].join("\n"),
  },
  {
    id: "openai-docs",
    exampleLabel: "openai-docs · Codex",
    title: "openai-docs",
    provider: "codex",
    status: "Read-only",
    statusTone: "muted",
    path: "~/.codex/skills/.system/openai-docs/SKILL.md",
    markdown: [
      "---",
      "name: openai-docs",
      "description: Use current official OpenAI documentation for product and API guidance.",
      "---",
      "",
      "# OpenAI documentation",
      "",
      "Use this skill when building with OpenAI products or APIs, choosing a model, or upgrading prompts and integrations.",
      "",
      "## Source policy",
      "",
      "1. Start with the official OpenAI documentation tools.",
      "2. Prefer primary product and API references over third-party summaries.",
      "3. Cite the exact documentation page that supports each time-sensitive claim.",
      "",
      "## Codex questions",
      "",
      "Check the Codex manual first for broad product guidance, then use official documentation for specific current behavior.",
    ].join("\n"),
  },
  {
    id: "moss-notes",
    exampleLabel: "moss-notes · Claude Code",
    title: "moss-notes",
    provider: "claude-code",
    status: "Read-only",
    statusTone: "muted",
    path: "~/.claude/skills/moss-notes/SKILL.md",
    markdown: [
      "---",
      "name: moss-notes",
      "description: Author and edit Moss notes using the app's Markdown conventions and node types.",
      "---",
      "",
      "# Moss notes",
      "",
      "Use this skill when creating or updating notes in Moss, choosing a node type, or preserving Moss-specific syntax.",
      "",
      "## Writing notes",
      "",
      "- Lead with the answer and organize sections from most to least important.",
      "- Keep paragraphs short and choose the representation that best fits the content.",
      "- Preserve Moss links, comments, formulas, and frontmatter when editing existing notes.",
      "",
      "## File location",
      "",
      "Store notes under `~/Moss/Notes/` and use portable Markdown unless a Moss-only node is required.",
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
    <TooltipProvider delayDuration={250}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            aria-label={`Copy skill path: ${path}`}
            onClick={handleCopy}
            className="group -ml-1.5 inline-flex max-w-full cursor-pointer items-center gap-1 rounded-md px-1.5 py-1 text-xs text-subtle-foreground transition-colors hover:bg-state-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          >
            <span className="truncate font-mono">{path}</span>
            <Icon
              name={copied ? "Check" : "Copy"}
              className="size-3 shrink-0 opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
              aria-hidden
            />
          </button>
        </TooltipTrigger>
        <TooltipContent>{copied ? "Copied" : "Copy path"}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
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
            textPreviewKind: "markdown",
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

  const sectionActions = editing ? (
    <>
      <ResourceActionButton
        label="Cancel editing"
        icon="X"
        onClick={() => setEditing(false)}
      />
      <ResourceActionButton
        label="Save skill"
        icon="Check"
        onClick={() => {
          setSavedMarkdown(draft);
          setEditing(false);
        }}
      />
    </>
  ) : undefined;

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
    >
      <ResourceDetailSection label="SKILL.md" actions={sectionActions}>
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
                textPreviewKind: "markdown",
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
          label: "Edit",
          icon: "Edit",
          onSelect: NOOP,
        },
        {
          label: "Reload",
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
      <CreateViaPromptStory kind="skill">
        {(onCreate) => <SkillsOverviewSurface onCreate={onCreate} />}
      </CreateViaPromptStory>
    </PageStory>
  );
}
SkillsOverviewPage.storyName = "skills--overview";

export function PluginsOverviewPage() {
  return (
    <PageStory>
      <CreateViaPromptStory kind="plugin">
        {(onCreate) => <PluginsOverviewSurface onCreate={onCreate} />}
      </CreateViaPromptStory>
    </PageStory>
  );
}

export function AutomationsOverviewPage() {
  return (
    <PageStory>
      <CreateViaPromptStory kind="automation">
        {(onCreate) => <AutomationsOverviewSurface onCreate={onCreate} />}
      </CreateViaPromptStory>
    </PageStory>
  );
}

function InstalledSkillDetailStory({ id }: { id: string }) {
  return (
    <PageStory>
      <SkillDetail selectedId={id} />
    </PageStory>
  );
}

function RegistrySkillDetailStory({ id }: { id: string }) {
  return (
    <PageStory>
      <RegistrySkillStoryDetail
        id={id}
        installed={false}
        onBack={NOOP}
        onInstall={NOOP}
      />
    </PageStory>
  );
}

export function BbCliSkillDetailPage() {
  return <InstalledSkillDetailStory id="bb-cli" />;
}
BbCliSkillDetailPage.storyName = "skills--overview--installed--bb-cli";

export function SkillCreatorSkillDetailPage() {
  return <InstalledSkillDetailStory id="skill-creator" />;
}
SkillCreatorSkillDetailPage.storyName =
  "skills--overview--installed--skill-creator";

export function ReleasePlaybookSkillDetailPage() {
  return <InstalledSkillDetailStory id="release-playbook" />;
}
ReleasePlaybookSkillDetailPage.storyName =
  "skills--overview--installed--release-playbook";

export function ImagegenSkillDetailPage() {
  return <InstalledSkillDetailStory id="imagegen" />;
}
ImagegenSkillDetailPage.storyName = "skills--overview--installed--imagegen";

export function OpenAiDocsSkillDetailPage() {
  return <InstalledSkillDetailStory id="openai-docs" />;
}
OpenAiDocsSkillDetailPage.storyName =
  "skills--overview--installed--openai-docs";

export function MossNotesSkillDetailPage() {
  return <InstalledSkillDetailStory id="moss-notes" />;
}
MossNotesSkillDetailPage.storyName = "skills--overview--installed--moss-notes";

export function FindSkillsRegistrySkillDetailPage() {
  return <RegistrySkillDetailStory id="find-skills" />;
}
FindSkillsRegistrySkillDetailPage.storyName =
  "skills--overview--browse--find-skills";

export function FrontendDesignRegistrySkillDetailPage() {
  return <RegistrySkillDetailStory id="frontend-design" />;
}
FrontendDesignRegistrySkillDetailPage.storyName =
  "skills--overview--browse--frontend-design";

export function VercelReactBestPracticesRegistrySkillDetailPage() {
  return <RegistrySkillDetailStory id="vercel-react-best-practices" />;
}
VercelReactBestPracticesRegistrySkillDetailPage.storyName =
  "skills--overview--browse--vercel-react-best-practices";

export function AgentBrowserRegistrySkillDetailPage() {
  return <RegistrySkillDetailStory id="agent-browser" />;
}
AgentBrowserRegistrySkillDetailPage.storyName =
  "skills--overview--browse--agent-browser";

export const SkillDetailPage: Story<{ example: string }> = ({ example }) => {
  return (
    <PageStory>
      <SkillDetail selectedId={example} />
    </PageStory>
  );
};
SkillDetailPage.args = { example: SKILL_DETAIL_FIXTURES[0].id };
SkillDetailPage.storyName = "skills--overview--detail examples";
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

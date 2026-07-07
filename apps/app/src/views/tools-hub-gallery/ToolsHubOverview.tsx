import { type ReactNode } from "react";
import { cn } from "@bb/shared-ui/lib/utils";
import { Button } from "@bb/shared-ui/button";
import { Card } from "@bb/shared-ui/card";
import { EmptyStatePanel } from "@bb/shared-ui/empty-state";
import { Icon, type IconName } from "@bb/shared-ui/icon";
import { Skeleton } from "@bb/shared-ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@bb/shared-ui/tabs";
import {
  StatusDot,
  ToolCard,
  ToolChip,
  ToolKindAccentStyles,
  type ChipTone,
} from "./ToolCard";
import type {
  ToolAutomation,
  ToolFilter,
  ToolPlugin,
  ToolSkill,
  ToolsOverviewState,
} from "./types";

// ---------------------------------------------------------------------------
// Thin presentational scaffolding (grid, filter bar, group header) — the only
// new low-level markup. Everything visible is a shared-ui component or a real
// theme token; kinds are separated by full borders, surfaces, and spacing.
// ---------------------------------------------------------------------------

function ToolGrid({ children }: { children: ReactNode }) {
  return (
    <div className="grid gap-3.5 [grid-template-columns:repeat(auto-fill,minmax(min(260px,100%),1fr))]">
      {children}
    </div>
  );
}

interface GroupHeaderProps {
  leading: ReactNode;
  label: string;
  meta?: string;
  trailing?: ReactNode;
}

function GroupHeader({ leading, label, meta, trailing }: GroupHeaderProps) {
  return (
    <div className="mt-4 mb-2 flex items-center gap-2 px-0.5 text-xs text-muted-foreground">
      {leading}
      <span className="font-medium text-foreground">{label}</span>
      {meta ? <span>{meta}</span> : null}
      <span className="flex-1" />
      {trailing}
    </div>
  );
}

function ViewAllButton({
  count,
  onClick,
}: {
  count: number;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
    >
      View all {count}
      <Icon name="ChevronRight" aria-hidden="true" className="size-3.5" />
    </button>
  );
}

const FILTER_TABS: { value: ToolFilter; label: string; icon: IconName }[] = [
  { value: "all", label: "All", icon: "GridView" },
  { value: "skill", label: "Skills", icon: "Zap" },
  { value: "automation", label: "Automations", icon: "Schedule" },
  { value: "plugin", label: "Plugins", icon: "Plug" },
];

function FilterBar({
  filter,
  onFilterChange,
  counts,
}: {
  filter: ToolFilter;
  onFilterChange: (filter: ToolFilter) => void;
  counts: Record<ToolFilter, number>;
}) {
  return (
    <TabsList className="h-auto gap-0.5 p-0.5">
      {FILTER_TABS.map((tab) => (
        <TabsTrigger key={tab.value} value={tab.value} className="gap-1.5 px-3">
          <Icon name={tab.icon} aria-hidden="true" className="size-4" />
          {tab.label}
          <span className="text-2xs text-subtle-foreground">
            {counts[tab.value]}
          </span>
        </TabsTrigger>
      ))}
    </TabsList>
  );
}

function SearchField() {
  return (
    <div className="flex h-8 w-[200px] items-center gap-2 rounded-md border border-input bg-background px-2.5">
      <Icon
        name="Search"
        aria-hidden="true"
        className="size-3.5 text-muted-foreground"
      />
      <input
        aria-label="Search Tools"
        placeholder="Search Tools"
        className="min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Ready-state bodies, one per filter.
// ---------------------------------------------------------------------------

function AllMix({
  skills,
  automations,
  plugins,
  onFilterChange,
}: {
  skills: readonly ToolSkill[];
  automations: readonly ToolAutomation[];
  plugins: readonly ToolPlugin[];
  onFilterChange: (filter: ToolFilter) => void;
}) {
  return (
    <div>
      <GroupHeader
        leading={<ToolChip icon="Zap" tone="skill" size="sm" />}
        label="Skills"
        trailing={
          <ViewAllButton
            count={skills.length}
            onClick={() => onFilterChange("skill")}
          />
        }
      />
      <ToolGrid>
        {skills.slice(0, 3).map((skill) => (
          <ToolCard key={skill.id} kind="skill" skill={skill} />
        ))}
      </ToolGrid>

      <GroupHeader
        leading={<ToolChip icon="Schedule" tone="automation" size="sm" />}
        label="Automations"
        trailing={
          <ViewAllButton
            count={automations.length}
            onClick={() => onFilterChange("automation")}
          />
        }
      />
      <ToolGrid>
        {automations.slice(0, 3).map((automation) => (
          <ToolCard
            key={automation.id}
            kind="automation"
            automation={automation}
          />
        ))}
      </ToolGrid>

      <GroupHeader
        leading={<ToolChip icon="Plug" tone="plugin" size="sm" />}
        label="Plugins"
        trailing={
          <ViewAllButton
            count={plugins.length}
            onClick={() => onFilterChange("plugin")}
          />
        }
      />
      <ToolGrid>
        {plugins.slice(0, 3).map((plugin) => (
          <ToolCard key={plugin.id} kind="plugin" plugin={plugin} />
        ))}
      </ToolGrid>
    </div>
  );
}

function SkillsView({ skills }: { skills: readonly ToolSkill[] }) {
  const bb = skills.filter((skill) => skill.provider === "bb");
  const others = skills.filter((skill) => skill.provider !== "bb");
  return (
    <div>
      <GroupHeader
        leading={<ToolChip icon="GridView" tone="neutral" size="sm" />}
        label="bb"
        trailing={<span>{bb.length}</span>}
      />
      <ToolGrid>
        {bb.map((skill) => (
          <ToolCard key={skill.id} kind="skill" skill={skill} />
        ))}
      </ToolGrid>

      <GroupHeader
        leading={<ToolChip icon="Code" tone="neutral" size="sm" />}
        label="Claude Code"
        trailing={<span>{others.length}</span>}
      />
      <ToolGrid>
        {others.map((skill) => (
          <ToolCard key={skill.id} kind="skill" skill={skill} />
        ))}
      </ToolGrid>
    </div>
  );
}

function AutomationsView({
  automations,
}: {
  automations: readonly ToolAutomation[];
}) {
  const active = automations.filter((automation) => automation.enabled);
  const paused = automations.filter((automation) => !automation.enabled);
  return (
    <div>
      <GroupHeader
        leading={<StatusDot tone="success" />}
        label="Active"
        trailing={<span>{active.length}</span>}
      />
      <ToolGrid>
        {active.map((automation) => (
          <ToolCard
            key={automation.id}
            kind="automation"
            automation={automation}
          />
        ))}
      </ToolGrid>

      <GroupHeader
        leading={<StatusDot tone="muted" />}
        label="Paused"
        trailing={<span>{paused.length}</span>}
      />
      <ToolGrid>
        {paused.map((automation) => (
          <ToolCard
            key={automation.id}
            kind="automation"
            automation={automation}
          />
        ))}
      </ToolGrid>
    </div>
  );
}

function PluginsView({ plugins }: { plugins: readonly ToolPlugin[] }) {
  return (
    <ToolGrid>
      {plugins.map((plugin) => (
        <ToolCard key={plugin.id} kind="plugin" plugin={plugin} />
      ))}
    </ToolGrid>
  );
}

// ---------------------------------------------------------------------------
// Non-ready states.
// ---------------------------------------------------------------------------

function SkeletonCard() {
  return (
    <Card className="flex flex-col p-3.5">
      <div className="mb-2.5 flex gap-2.5">
        <Skeleton className="size-7 rounded-md" />
        <div className="flex-1 space-y-1.5">
          <Skeleton className="h-2.5 w-3/5" />
          <Skeleton className="h-2 w-2/5" />
        </div>
      </div>
      <Skeleton className="h-2 w-full" />
      <Skeleton className="mt-1.5 h-2 w-4/5" />
    </Card>
  );
}

function LoadingBody() {
  return (
    <ToolGrid>
      {Array.from({ length: 6 }, (_, index) => (
        <SkeletonCard key={index} />
      ))}
    </ToolGrid>
  );
}

interface StatePanelProps {
  chip: ReactNode;
  title: string;
  body: string;
  action: ReactNode;
  alert?: boolean;
}

function StatePanel({ chip, title, body, action, alert = false }: StatePanelProps) {
  return (
    <EmptyStatePanel
      role={alert ? "alert" : undefined}
      className={cn(
        "flex flex-col items-center gap-2.5 px-5 py-8",
        alert && "border-solid border-destructive/40",
      )}
    >
      {chip}
      <div>
        <div className="text-sm font-medium text-foreground">{title}</div>
        <div className="mt-0.5">{body}</div>
      </div>
      {action}
    </EmptyStatePanel>
  );
}

function BigChip({
  icon,
  tone,
}: {
  icon: IconName;
  tone: ChipTone | "destructive";
}) {
  if (tone === "destructive") {
    return (
      <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-md bg-surface-recessed-solid text-destructive-text">
        <Icon name={icon} aria-hidden="true" className="size-5" />
      </span>
    );
  }
  return <ToolChip icon={icon} tone={tone} size="lg" />;
}

function EmptyBody() {
  return (
    <StatePanel
      chip={<BigChip icon="Zap" tone="skill" />}
      title="No skills yet"
      body="Skills are reusable methods your agents can invoke."
      action={
        <Button size="sm">
          <Icon name="MessageSquarePlus" aria-hidden="true" />
          Create a skill
        </Button>
      }
    />
  );
}

function ErrorBody() {
  return (
    <StatePanel
      alert
      chip={<BigChip icon="AlertCircle" tone="destructive" />}
      title="Couldn't load Tools"
      body="The host daemon didn't respond. Your Tools are unchanged."
      action={
        <Button size="sm" variant="outline">
          <Icon name="RotateCcw" aria-hidden="true" />
          Retry
        </Button>
      }
    />
  );
}

function NoResultsBody() {
  return (
    <StatePanel
      chip={<BigChip icon="Search" tone="neutral" />}
      title={'No Tools match "webhook"'}
      body="Try a different term, or clear the search."
      action={
        <Button size="sm" variant="outline">
          Clear search
        </Button>
      }
    />
  );
}

// ---------------------------------------------------------------------------
// ToolsHubOverview — filter bar + body. Presentational and controlled: the
// caller owns the active filter (so "View all" and the tabs share one source
// of truth) and picks the render state.
// ---------------------------------------------------------------------------

export interface ToolsHubOverviewProps {
  skills: readonly ToolSkill[];
  automations: readonly ToolAutomation[];
  plugins: readonly ToolPlugin[];
  filter: ToolFilter;
  onFilterChange: (filter: ToolFilter) => void;
  state?: ToolsOverviewState;
}

export function ToolsHubOverview({
  skills,
  automations,
  plugins,
  filter,
  onFilterChange,
  state = "ready",
}: ToolsHubOverviewProps) {
  const counts: Record<ToolFilter, number> = {
    all: skills.length + automations.length + plugins.length,
    skill: skills.length,
    automation: automations.length,
    plugin: plugins.length,
  };

  return (
    <div className="flex flex-col overflow-hidden rounded-xl border border-border bg-background">
      <ToolKindAccentStyles />
      <Tabs
        value={filter}
        onValueChange={(value) => onFilterChange(value as ToolFilter)}
      >
        <div className="flex items-center gap-3 px-5 py-3.5">
          <FilterBar
            filter={filter}
            onFilterChange={onFilterChange}
            counts={counts}
          />
          <span className="flex-1" />
          <SearchField />
          <Button size="sm">
            <Icon name="Plus" aria-hidden="true" />
            New
            <Icon name="ChevronDown" aria-hidden="true" className="size-3.5" />
          </Button>
        </div>
        <div className="mx-auto max-h-[560px] overflow-auto px-5 pt-2 pb-7">
          <div className="mx-auto max-w-[920px]">
            {state === "loading" ? <LoadingBody /> : null}
            {state === "empty" ? <EmptyBody /> : null}
            {state === "error" ? <ErrorBody /> : null}
            {state === "no-results" ? <NoResultsBody /> : null}
            {state === "ready" && filter === "all" ? (
              <AllMix
                skills={skills}
                automations={automations}
                plugins={plugins}
                onFilterChange={onFilterChange}
              />
            ) : null}
            {state === "ready" && filter === "skill" ? (
              <SkillsView skills={skills} />
            ) : null}
            {state === "ready" && filter === "automation" ? (
              <AutomationsView automations={automations} />
            ) : null}
            {state === "ready" && filter === "plugin" ? (
              <PluginsView plugins={plugins} />
            ) : null}
          </div>
        </div>
      </Tabs>
    </div>
  );
}

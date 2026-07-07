import { useState, type ReactNode } from "react";
import {
  AUTOMATIONS,
  DEEP_RESEARCH_DETAIL,
  NIGHTLY_PR_DETAIL,
  PLUGINS,
  SIMPLE_NOTES_DETAIL,
  SKILLS,
} from "./fixtures";
import { ToolDetail } from "./ToolDetail";
import { ToolsHubOverview } from "./ToolsHubOverview";
import type { ToolFilter, ToolsOverviewState } from "./types";

/**
 * Tools Hub — Direction A (Marketplace Gallery), rendered in bb's real design
 * system. A segmented filter bar (All · Skills · Automations · Plugins) over a
 * responsive card grid, with full-page detail scaffolds and the four load
 * states. The filter bar is interactive across every overview story — click a
 * tab or a section's "View all" to switch kinds.
 */
export default {
  title: "views/Tools Hub — Direction A",
};

function Stage({ children }: { children: ReactNode }) {
  return <div className="min-h-screen bg-background p-6">{children}</div>;
}

/** Controlled overview: owns the active filter so the tabs + "View all" links
 *  drive one source of truth. */
function OverviewStory({
  initialFilter,
  state = "ready",
}: {
  initialFilter: ToolFilter;
  state?: ToolsOverviewState;
}) {
  const [filter, setFilter] = useState<ToolFilter>(initialFilter);
  return (
    <Stage>
      <ToolsHubOverview
        skills={SKILLS}
        automations={AUTOMATIONS}
        plugins={PLUGINS}
        filter={filter}
        onFilterChange={setFilter}
        state={state}
      />
    </Stage>
  );
}

// --- Overview: the mixed hub + the three kind filters ----------------------

export function AllHub() {
  return <OverviewStory initialFilter="all" />;
}

export function SkillsFilter() {
  return <OverviewStory initialFilter="skill" />;
}

export function AutomationsFilter() {
  return <OverviewStory initialFilter="automation" />;
}

export function PluginsFilter() {
  return <OverviewStory initialFilter="plugin" />;
}

// --- The four load states --------------------------------------------------

export function Loading() {
  return <OverviewStory initialFilter="all" state="loading" />;
}

export function Empty() {
  return <OverviewStory initialFilter="skill" state="empty" />;
}

export function Error() {
  return <OverviewStory initialFilter="all" state="error" />;
}

export function NoResults() {
  return <OverviewStory initialFilter="all" state="no-results" />;
}

// --- Detail pages ----------------------------------------------------------

export function SkillDetail() {
  const skill = SKILLS.find((entry) => entry.id === "deep-research") ?? SKILLS[0];
  return (
    <Stage>
      <ToolDetail kind="skill" skill={skill} detail={DEEP_RESEARCH_DETAIL} />
    </Stage>
  );
}

export function AutomationDetail() {
  const automation =
    AUTOMATIONS.find((entry) => entry.id === "nightly-pr-babysit") ??
    AUTOMATIONS[0];
  return (
    <Stage>
      <ToolDetail
        kind="automation"
        automation={automation}
        detail={NIGHTLY_PR_DETAIL}
      />
    </Stage>
  );
}

export function PluginDetail() {
  const plugin = PLUGINS.find((entry) => entry.id === "simple-notes") ?? PLUGINS[0];
  return (
    <Stage>
      <ToolDetail kind="plugin" plugin={plugin} detail={SIMPLE_NOTES_DETAIL} />
    </Stage>
  );
}

import { useCallback, useState, type ReactNode } from "react";
import type { ThreadListEntry } from "@bb/domain";
import type { ProjectResponse } from "@bb/server-contract";
import {
  BRANCH_NAMES,
  HOST_IDS,
  PROJECT_IDS,
  makeProject as makeSharedProject,
  makeThreadListEntry,
} from "../../../.ladle/story-fixtures";
import { SidebarStickyStack } from "@/components/ui/sidebar.js";
import { ProjectActionsProvider } from "@/components/project/ProjectActionsProvider";
import { ThreadActionsProvider } from "@/components/thread/ThreadActionsProvider";
import { ProjectListShell } from "./ProjectList";
import type { ProjectThreadListState } from "./ProjectRow";
import {
  ProjectListProjects,
  type ProjectListRowModel,
} from "./ProjectListProjects";
import { StoryCard, StoryRow } from "../../../.ladle/story-card";

export default {
  title: "sidebar/Projects",
};

// Caps at the production sidebar max (460px) but shrinks with its container so
// truncation behavior is visible at any container width. Provides the outer
// sidebar frame only; each story decides whether to use ProjectListShell (for
// full-sidebar shots) or a bare SidebarStickyStack (for isolated ProjectRow
// demos).
function SidebarStage({ children }: { children: ReactNode }) {
  return (
    <ProjectActionsProvider>
      <ThreadActionsProvider>
        <div className="w-full max-w-[460px] min-w-0 rounded-md bg-sidebar p-2 text-sidebar-foreground">
          {children}
        </div>
      </ThreadActionsProvider>
    </ProjectActionsProvider>
  );
}

// Wrap the shared builders for slightly different defaults the sidebar wants
// (a different demo project id; ThreadListEntry instead of Thread).
const makeProject = (overrides: Partial<ProjectResponse> = {}) =>
  makeSharedProject({ id: PROJECT_IDS.bb, name: "bb", ...overrides });

const makeThread = (overrides: Partial<ThreadListEntry> = {}) =>
  makeThreadListEntry({ id: "thr_default", ...overrides });

type ToggleStoryCollapsedId = (id: string) => void;

function toggleStoryCollapsedId(
  current: ReadonlySet<string>,
  id: string,
): Set<string> {
  const next = new Set(current);
  if (next.has(id)) {
    next.delete(id);
  } else {
    next.add(id);
  }
  return next;
}

interface StoryProjectRow {
  project?: ProjectResponse;
  threadListState: ProjectThreadListState;
  isActive?: boolean;
  isLocalPathInvalid?: boolean;
  initiallyCollapsed?: boolean;
}

interface InteractiveProjectListArgs {
  rows: StoryProjectRow[];
  initialCollapsedEnvironmentIds?: ReadonlySet<string>;
}

// Owns the list-level collapse state that jotai atoms own in production
// (ProjectList) so the chevrons in stories actually toggle, then renders the
// real ProjectListProjects — the same component the live sidebar uses.
function InteractiveProjectList({
  rows,
  initialCollapsedEnvironmentIds,
}: InteractiveProjectListArgs) {
  const resolvedRows: ProjectListRowModel[] = rows.map((row) => ({
    project: row.project ?? makeProject(),
    threadListState: row.threadListState,
    isActive: row.isActive ?? false,
    isLocalPathInvalid: row.isLocalPathInvalid ?? false,
  }));
  const [collapsedProjectIds, setCollapsedProjectIds] = useState<Set<string>>(
    () =>
      new Set(
        rows.flatMap((row, index) =>
          row.initiallyCollapsed ? [resolvedRows[index].project.id] : [],
        ),
      ),
  );
  const [collapsedEnvironmentIds, setCollapsedEnvironmentIds] = useState<
    Set<string>
  >(() => new Set(initialCollapsedEnvironmentIds ?? []));
  const onToggleProjectCollapsed = useCallback<ToggleStoryCollapsedId>((id) => {
    setCollapsedProjectIds((current) => toggleStoryCollapsedId(current, id));
  }, []);
  const onToggleEnvironmentCollapsed = useCallback<ToggleStoryCollapsedId>(
    (id) => {
      setCollapsedEnvironmentIds((current) =>
        toggleStoryCollapsedId(current, id),
      );
    },
    [],
  );
  return (
    <ProjectListProjects
      status="ready"
      rows={resolvedRows}
      collapsedProjectIds={collapsedProjectIds}
      collapsedEnvironmentIds={collapsedEnvironmentIds}
      onCreateProjectThread={noop}
      onToggleProjectCollapsed={onToggleProjectCollapsed}
      onToggleEnvironmentCollapsed={onToggleEnvironmentCollapsed}
    />
  );
}

interface SingleProjectArgs {
  project?: ProjectResponse;
  threadListState: ProjectThreadListState;
  initialCollapsed?: boolean;
  initialCollapsedEnvironmentIds?: ReadonlySet<string>;
  isActive?: boolean;
  isLocalPathInvalid?: boolean;
}

// Isolated single-project demos: no "Projects" label — just the minimum
// sticky-stack context the row depends on.
function singleProject({
  project,
  threadListState,
  initialCollapsed,
  initialCollapsedEnvironmentIds,
  isActive,
  isLocalPathInvalid,
}: SingleProjectArgs) {
  return (
    <SidebarStage>
      <SidebarStickyStack>
        <InteractiveProjectList
          rows={[
            {
              project,
              threadListState,
              isActive,
              isLocalPathInvalid,
              initiallyCollapsed: initialCollapsed,
            },
          ]}
          initialCollapsedEnvironmentIds={initialCollapsedEnvironmentIds}
        />
      </SidebarStickyStack>
    </SidebarStage>
  );
}

const idleThread = makeThread({
  id: "thr_idle",
  title: "Audit and reduce codebase cognitive load",
  titleFallback: "Audit and reduce codebase cognitive load",
});
const busyThread = makeThread({
  id: "thr_busy",
  title: "Implement timeline pagination v2",
  titleFallback: "Implement timeline pagination v2",
  status: "active",
  runtime: {
    displayStatus: "active",
    hostReconnectGraceExpiresAt: null,
  },
});
const pendingThread = makeThread({
  id: "thr_pending",
  title: "Diagnose Claude CLI auth path",
  titleFallback: "Diagnose Claude CLI auth path",
  hasPendingInteraction: true,
});
const rootThread = makeThread({
  id: "thr_root",
  title: "Stabilize Pnpm Dev Environment",
  titleFallback: "Stabilize Pnpm Dev Environment",
  environmentHostId: HOST_IDS.local,
  environmentBranchName: BRANCH_NAMES.default,
  environmentWorkspaceDisplayKind: "managed-worktree",
});
const sharedWorktreeThreadA = makeThread({
  id: "thr_shared_wt_a",
  title: "Refactor timeline row types",
  titleFallback: "Refactor timeline row types",
  environmentId: "env_shared_worktree",
  environmentHostId: HOST_IDS.local,
  environmentBranchName: "bb/set-default-tab-for-panel-thr_vnj2qze4fg",
  environmentWorkspaceDisplayKind: "managed-worktree",
});
const sharedWorktreeThreadB = makeThread({
  id: "thr_shared_wt_b",
  title: "Add story for env-grouped sidebar",
  titleFallback: "Add story for env-grouped sidebar",
  environmentId: "env_shared_worktree",
  environmentHostId: HOST_IDS.local,
  environmentBranchName: "bb/set-default-tab-for-panel-thr_vnj2qze4fg",
  environmentWorkspaceDisplayKind: "managed-worktree",
});
const planningThread = makeThread({
  id: "thr_planning",
  title: "Frontend Planning",
  titleFallback: "Frontend Planning",
});
const relatedThreadA = makeThread({
  id: "thr_related_a",
  title: "Update Timeline Row Types",
  titleFallback: "Update Timeline Row Types",
});
const relatedThreadB = makeThread({
  id: "thr_related_b",
  title: "Fix Timeline Pagination Bugs",
  titleFallback: "Fix Timeline Pagination Bugs",
  status: "active",
  runtime: {
    displayStatus: "active",
    hostReconnectGraceExpiresAt: null,
  },
});
const deepRootThread = makeThread({
  id: "thr_deep_root",
  title: "Prototype Planning",
  titleFallback: "Prototype Planning",
});
const deepIntermediateThread = makeThread({
  id: "thr_deep_intermediate",
  title: "Sidebar Planning Thread",
  titleFallback: "Sidebar Planning Thread",
});
const deepRelatedThread = makeThread({
  id: "thr_deep_related",
  title: "Follow-up Workstream",
  titleFallback: "Follow-up Workstream",
});
const deepNestedThread = makeThread({
  id: "thr_deep_nested",
  title: "Nested Marker",
  titleFallback: "Nested Marker",
});
const deepNestedExtraThread = makeThread({
  id: "thr_deep_nested_extra",
  title: "Beyond The Sticky Cap",
  titleFallback: "Beyond The Sticky Cap",
});
const deepWorktreeA = makeThread({
  id: "thr_deep_worktree_a",
  title: "Worktree Thread A",
  titleFallback: "Worktree Thread A",
  environmentId: "env_deep_worktree",
  environmentHostId: HOST_IDS.local,
  environmentBranchName: "bb/sidebar-grouping-story",
  environmentWorkspaceDisplayKind: "managed-worktree",
});
const deepWorktreeB = makeThread({
  id: "thr_deep_worktree_b",
  title: "Worktree Thread B",
  titleFallback: "Worktree Thread B",
  environmentId: "env_deep_worktree",
  environmentHostId: HOST_IDS.local,
  environmentBranchName: "bb/sidebar-grouping-story",
  environmentWorkspaceDisplayKind: "managed-worktree",
  hasPendingInteraction: true,
});

const multipleProjects: StoryProjectRow[] = [
  {
    project: makeProject({ id: "proj_bb", name: "bb" }),
    isActive: true,
    threadListState: {
      status: "ready",
      threads: [
        { ...rootThread, projectId: "proj_bb" },
        { ...planningThread, projectId: "proj_bb" },
        { ...relatedThreadA, projectId: "proj_bb" },
        { ...relatedThreadB, projectId: "proj_bb" },
        { ...busyThread, projectId: "proj_bb" },
        { ...pendingThread, projectId: "proj_bb" },
      ],
    },
  },
  {
    project: makeProject({
      id: "proj_pierre",
      name: "pierre — long project name that should truncate cleanly",
    }),
    initiallyCollapsed: true,
    threadListState: {
      status: "ready",
      threads: [{ ...idleThread, projectId: "proj_pierre" }],
    },
  },
  {
    project: makeProject({ id: "proj_ingest", name: "ingest-pipeline" }),
    threadListState: {
      status: "ready",
      threads: [
        { ...idleThread, id: "thr_ingest_1", projectId: "proj_ingest" },
        { ...idleThread, id: "thr_ingest_2", projectId: "proj_ingest" },
      ],
    },
  },
  {
    project: makeProject({ id: "proj_empty", name: "fresh-experiment" }),
    threadListState: { status: "ready", threads: [] },
  },
];

export function Overview() {
  return (
    <StoryCard>
      <StoryRow label="ready, no threads" hint='empty state: "No threads"'>
        {singleProject({
          threadListState: { status: "ready", threads: [] },
        })}
      </StoryRow>
      <StoryRow
        label="unavailable"
        hint="thread query failed (e.g., server disconnected)"
      >
        {singleProject({ threadListState: { status: "unavailable" } })}
      </StoryRow>
      <StoryRow
        label="starts collapsed"
        hint="children hidden by default — click the folder to expand"
      >
        {singleProject({
          initialCollapsed: true,
          threadListState: {
            status: "ready",
            threads: [idleThread],
          },
        })}
      </StoryRow>
      <StoryRow
        label="active project route"
        hint="header has the selected sidebar-border background"
      >
        {singleProject({
          isActive: true,
          threadListState: { status: "ready", threads: [] },
        })}
      </StoryRow>
      <StoryRow
        label="local path missing"
        hint="warning triangle navigates to project settings to repair"
      >
        {singleProject({
          isLocalPathInvalid: true,
          threadListState: { status: "ready", threads: [idleThread] },
        })}
      </StoryRow>
      <StoryRow
        label="multiple threads"
        hint="ProjectRow renders project threads as a flat ordered list"
      >
        {singleProject({
          threadListState: {
            status: "ready",
            threads: [planningThread, relatedThreadA, relatedThreadB, idleThread],
          },
        })}
      </StoryRow>
      <StoryRow
        label="large project with worktree group"
        hint="worktree grouping stays visible inside a long flat thread list"
      >
        {singleProject({
          threadListState: {
            status: "ready",
            threads: [
              deepRootThread,
              deepIntermediateThread,
              deepRelatedThread,
              deepNestedThread,
              deepNestedExtraThread,
              deepWorktreeA,
              deepWorktreeB,
            ],
          },
        })}
      </StoryRow>
      <StoryRow
        label="environment group"
        hint="two root threads sharing one worktree environment — grouped under a worktree header that surfaces the branch"
      >
        {singleProject({
          threadListState: {
            status: "ready",
            threads: [sharedWorktreeThreadA, sharedWorktreeThreadB],
          },
        })}
      </StoryRow>
      <StoryRow
        label="environment starts collapsed"
        hint="worktree header remains visible while grouped threads are hidden"
      >
        {singleProject({
          initialCollapsedEnvironmentIds: new Set(["env_shared_worktree"]),
          threadListState: {
            status: "ready",
            threads: [sharedWorktreeThreadA, sharedWorktreeThreadB],
          },
        })}
      </StoryRow>
      <StoryRow
        label="collapsed worktree — grouped thread working"
        hint="trailing slot shows the busy spinner when a hidden grouped thread is working"
      >
        {singleProject({
          initialCollapsedEnvironmentIds: new Set(["env_collapsed_busy"]),
          threadListState: {
            status: "ready",
            threads: [
              {
                ...sharedWorktreeThreadA,
                environmentId: "env_collapsed_busy",
                status: "active",
                runtime: {
                  displayStatus: "active",
                  hostReconnectGraceExpiresAt: null,
                },
              },
              { ...sharedWorktreeThreadB, environmentId: "env_collapsed_busy" },
            ],
          },
        })}
      </StoryRow>
      <StoryRow
        label="collapsed worktree — unread grouped thread"
        hint="surfaces like a regular unread thread — trailing primary dot"
      >
        {singleProject({
          initialCollapsedEnvironmentIds: new Set(["env_collapsed_unread"]),
          threadListState: {
            status: "ready",
            threads: [
              {
                ...sharedWorktreeThreadA,
                environmentId: "env_collapsed_unread",
                lastReadAt: 50,
                latestAttentionAt: 200,
              },
              {
                ...sharedWorktreeThreadB,
                environmentId: "env_collapsed_unread",
              },
            ],
          },
        })}
      </StoryRow>
      <StoryRow
        label="collapsed worktree — unread error thread"
        hint="hidden grouped thread status=error and unread — worktree header shows the destructive unread dot"
      >
        {singleProject({
          initialCollapsedEnvironmentIds: new Set(["env_collapsed_error"]),
          threadListState: {
            status: "ready",
            threads: [
              {
                ...sharedWorktreeThreadA,
                environmentId: "env_collapsed_error",
                status: "error",
                lastReadAt: 50,
                latestAttentionAt: 200,
              },
              {
                ...sharedWorktreeThreadB,
                environmentId: "env_collapsed_error",
              },
            ],
          },
        })}
      </StoryRow>
      <StoryRow
        label="multiple projects"
        hint="four projects stacked — active project at the top with busy/pending threads; another collapsed with a long truncated name; one with two idle threads; an empty one at the bottom"
      >
        <SidebarStage>
          <SidebarStickyStack>
            <InteractiveProjectList rows={multipleProjects} />
          </SidebarStickyStack>
        </SidebarStage>
      </StoryRow>
    </StoryCard>
  );
}

// ---------------------------------------------------------------------------
// Projects list — three realistic, fully-expanded projects stacked together.
// Scoped to the Projects section (not the whole sidebar: no Pinned/Threads/Apps
// sections or section chrome). Helpful for eyeballing the vertical rhythm:
// project↔project separation vs. the tighter grouping inside worktree groups.
// ---------------------------------------------------------------------------

const fullPlanningThreadA = makeThread({
  id: "thr_full_a_planning",
  projectId: "proj_full_a",
  title: "Codex Planning",
  titleFallback: "Codex Planning",
});

interface FullThreadSpec {
  title: string;
  busy?: boolean;
  pending?: boolean;
}

const fullProjectAThreadSpecs: FullThreadSpec[] = [
  { title: "Implement UI and stories consolidation" },
  { title: "Fix Claude active stop recovery", busy: true },
  { title: "Update React Performance Audit" },
  { title: "Investigate Multiple Hosts Setup", pending: true },
];

const fullProjectAThreads: ThreadListEntry[] = [
  fullPlanningThreadA,
  ...fullProjectAThreadSpecs.map((spec, index) =>
    makeThread({
      id: `thr_full_a_thread_${index}`,
      projectId: "proj_full_a",
      title: spec.title,
      titleFallback: spec.title,
      ...(spec.busy
        ? {
            status: "active",
            runtime: {
              displayStatus: "active",
              hostReconnectGraceExpiresAt: null,
            },
          }
        : {}),
      ...(spec.pending ? { hasPendingInteraction: true } : {}),
    }),
  ),
  makeThread({
    id: "thr_full_a_worktree_env_group_1",
    projectId: "proj_full_a",
    title: "Audit recurring permission failures",
    titleFallback: "Audit recurring permission failures",
    environmentId: "env_full_a_codex_train",
    environmentHostId: "host_local",
    environmentBranchName: "bb/squash-merge-ready-app-train-thr_s6fn8fuv9w",
    environmentWorkspaceDisplayKind: "managed-worktree",
  }),
  makeThread({
    id: "thr_full_a_worktree_env_group_2",
    projectId: "proj_full_a",
    title: "Investigate ux regression bug",
    titleFallback: "Investigate ux regression bug",
    environmentId: "env_full_a_codex_train",
    environmentHostId: "host_local",
    environmentBranchName: "bb/squash-merge-ready-app-train-thr_s6fn8fuv9w",
    environmentWorkspaceDisplayKind: "managed-worktree",
  }),
  makeThread({
    id: "thr_full_a_standalone_1",
    projectId: "proj_full_a",
    title: "Stabilize Pnpm Dev Environment",
    titleFallback: "Stabilize Pnpm Dev Environment",
    environmentHostId: "host_local",
    environmentBranchName: "main",
    environmentWorkspaceDisplayKind: "managed-worktree",
  }),
  makeThread({
    id: "thr_full_a_standalone_2",
    projectId: "proj_full_a",
    title: "Investigate Laptop Sleep Bug",
    titleFallback: "Investigate Laptop Sleep Bug",
    lastReadAt: 50,
    latestAttentionAt: 200,
  }),
  makeThread({
    id: "thr_full_a_env_group_1",
    projectId: "proj_full_a",
    title: "Wire sidebar env-grouping data shape",
    titleFallback: "Wire sidebar env-grouping data shape",
    environmentId: "env_full_a_sidebar_rail",
    environmentHostId: "host_local",
    environmentBranchName: "bb/fix-diff-panel-issues-thr_u8cnp5fnea",
    environmentWorkspaceDisplayKind: "managed-worktree",
  }),
  makeThread({
    id: "thr_full_a_env_group_2",
    projectId: "proj_full_a",
    title: "Add story for env-grouped sidebar",
    titleFallback: "Add story for env-grouped sidebar",
    environmentId: "env_full_a_sidebar_rail",
    environmentHostId: "host_local",
    environmentBranchName: "bb/fix-diff-panel-issues-thr_u8cnp5fnea",
    environmentWorkspaceDisplayKind: "managed-worktree",
  }),
];

const fullProjectBThreads: ThreadListEntry[] = [
  makeThread({
    id: "thr_full_b_1",
    projectId: "proj_full_b",
    title: "Add Support For System Theme",
    titleFallback: "Add Support For System Theme",
  }),
  makeThread({
    id: "thr_full_b_2",
    projectId: "proj_full_b",
    title: "Investigate User Manual Issue",
    titleFallback: "Investigate User Manual Issue",
    status: "active",
    runtime: {
      displayStatus: "active",
      hostReconnectGraceExpiresAt: null,
    },
  }),
  makeThread({
    id: "thr_full_b_3",
    projectId: "proj_full_b",
    title: "Optimize Dev Database Size",
    titleFallback: "Optimize Dev Database Size",
  }),
];

const fullPlanningThreadC = makeThread({
  id: "thr_full_c_planning",
  projectId: "proj_full_c",
  title: "Frontend Planning",
  titleFallback: "Frontend Planning",
});

const fullProjectCThreads: ThreadListEntry[] = [
  fullPlanningThreadC,
  makeThread({
    id: "thr_full_c_standalone",
    projectId: "proj_full_c",
    title: "Design timeline pagination v2",
    titleFallback: "Design timeline pagination v2",
  }),
];

const fullProjects: StoryProjectRow[] = [
  {
    project: makeProject({ id: "proj_full_a", name: "bb" }),
    isActive: true,
    threadListState: { status: "ready", threads: fullProjectAThreads },
  },
  {
    project: makeProject({ id: "proj_full_b", name: "pierre" }),
    threadListState: { status: "ready", threads: fullProjectBThreads },
  },
  {
    project: makeProject({ id: "proj_full_c", name: "ingest-pipeline" }),
    threadListState: { status: "ready", threads: fullProjectCThreads },
  },
];

const noop = () => {};

export function MultipleProjects() {
  return (
    <StoryCard>
      <StoryRow
        label="projects list — three projects"
        hint="the Projects section only (no Pinned/Threads/Apps): bb (active) with busy/pending threads, 2 standalones, and two 2-thread env groups; pierre with 3 standalones; ingest-pipeline with 2 standalones"
      >
        <SidebarStage>
          <ProjectListShell>
            <InteractiveProjectList rows={fullProjects} />
          </ProjectListShell>
        </SidebarStage>
      </StoryRow>
    </StoryCard>
  );
}

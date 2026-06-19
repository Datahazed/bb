import { useMemo, type ReactNode } from "react";
import { createStore, Provider as JotaiProvider } from "jotai";
import type { ThreadListEntry } from "@bb/domain";
import {
  PROJECT_IDS,
  makeThreadListEntry,
} from "../../../.ladle/story-fixtures";
import { ProjectActionsProvider } from "@/components/project/ProjectActionsProvider";
import { ThreadActionsProvider } from "@/components/thread/ThreadActionsProvider";
import { SidebarStickyStack } from "@/components/ui/sidebar.js";
import { StoryCard, StoryRow } from "../../../.ladle/story-card";
import {
  ChronologicalThreadTree,
  ProjectThreadTree,
  type ProjectThreadListState,
} from "./ProjectRow";
import { compareStandardThreads } from "./projectThreadGroups";
import {
  sidebarChronologicalSortAtom,
  sidebarGroupByAtom,
  sidebarManualOrderAtom,
  type SidebarChronologicalSort,
  type SidebarGroupBy,
  type SidebarManualOrder,
} from "./sidebarCollapsedAtoms";

export default {
  title: "sidebar/Folder grouping",
};

const noop = () => {};
const PROJECT_ID = PROJECT_IDS.bb;

function makeThread(overrides: Partial<ThreadListEntry>): ThreadListEntry {
  return makeThreadListEntry({
    projectId: PROJECT_ID,
    titleFallback: overrides.title ?? "Story thread",
    ...overrides,
  });
}

const folderThreads: ThreadListEntry[] = [
  makeThread({
    id: "thr_work_plan",
    title: "Work/Q3/Plan",
    latestAttentionAt: 90,
    createdAt: 90,
  }),
  makeThread({
    id: "thr_work_notes",
    title: "Work/Q3/Notes",
    latestAttentionAt: 80,
    createdAt: 80,
  }),
  makeThread({
    id: "thr_work_parent",
    title: "Work/Q4/Kickoff",
    latestAttentionAt: 70,
    createdAt: 70,
  }),
  makeThread({
    id: "thr_work_child",
    parentThreadId: "thr_work_parent",
    title: "Ignored/Child/Path",
    latestAttentionAt: 65,
    createdAt: 65,
  }),
  makeThread({
    id: "thr_personal_plan",
    title: "Personal/Q3/Plan",
    latestAttentionAt: 60,
    createdAt: 60,
  }),
  makeThread({
    id: "thr_standalone",
    title: "Standalone follow-up",
    latestAttentionAt: 50,
    createdAt: 50,
  }),
  makeThread({
    id: "thr_env_a",
    title: "Work/Build/Daemon",
    environmentId: "env_story_folder",
    environmentName: "Folder build",
    environmentBranchName: "bb/sidebar-folders",
    environmentWorkspaceDisplayKind: "managed-worktree",
    latestAttentionAt: 40,
    createdAt: 40,
  }),
  makeThread({
    id: "thr_env_b",
    title: "Work/Build/Stories",
    environmentId: "env_story_folder",
    environmentName: "Folder build",
    environmentBranchName: "bb/sidebar-folders",
    environmentWorkspaceDisplayKind: "managed-worktree",
    hasPendingInteraction: true,
    latestAttentionAt: 30,
    createdAt: 30,
  }),
];

const manualThreads: ThreadListEntry[] = [
  makeThread({ id: "thr_a", title: "Work/Q3/Plan", latestAttentionAt: 90 }),
  makeThread({ id: "thr_b", title: "Work/Q3/Notes", latestAttentionAt: 80 }),
  makeThread({ id: "thr_c", title: "Work/Q4/Kickoff", latestAttentionAt: 70 }),
  makeThread({ id: "thr_d", title: "Personal/Plan", latestAttentionAt: 60 }),
  makeThread({ id: "thr_e", title: "Loose thread", latestAttentionAt: 50 }),
];

const manualOrder: SidebarManualOrder = {
  [PROJECT_ID]: ["thr_e", `${PROJECT_ID}::Personal`, `${PROJECT_ID}::Work`],
  [`${PROJECT_ID}::Work`]: [`${PROJECT_ID}::Work/Q4`, `${PROJECT_ID}::Work/Q3`],
  [`${PROJECT_ID}::Work/Q3`]: ["thr_b", "thr_a"],
};

function SidebarState({
  children,
  groupBy,
  manualOrder,
  sort = "updated",
}: {
  children: ReactNode;
  groupBy: SidebarGroupBy;
  manualOrder?: SidebarManualOrder;
  sort?: SidebarChronologicalSort;
}) {
  const store = useMemo(() => {
    const next = createStore();
    next.set(sidebarGroupByAtom, groupBy);
    next.set(sidebarChronologicalSortAtom, sort);
    if (manualOrder) {
      next.set(sidebarManualOrderAtom, manualOrder);
    }
    return next;
  }, [groupBy, manualOrder, sort]);

  return <JotaiProvider store={store}>{children}</JotaiProvider>;
}

function SidebarStage({
  children,
  groupBy,
  manualOrder,
  sort,
}: {
  children: ReactNode;
  groupBy: SidebarGroupBy;
  manualOrder?: SidebarManualOrder;
  sort?: SidebarChronologicalSort;
}) {
  return (
    <SidebarState groupBy={groupBy} sort={sort} manualOrder={manualOrder}>
      <ProjectActionsProvider>
        <ThreadActionsProvider>
          <div className="w-full max-w-[460px] min-w-0 rounded-md bg-sidebar p-2 text-sidebar-foreground">
            <SidebarStickyStack>{children}</SidebarStickyStack>
          </div>
        </ThreadActionsProvider>
      </ProjectActionsProvider>
    </SidebarState>
  );
}

function projectTree(
  threads: readonly ThreadListEntry[],
): ProjectThreadListState {
  return { status: "ready", threads: [...threads] };
}

function ProjectTree({ threads }: { threads: readonly ThreadListEntry[] }) {
  return (
    <ProjectThreadTree
      projectId={PROJECT_ID}
      threadListState={projectTree(threads)}
      compareThreads={compareStandardThreads}
      collapsedThreadIds={new Set()}
      collapsedEnvironmentIds={new Set()}
      variant="section"
      onToggleThreadCollapsed={noop}
      onToggleEnvironmentCollapsed={noop}
    />
  );
}

export function NoneVsFolder() {
  return (
    <StoryCard columns={["None", "Folder"]} labelWidth="160px">
      <StoryRow label="same data">
        <SidebarStage groupBy="none">
          <ProjectTree threads={folderThreads} />
        </SidebarStage>
        <SidebarStage groupBy="folder">
          <ProjectTree threads={folderThreads} />
        </SidebarStage>
      </StoryRow>
    </StoryCard>
  );
}

export function ChronologicalFolders() {
  return (
    <StoryCard>
      <StoryRow
        label="all threads"
        hint="folder grouping in chronological mode"
      >
        <SidebarStage groupBy="folder">
          <ChronologicalThreadTree
            threadListState={projectTree(folderThreads)}
            compareThreads={compareStandardThreads}
            collapsedThreadIds={new Set()}
            collapsedEnvironmentIds={new Set()}
            onToggleThreadCollapsed={noop}
            onToggleEnvironmentCollapsed={noop}
          />
        </SidebarStage>
      </StoryRow>
    </StoryCard>
  );
}

export function ManualOrder() {
  return (
    <StoryCard>
      <StoryRow
        label="Sort: None"
        hint="manual list interleaves loose threads and folders"
      >
        <SidebarStage groupBy="folder" sort="none" manualOrder={manualOrder}>
          <ProjectTree threads={manualThreads} />
        </SidebarStage>
      </StoryRow>
    </StoryCard>
  );
}

export function CrossFolderRefile() {
  const afterThreads = manualThreads.map((thread) =>
    thread.id === "thr_a" ? { ...thread, title: "Personal/Plan" } : thread,
  );
  return (
    <StoryCard columns={["Before", "After"]} labelWidth="160px">
      <StoryRow label="drop into Personal">
        <SidebarStage groupBy="folder" sort="none">
          <ProjectTree threads={manualThreads} />
        </SidebarStage>
        <SidebarStage groupBy="folder" sort="none">
          <ProjectTree threads={afterThreads} />
        </SidebarStage>
      </StoryRow>
    </StoryCard>
  );
}

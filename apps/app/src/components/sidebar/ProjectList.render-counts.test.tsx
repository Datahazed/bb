// @vitest-environment jsdom
//
// End-to-end render counts for the sidebar's project rows. The unit suites
// cover each memoization layer in isolation (row retention, the row
// comparator, the cached header element, the draft subscriptions); this test
// mounts the real `ProjectList` on a seeded query cache and counts how many
// `ProjectRow` bodies run when one thread is patched through the same
// `setQueryData` path a status-changed push uses, so a prop that bypasses
// every tested helper (a fresh object threaded through `SortableProjectRow`,
// say) still shows up as extra renders.

import {
  act,
  cleanup,
  render,
  renderHook,
  screen,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { Provider as JotaiProvider, createStore } from "jotai";
import { TooltipProvider } from "@bb/shared-ui/tooltip";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  ProjectWithThreadsResponse,
  SidebarBootstrapResponse,
} from "@bb/server-contract";
import { PERSONAL_PROJECT_ID, type ThreadListEntry } from "@bb/domain";
import { makeThreadListEntry } from "@/test/fixtures/thread-list-entries";
import { sidebarNavigationQueryKey } from "@/hooks/queries/query-keys";
import { applyToCachedSidebarNavigationThreads } from "@/hooks/cache-owners/query-cache";
import { ProjectList } from "./ProjectList";
import type { ProjectRowProps } from "./ProjectRow";
import { useSidebarReorderDnd } from "./useSidebarReorderDnd";

/** How many times each project's `ProjectRow` body ran, by project id. */
const projectRowRenders = vi.hoisted(() => new Map<string, number>());

// The real row behind the real memo comparator, counting how often React gets
// past that comparator. Every other export of the module stays as is.
vi.mock("./ProjectRow", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./ProjectRow")>();
  const { createElement, memo } = await import("react");
  const CountingProjectRow = memo(function CountingProjectRow(
    props: ProjectRowProps,
  ) {
    projectRowRenders.set(
      props.project.id,
      (projectRowRenders.get(props.project.id) ?? 0) + 1,
    );
    return createElement(actual.ProjectRow, props);
  }, actual.areProjectRowPropsEqual);
  return { ...actual, ProjectRow: CountingProjectRow };
});

vi.mock("@/hooks/queries/host-queries", () => ({
  useHosts: () => ({ data: [] }),
  usePrimaryHost: () => null,
}));

vi.mock("@/hooks/useRealtimeSubscription", () => ({
  useThreadDetailRealtimeSubscription: () => {},
  useEnvironmentDetailRealtimeSubscription: () => {},
  useProjectDetailRealtimeSubscription: () => {},
  useThreadListRealtimeSubscription: () => {},
  useProjectListRealtimeSubscription: () => {},
  useEnvironmentListRealtimeSubscription: () => {},
  useHostListRealtimeSubscription: () => {},
  useSystemRealtimeSubscription: () => {},
}));

vi.mock("@/hooks/useLocalPathPicker", () => ({
  usePathPickerHost: () => ({ hostId: null, hostName: null }),
}));

vi.mock("@/hooks/mutations/environment-mutations", () => ({
  useArchiveEnvironmentThreads: () => ({
    isPending: false,
    mutate: vi.fn(),
    variables: undefined,
  }),
  useUpdateEnvironment: () => ({
    error: null,
    isPending: false,
    mutate: vi.fn(),
    reset: vi.fn(),
    variables: undefined,
  }),
}));

vi.mock("@/hooks/useCreateThreadInWorktree", () => ({
  useCreateThreadInWorktree: () => vi.fn(),
}));

vi.mock("@/components/project/ProjectActionsProvider", () => ({
  useProjectActions: () => ({
    requestRename: vi.fn(),
    requestDelete: vi.fn(),
    requestAddLocalPath: vi.fn(),
  }),
}));

vi.mock("@/components/thread/ThreadActionsProvider", () => ({
  useThreadActions: () => ({
    renameThread: vi.fn(),
    requestRename: vi.fn(),
    requestDelete: vi.fn(),
    archiveThreadAndChildren: vi.fn(),
    unarchiveThread: vi.fn(),
    togglePin: vi.fn(),
    toggleRead: vi.fn(),
  }),
}));

function makeProject(
  id: string,
  threads: ThreadListEntry[],
  kind: ProjectWithThreadsResponse["kind"] = "standard",
): ProjectWithThreadsResponse {
  return {
    id,
    kind,
    name: `Project ${id}`,
    gitRemoteUrl: null,
    sources: [],
    createdAt: 0,
    updatedAt: 0,
    threads,
    defaultExecutionOptions: null,
  };
}

function threadsFor(projectId: string, count: number): ThreadListEntry[] {
  return Array.from({ length: count }, (_, index) =>
    makeThreadListEntry({
      id: `thr_${projectId}_${index}`,
      projectId,
      title: `Thread ${projectId} ${index}`,
      updatedAt: 100 + index,
      lastReadAt: 100 + index,
      latestAttentionAt: 100 + index,
    }),
  );
}

function makePayload(): SidebarBootstrapResponse {
  return {
    sections: [],
    projects: [
      makeProject("a", threadsFor("a", 3)),
      makeProject("b", threadsFor("b", 3)),
      makeProject("c", threadsFor("c", 3)),
    ],
    personalProject: makeProject(
      PERSONAL_PROJECT_ID,
      threadsFor(PERSONAL_PROJECT_ID, 2),
      "personal",
    ),
  };
}

function snapshotRenders(): Record<string, number> {
  return Object.fromEntries(projectRowRenders);
}

/**
 * Lets the follow-up renders an update schedules (layout-effect state, the
 * persisted-order normalization, dnd-kit's first measurement) settle before
 * the counts are sampled.
 */
async function settleRenders(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  projectRowRenders.clear();
});

describe("ProjectList render counts", () => {
  it("re-renders only the patched project's row on a sidebar cache patch", async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    queryClient.setQueryData(sidebarNavigationQueryKey(), makePayload());

    render(
      <QueryClientProvider client={queryClient}>
        <JotaiProvider store={createStore()}>
          <TooltipProvider>
            <MemoryRouter>
              <ProjectList />
            </MemoryRouter>
          </TooltipProvider>
        </JotaiProvider>
      </QueryClientProvider>,
    );
    await screen.findByTitle("Project c");
    await settleRenders();
    const baseline = snapshotRenders();
    expect(Object.keys(baseline).sort()).toEqual(["a", "b", "c"]);

    // A status-changed push for one of A's threads, through the same
    // setQueryData path the realtime cache owner uses.
    await act(async () => {
      applyToCachedSidebarNavigationThreads({
        queryClient,
        mapper: (threads) =>
          threads.map((thread) =>
            thread.id === "thr_a_1"
              ? {
                  ...thread,
                  status: "active",
                  runtime: {
                    displayStatus: "active",
                    hostReconnectGraceExpiresAt: null,
                  },
                }
              : thread,
          ),
      });
    });
    await settleRenders();
    const afterPatch = snapshotRenders();
    expect(afterPatch).toEqual({ ...baseline, a: baseline.a + 1 });

    // A refetch whose payload is deep-equal: React Query's structural sharing
    // keeps every object, so no row renders at all.
    await act(async () => {
      queryClient.setQueryData(sidebarNavigationQueryKey(), (current) =>
        structuredClone(current),
      );
    });
    await settleRenders();
    expect(snapshotRenders()).toEqual(afterPatch);

    // A change to every thread of B alone re-renders B's row only.
    await act(async () => {
      applyToCachedSidebarNavigationThreads({
        queryClient,
        mapper: (threads) =>
          threads.map((thread) =>
            thread.projectId === "b"
              ? { ...thread, updatedAt: thread.updatedAt + 1000 }
              : thread,
          ),
      });
    });
    await settleRenders();
    expect(snapshotRenders()).toEqual({ ...afterPatch, b: afterPatch.b + 1 });
  });
});

describe("useSidebarReorderDnd", () => {
  it("keeps the dnd-kit sensors across re-renders with unchanged handlers", () => {
    // dnd-kit memoizes the sensors on their option objects; a fresh `sensors`
    // array makes DndContext rebuild every sortable's listeners, which is what
    // the render-count test above catches one layer up.
    const onDragEnd = vi.fn();
    const { result, rerender } = renderHook(() =>
      useSidebarReorderDnd({ onDragEnd }),
    );
    const first = result.current.dndContextProps;
    rerender();
    expect(result.current.dndContextProps.sensors).toBe(first.sensors);
    expect(result.current.dndContextProps).toBe(first);
  });
});

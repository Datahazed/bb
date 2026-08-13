import { useEffect, type ReactNode } from "react";
import { WorkerPoolContextProvider } from "@pierre/diffs/react";
import {
  createDiffWorker,
  getDiffWorkerPoolSize,
  retainDiffWorkerPoolDemand,
} from "@/lib/diff-worker-pool";
import { useResolvedCodeThemePair } from "@/lib/code-theme";
import { useSyncPierreWorkerPoolTheme } from "@/lib/pierre-worker-pool-theme";

const WORKER_POOL_OPTIONS = {
  workerFactory: createDiffWorker,
  poolSize: getDiffWorkerPoolSize(),
};

function PierreWorkerPoolThemeSync() {
  useSyncPierreWorkerPoolTheme();
  return null;
}

function WorkerPool({ children }: { children: ReactNode }) {
  const theme = useResolvedCodeThemePair();
  // The provider spawns workers eagerly; environments without Worker (jsdom
  // tests) just render diffs unhighlighted.
  if (typeof Worker === "undefined") {
    return children;
  }
  return (
    <WorkerPoolContextProvider
      poolOptions={WORKER_POOL_OPTIONS}
      highlighterOptions={{ theme }}
    >
      <PierreWorkerPoolThemeSync />
      {children}
    </WorkerPoolContextProvider>
  );
}

/**
 * Supplies the shared `@pierre/diffs` worker pool to one diff surface.
 *
 * The pool is a process-wide singleton that `@pierre/diffs` reference-counts,
 * so every surface can mount its own provider and they all share one set of
 * workers. Surfaces provide it themselves rather than inheriting it from the
 * thread page, because a page-level provider would put the whole diff renderer
 * on the thread route's preload set.
 */
export function DiffWorkerPoolProvider({ children }: { children: ReactNode }) {
  // Publishing demand lets a thread area learn that a diff is on screen
  // without importing anything from this chunk.
  useEffect(() => retainDiffWorkerPoolDemand(), []);
  return <WorkerPool>{children}</WorkerPool>;
}

/**
 * Holds one reference to the worker pool without rendering anything.
 *
 * A thread area mounts this once a diff surface appears. Without it, scrolling
 * the last diff out of the virtualized timeline would drop the reference count
 * to zero, terminate the workers, and force a fresh highlighter build the next
 * time a diff appears. It publishes no demand of its own, so it cannot keep
 * itself alive.
 */
export function DiffWorkerPoolKeepAlive() {
  return <WorkerPool>{null}</WorkerPool>;
}

/** The plugin-side entry point. See `@/lib/plugin-diff-worker-pool`. */
export function renderWithDiffWorkerPool(children: ReactNode): ReactNode {
  return <DiffWorkerPoolProvider>{children}</DiffWorkerPoolProvider>;
}

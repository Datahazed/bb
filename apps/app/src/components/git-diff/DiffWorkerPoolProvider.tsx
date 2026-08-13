import type { ReactNode } from "react";
import { WorkerPoolContextProvider } from "@pierre/diffs/react";
import {
  createDiffWorker,
  getDiffWorkerPoolSize,
  markDiffWorkerPoolProviderLoaded,
} from "@/lib/diff-worker-pool";
import { useResolvedCodeThemePair } from "@/lib/code-theme";
import { useSyncPierreWorkerPoolTheme } from "@/lib/pierre-worker-pool-theme";

const WORKER_POOL_OPTIONS = {
  workerFactory: createDiffWorker,
  poolSize: getDiffWorkerPoolSize(),
};

// Importing `@pierre/diffs/react` pulls the diff renderer and Shiki, so this
// module belongs to the on-demand diff chunk. Announcing the load lets the
// thread area mount its keep-alive holder.
markDiffWorkerPoolProviderLoaded();

function PierreWorkerPoolThemeSync() {
  useSyncPierreWorkerPoolTheme();
  return null;
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
 * Holds one reference to the worker pool for as long as the thread area lives.
 *
 * Without it, scrolling the last diff out of the virtualized timeline would
 * drop the reference count to zero, terminate the workers, and force a fresh
 * highlighter build the next time a diff appears.
 */
export function DiffWorkerPoolKeepAlive() {
  return <DiffWorkerPoolProvider>{null}</DiffWorkerPoolProvider>;
}

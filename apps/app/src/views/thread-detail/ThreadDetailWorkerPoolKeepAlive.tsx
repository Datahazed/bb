import { lazy, Suspense, useSyncExternalStore } from "react";
import {
  isDiffWorkerPoolProviderLoaded,
  subscribeToDiffWorkerPoolProviderLoaded,
} from "@/lib/diff-worker-pool";

const DiffWorkerPoolKeepAlive = lazy(() =>
  import("@/components/git-diff/DiffWorkerPoolProvider").then((module) => ({
    default: module.DiffWorkerPoolKeepAlive,
  })),
);

/**
 * Holds the shared diff worker pool open for the thread area. Renders nothing.
 *
 * Each diff surface supplies the pool to its own subtree through
 * `DiffWorkerPoolProvider`, so this component exists only to stop the pool's
 * reference count from reaching zero between two such surfaces — for instance
 * when the last diff row scrolls out of the virtualized timeline.
 *
 * It is a sibling of the thread workspace rather than a wrapper. A wrapper
 * would have to load the diff renderer before the thread could render at all,
 * and mounting a wrapper later would change the tree shape around the
 * workspace, which remounts it and loses composer state.
 *
 * It waits for the diff chunk to load on its own account, so a thread whose
 * user never opens a diff never spawns a worker.
 */
export function ThreadDetailWorkerPoolKeepAlive() {
  const diffWorkerPoolLoaded = useSyncExternalStore(
    subscribeToDiffWorkerPoolProviderLoaded,
    isDiffWorkerPoolProviderLoaded,
    isDiffWorkerPoolProviderLoaded,
  );
  if (!diffWorkerPoolLoaded) return null;
  return (
    <Suspense fallback={null}>
      <DiffWorkerPoolKeepAlive />
    </Suspense>
  );
}

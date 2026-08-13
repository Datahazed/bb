import { lazy, Suspense, useEffect, useState, useSyncExternalStore } from "react";
import {
  getDiffWorkerPoolDemand,
  subscribeToDiffWorkerPoolDemand,
} from "@/lib/diff-worker-pool";

const DiffWorkerPoolKeepAlive = lazy(() =>
  import("@/components/git-diff/DiffWorkerPoolProvider").then((module) => ({
    default: module.DiffWorkerPoolKeepAlive,
  })),
);

/**
 * Holds the shared diff worker pool open for this thread area. Renders nothing.
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
 * The latch is per mount, not global: a thread area engages only after a diff
 * surface appears inside it. Opening a diff in one thread therefore does not
 * make the next thread spawn workers it has no use for.
 */
export function ThreadDetailWorkerPoolKeepAlive() {
  const diffWorkerPoolDemand = useSyncExternalStore(
    subscribeToDiffWorkerPoolDemand,
    getDiffWorkerPoolDemand,
    getDiffWorkerPoolDemand,
  );
  const [engaged, setEngaged] = useState(false);

  useEffect(() => {
    if (diffWorkerPoolDemand > 0) setEngaged(true);
  }, [diffWorkerPoolDemand]);

  if (!engaged) return null;
  return (
    <Suspense fallback={null}>
      <DiffWorkerPoolKeepAlive />
    </Suspense>
  );
}

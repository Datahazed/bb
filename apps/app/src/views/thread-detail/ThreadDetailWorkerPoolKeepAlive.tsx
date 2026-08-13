import { lazy, Suspense, useEffect, useState, useSyncExternalStore } from "react";
import {
  getDiffWorkerPoolDemand,
  subscribeToDiffWorkerPoolDemand,
} from "@/lib/diff-worker-pool";
import { useRouteState } from "@/hooks/useRouteState";

const DiffWorkerPoolKeepAlive = lazy(() =>
  import("@/components/git-diff/DiffWorkerPoolProvider").then((module) => ({
    default: module.DiffWorkerPoolKeepAlive,
  })),
);

/**
 * Holds the shared diff worker pool open for the thread on screen. Renders
 * nothing.
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
 * The hold is scoped to one thread. This component outlives thread navigation,
 * because the split workspace keeps its shell mounted, so a latch that only
 * ever turned on would keep up to eight workers alive for the rest of the
 * session after a single diff. Recording which thread engaged the pool releases
 * it on navigation while keeping it steady within a thread, where the churn
 * this guards against actually happens.
 */
export function ThreadDetailWorkerPoolKeepAlive() {
  const { threadId } = useRouteState();
  const diffWorkerPoolDemand = useSyncExternalStore(
    subscribeToDiffWorkerPoolDemand,
    getDiffWorkerPoolDemand,
    getDiffWorkerPoolDemand,
  );
  const [engagedThreadId, setEngagedThreadId] = useState<string | null>(null);

  useEffect(() => {
    if (diffWorkerPoolDemand > 0 && engagedThreadId !== threadId) {
      setEngagedThreadId(threadId ?? null);
    }
  }, [diffWorkerPoolDemand, engagedThreadId, threadId]);

  if (engagedThreadId === null || engagedThreadId !== threadId) return null;
  return (
    <Suspense fallback={null}>
      <DiffWorkerPoolKeepAlive />
    </Suspense>
  );
}

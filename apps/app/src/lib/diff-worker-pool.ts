const DIFF_WORKER_POOL_MAX_SIZE = 8;
const DIFF_WORKER_POOL_MIN_SIZE = 1;

export function getDiffWorkerPoolSize(): number {
  const hardwareConcurrency =
    typeof navigator !== "undefined"
      ? navigator.hardwareConcurrency
      : undefined;
  if (hardwareConcurrency === undefined || hardwareConcurrency <= 2) {
    return DIFF_WORKER_POOL_MIN_SIZE;
  }
  return Math.max(
    DIFF_WORKER_POOL_MIN_SIZE,
    Math.min(DIFF_WORKER_POOL_MAX_SIZE, hardwareConcurrency - 1),
  );
}

export function createDiffWorker(): Worker {
  return new Worker(
    new URL("@pierre/diffs/worker/worker-portable.js", import.meta.url),
    { name: "pierre-diffs-worker", type: "module" },
  );
}

// The diff renderer loads on demand, so nothing on a thread page may import
// `@pierre/diffs` before a user opens a diff. This counter is the one thing the
// light side is allowed to know about the heavy side: how many diff surfaces
// are mounted right now. `DiffWorkerPoolProvider` maintains it, and a thread
// area reads it to decide whether to hold the pool open.
//
// A count, not a "the chunk loaded" flag: a flag would never fall back to
// false, so opening one diff would make every later thread page spawn workers
// before it showed a diff of its own.
let diffWorkerPoolDemand = 0;
const diffWorkerPoolDemandListeners = new Set<() => void>();

/** Called by a mounted diff surface. Returns its release function. */
export function retainDiffWorkerPoolDemand(): () => void {
  diffWorkerPoolDemand += 1;
  for (const listener of diffWorkerPoolDemandListeners) listener();
  let released = false;
  return () => {
    if (released) return;
    released = true;
    diffWorkerPoolDemand -= 1;
    for (const listener of diffWorkerPoolDemandListeners) listener();
  };
}

export function getDiffWorkerPoolDemand(): number {
  return diffWorkerPoolDemand;
}

export function subscribeToDiffWorkerPoolDemand(
  listener: () => void,
): () => void {
  diffWorkerPoolDemandListeners.add(listener);
  return () => {
    diffWorkerPoolDemandListeners.delete(listener);
  };
}

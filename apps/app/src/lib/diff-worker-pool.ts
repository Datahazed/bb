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
// `@pierre/diffs` before a user opens a diff. This flag is the one bit the
// light side is allowed to know about the heavy side: DiffWorkerPoolProvider
// sets it when its chunk evaluates, and DiffWorkerPoolKeepAlive reads it.
let diffWorkerPoolProviderLoaded = false;
const diffWorkerPoolProviderListeners = new Set<() => void>();

/** Called by the diff chunk when it evaluates. */
export function markDiffWorkerPoolProviderLoaded(): void {
  if (diffWorkerPoolProviderLoaded) return;
  diffWorkerPoolProviderLoaded = true;
  for (const listener of diffWorkerPoolProviderListeners) listener();
}

export function isDiffWorkerPoolProviderLoaded(): boolean {
  return diffWorkerPoolProviderLoaded;
}

export function subscribeToDiffWorkerPoolProviderLoaded(
  listener: () => void,
): () => void {
  diffWorkerPoolProviderListeners.add(listener);
  return () => {
    diffWorkerPoolProviderListeners.delete(listener);
  };
}

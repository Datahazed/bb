/**
 * Caches a module import, but drops the cache when the import rejects.
 *
 * A chunk fetch fails on a flaky network. Caching the rejected promise would
 * replay that one failure for the rest of the page's life, so the feature
 * behind the chunk could never come back without a reload.
 */
export function createRetryingModuleLoader<T>(
  load: () => Promise<T>,
): () => Promise<T> {
  let pending: Promise<T> | null = null;
  return () => {
    pending ??= load().catch((error: unknown) => {
      pending = null;
      throw error;
    });
    return pending;
  };
}

/**
 * An in-process memo for expensive async lookups: concurrent calls for one key
 * share the in-flight promise, and a settled success is served from memory
 * until it expires. Failures are forgotten by default, so the next call
 * retries; a memo created with `failures` replays the rejections its predicate
 * accepts for a separate (normally much shorter) window.
 */
export interface AsyncTtlMemo<TKey, TValue> {
  clear(): void;
  run(key: TKey, task: () => Promise<TValue>): Promise<TValue>;
}

interface MemoizedFailuresOptions {
  /** How long an accepted rejection is replayed before the task runs again. */
  ttlMs: number;
  /**
   * Which rejections are worth replaying. Callers pass a predicate rather than
   * memoizing every failure so a transport error (nothing was spawned) keeps
   * retrying at once while a host-answered failure is not re-run on every read.
   */
  shouldMemoize(error: unknown): boolean;
}

interface CreateAsyncTtlMemoOptions {
  ttlMs: number;
  failures?: MemoizedFailuresOptions;
  now?: () => number;
}

type MemoOutcome<TValue> =
  | { ok: true; value: TValue }
  | { ok: false; error: unknown };

interface MemoEntry<TValue> {
  expiresAt: number;
  outcome: MemoOutcome<TValue>;
}

export function createAsyncTtlMemo<TKey, TValue>({
  ttlMs,
  failures,
  now = Date.now,
}: CreateAsyncTtlMemoOptions): AsyncTtlMemo<TKey, TValue> {
  const settledByKey = new Map<TKey, MemoEntry<TValue>>();
  const pendingByKey = new Map<TKey, Promise<TValue>>();

  function pruneExpired(currentTime: number): void {
    for (const [key, entry] of settledByKey) {
      if (entry.expiresAt <= currentTime) {
        settledByKey.delete(key);
      }
    }
  }

  function store(key: TKey, outcome: MemoOutcome<TValue>, ttl: number): void {
    const settledAt = now();
    // Expired neighbours are swept here rather than on a timer so the map
    // stays bounded without keeping the process alive.
    pruneExpired(settledAt);
    settledByKey.set(key, { outcome, expiresAt: settledAt + ttl });
  }

  return {
    clear() {
      settledByKey.clear();
      pendingByKey.clear();
    },
    run(key, task) {
      const currentTime = now();
      const settled = settledByKey.get(key);
      if (settled !== undefined) {
        if (settled.expiresAt > currentTime) {
          return settled.outcome.ok
            ? Promise.resolve(settled.outcome.value)
            : Promise.reject(settled.outcome.error);
        }
        settledByKey.delete(key);
      }
      const pending = pendingByKey.get(key);
      if (pending !== undefined) {
        return pending;
      }
      const started = task()
        .then(
          (value) => {
            store(key, { ok: true, value }, ttlMs);
            return value;
          },
          // Two-argument `then`: only the task's own rejection is a candidate
          // for the failure window, never an error thrown while storing.
          (error: unknown) => {
            if (failures !== undefined && failures.shouldMemoize(error)) {
              store(key, { ok: false, error }, failures.ttlMs);
            }
            throw error;
          },
        )
        .finally(() => {
          if (pendingByKey.get(key) === started) {
            pendingByKey.delete(key);
          }
        });
      pendingByKey.set(key, started);
      return started;
    },
  };
}

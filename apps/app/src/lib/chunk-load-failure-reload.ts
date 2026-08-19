/**
 * `bb update` swaps `dist/` wholesale, so every content-hashed chunk an open
 * page has not loaded yet disappears from the server. The next `lazy()` route
 * or dynamic `import()` then 404s and Vite raises `vite:preloadError`. Before
 * this handler that surfaced as a blank route inside a page that could not
 * recover on its own; now the page reloads once so it picks up the new
 * index.html and hashes.
 *
 * The one-shot guard keeps a genuinely broken deploy (or an offline device)
 * from turning into a reload loop: a second failure inside the window lets the
 * error propagate to the error boundary instead.
 */
const RELOAD_STAMP_STORAGE_KEY = "bb.chunkLoadFailureReloadAt";
export const CHUNK_LOAD_FAILURE_RELOAD_WINDOW_MS = 60_000;

export interface ChunkLoadFailureReloadDeps {
  now: () => number;
  reload: () => void;
  /** Per-tab stamp store; `null` when sessionStorage is unavailable. */
  storage: Pick<Storage, "getItem" | "setItem"> | null;
  warn: (message: string, error: unknown) => void;
}

interface PreloadErrorEventLike {
  defaultPrevented: boolean;
  payload: unknown;
  preventDefault(): void;
}

function readLastReloadAt(deps: ChunkLoadFailureReloadDeps): number | null {
  try {
    const raw = deps.storage?.getItem(RELOAD_STAMP_STORAGE_KEY) ?? null;
    if (raw === null) return null;
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function writeLastReloadAt(
  deps: ChunkLoadFailureReloadDeps,
  now: number,
): void {
  try {
    deps.storage?.setItem(RELOAD_STAMP_STORAGE_KEY, String(now));
  } catch {
    // Storage unavailable: the in-memory `reloading` latch below still keeps
    // this page load from reloading more than once.
  }
}

export function createChunkLoadFailureHandler(
  deps: ChunkLoadFailureReloadDeps,
): (event: PreloadErrorEventLike) => void {
  let reloading = false;
  return (event) => {
    if (reloading) {
      // Reload already requested; swallow the follow-up failures of the same
      // page instead of throwing into React while the navigation is pending.
      event.preventDefault();
      return;
    }
    const now = deps.now();
    const lastReloadAt = readLastReloadAt(deps);
    if (
      lastReloadAt !== null &&
      now - lastReloadAt <= CHUNK_LOAD_FAILURE_RELOAD_WINDOW_MS
    ) {
      // Reloaded for this reason moments ago and it did not help: let the
      // error reach the error boundary rather than loop.
      return;
    }
    reloading = true;
    event.preventDefault();
    deps.warn(
      "[bb] a code chunk failed to load; reloading to pick up the current build",
      event.payload,
    );
    writeLastReloadAt(deps, now);
    deps.reload();
  };
}

function sessionStorageOrNull(): Storage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

export function installChunkLoadFailureReload(): void {
  window.addEventListener(
    "vite:preloadError",
    createChunkLoadFailureHandler({
      now: () => Date.now(),
      reload: () => window.location.reload(),
      storage: sessionStorageOrNull(),
      warn: (message, error) => console.warn(message, error),
    }),
  );
}

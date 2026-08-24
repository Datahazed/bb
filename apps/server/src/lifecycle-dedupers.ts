import type { AvailableModel } from "@bb/domain";
import {
  createAsyncDeduper,
  type AsyncDeduper,
} from "./services/lib/async-deduper.js";
import {
  createAsyncTtlMemo,
  type AsyncTtlMemo,
} from "./services/lib/async-ttl-memo.js";

/**
 * How long a successful `provider.list_models` answer is reused. Provider
 * catalogs change on the order of releases, and the memo key already carries
 * the daemon session and provider registration revision, so a daemon restart
 * or a plugin reload re-probes immediately regardless of this window.
 */
const PROVIDER_MODEL_LIST_MEMO_TTL_MS = 10 * 60_000;

/**
 * How long an installed-only provider's "is the agent on this host" answer is
 * reused. It only flips when the user installs or removes the agent, and the
 * key carries the daemon session and registration revision, so reconnects and
 * plugin reloads re-probe regardless. The window must stay well above the
 * daemon's 60 s maintenance-bridge idle timeout: a shorter one would land most
 * expiries on a cold bridge, which is the 400 ms–1.3 s respawn this memo exists
 * to keep off the request path.
 */
const INSTALLED_PROVIDER_PROBE_MEMO_TTL_MS = 5 * 60_000;

export interface ProviderModelListMemoValue {
  models: AvailableModel[];
  selectedOnlyModels: AvailableModel[];
}

export interface LifecycleDedupers {
  environmentCleanupAdvance: AsyncDeduper<string, void>;
  /**
   * Memo for the installed-only provider discovery probe (`provider.health`
   * per `visibility: "installed"` registration). Every provider roster read
   * (`/system/providers`, `/providers/state`, `/execution-options`, usage
   * limits, CLI status) used to pay that probe on the host. The value is only
   * "installed or not": readiness (login state, cwd-scoped health) stays live
   * in `getProviderState`.
   */
  installedProviderProbe: AsyncTtlMemo<string, boolean>;
  /**
   * Memo for host model probes: every execution-options read (each thread
   * open, focus, and reconnect) used to spawn a provider CLI on the host.
   */
  providerModelList: AsyncTtlMemo<string, ProviderModelListMemoValue>;
  queuedMessageAutoSend: AsyncDeduper<string, void>;
  threadProvisionAdvance: AsyncDeduper<string, void>;
}

export function createLifecycleDedupers(): LifecycleDedupers {
  return {
    environmentCleanupAdvance: createAsyncDeduper<string, void>(),
    installedProviderProbe: createAsyncTtlMemo<string, boolean>({
      ttlMs: INSTALLED_PROVIDER_PROBE_MEMO_TTL_MS,
    }),
    providerModelList: createAsyncTtlMemo<string, ProviderModelListMemoValue>({
      ttlMs: PROVIDER_MODEL_LIST_MEMO_TTL_MS,
    }),
    queuedMessageAutoSend: createAsyncDeduper<string, void>(),
    threadProvisionAdvance: createAsyncDeduper<string, void>(),
  };
}

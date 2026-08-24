import type { AvailableModel } from "@bb/domain";
import type {
  HostDaemonRetryableOnlineRpcCommand,
  HostDaemonRpcResultForCommand,
} from "@bb/host-daemon-contract";
import {
  createAsyncDeduper,
  type AsyncDeduper,
} from "./services/lib/async-deduper.js";
import {
  createAsyncTtlMemo,
  type AsyncTtlMemo,
} from "./services/lib/async-ttl-memo.js";
import { ApiError } from "./errors.js";
import { isHostUnavailableApiError } from "./services/hosts/online-rpc.js";

/**
 * How long a successful `provider.list_models` answer is reused. Provider
 * catalogs change on the order of releases, and the memo key already carries
 * the daemon session and provider registration revision, so a daemon restart
 * or a plugin reload re-probes immediately regardless of this window.
 */
const PROVIDER_MODEL_LIST_MEMO_TTL_MS = 10 * 60_000;

/**
 * How long a failed `provider.list_models` answer is replayed. A failed probe
 * is normally a CLI that is missing, not logged in, or timing out; without a
 * window every execution-options read (each thread open) re-spawned it only
 * to fail again. 30 s bounds the lag between `claude login` in a terminal and
 * the picker recovering, and the provider CLI install route clears the memo
 * explicitly.
 */
const PROVIDER_MODEL_LIST_FAILURE_MEMO_TTL_MS = 30_000;

/**
 * Only a host-answered failure is worth replaying: a 502 the daemon returned
 * or a 504 command timeout. `host_unavailable` is transport — no CLI was
 * spawned — and replaying it would delay recovery once the daemon is back.
 * Anything else (parse or internal errors) must retry.
 */
function isMemoizableProviderModelProbeFailure(error: unknown): boolean {
  return (
    error instanceof ApiError &&
    (error.status === 502 || error.status === 504) &&
    !isHostUnavailableApiError(error)
  );
}

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

/**
 * How long one provider's `provider.installation.status` answer is reused.
 * The probe runs `which`, `--version`, `npm view` (network), `npm list -g` and
 * `claude doctor` on the host — 2-3 s per request — and the app asked for it
 * on every boot. npm dist-tags move on release cadence, so the same window as
 * the model list is fine; a manual "Check for updates" bypasses it with
 * `?force=true`, and the install route clears it.
 */
const PROVIDER_INSTALLATION_STATUS_MEMO_TTL_MS = 10 * 60_000;

export interface ProviderModelListMemoValue {
  models: AvailableModel[];
  selectedOnlyModels: AvailableModel[];
}

export type ProviderInstallationStatusCommand = Extract<
  HostDaemonRetryableOnlineRpcCommand,
  { type: "provider.installation.status" }
>;

export type ProviderInstallationStatusMemoValue =
  HostDaemonRpcResultForCommand<ProviderInstallationStatusCommand>;

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
   * Memo for per-provider CLI installation status (`GET
   * /hosts/:id/provider-clis/status`): the sidebar Updates badge and the
   * compose view both asked for it at boot, and each answer spawned six
   * subprocesses on the host. Only the raw RPC result is stored; omission on
   * a 502/504 or the aggregate deadline stays outside the memo.
   */
  providerInstallationStatus: AsyncTtlMemo<
    string,
    ProviderInstallationStatusMemoValue
  >;
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
    providerInstallationStatus: createAsyncTtlMemo<
      string,
      ProviderInstallationStatusMemoValue
    >({
      ttlMs: PROVIDER_INSTALLATION_STATUS_MEMO_TTL_MS,
    }),
    providerModelList: createAsyncTtlMemo<string, ProviderModelListMemoValue>({
      ttlMs: PROVIDER_MODEL_LIST_MEMO_TTL_MS,
      failures: {
        ttlMs: PROVIDER_MODEL_LIST_FAILURE_MEMO_TTL_MS,
        shouldMemoize: isMemoizableProviderModelProbeFailure,
      },
    }),
    queuedMessageAutoSend: createAsyncDeduper<string, void>(),
    threadProvisionAdvance: createAsyncDeduper<string, void>(),
  };
}

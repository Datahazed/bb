import type {
  ProviderCliStatus,
  ProviderCliStatusResponse,
} from "@bb/host-daemon-contract";
import { ZodError } from "zod";
import type {
  ProviderInstallationStatusCommand,
  ProviderInstallationStatusMemoValue,
} from "../../lifecycle-dedupers.js";
import type { AppDeps } from "../../types.js";
import { COMMAND_TIMEOUT_MS } from "../../constants.js";
import { ApiError } from "../../errors.js";
import {
  callHostRetryableOnlineRpc,
  isHostUnavailableApiError,
} from "../hosts/online-rpc.js";
import { listSystemProviderInfos } from "./execution-options.js";
import { resolveBridgeLaunchForProviderId } from "./provider-bridge-launch.js";
import { mapProviderMaintenanceRequests } from "./provider-maintenance-concurrency.js";

// Leave five seconds for HTTP response delivery before the Node SDK's
// 75-second default request timeout.
const PROVIDER_INSTALLATION_STATUS_TIMEOUT_MS = 70_000;

function canOmitProviderInstallationStatusError(error: unknown): boolean {
  if (error instanceof ZodError) return true;
  return (
    error instanceof ApiError &&
    !isHostUnavailableApiError(error) &&
    (error.status === 502 || error.status === 504)
  );
}

/**
 * Runs one provider's installation probe through the process-wide memo, keyed
 * like the model-list memo: host, daemon session, registration revision, and
 * the full command (the bridge launch carries the plugin artifact digest, so a
 * rebuilt plugin re-probes). Only the raw RPC result is stored: the caller's
 * deadline check and 502/504 omission stay outside so a transient omission is
 * never frozen for the TTL. Skipped when no daemon session is registered, as
 * the answer would then belong to a session this call cannot name.
 */
function readProviderInstallationStatusMemoized(
  deps: AppDeps,
  {
    command,
    hostId,
    timeoutMs,
  }: {
    command: ProviderInstallationStatusCommand;
    hostId: string;
    timeoutMs: number;
  },
): Promise<ProviderInstallationStatusMemoValue> {
  const probe = (): Promise<ProviderInstallationStatusMemoValue> =>
    callHostRetryableOnlineRpc(deps, { hostId, timeoutMs, command });
  const daemonSessionId = deps.hub.getDaemonSessionIdForHost(hostId);
  if (daemonSessionId === null) {
    return probe();
  }
  const memoKey = JSON.stringify([
    hostId,
    daemonSessionId,
    deps.providerRegistry.getRegistrationRevision(),
    command,
  ]);
  return deps.lifecycleDedupers.providerInstallationStatus.run(memoKey, probe);
}

/**
 * Aggregate provider-owned installation state in registry order. `force` is
 * the manual "Check for updates" / "Recheck CLIs" path: it forgets every
 * settled installation answer and installed-only discovery probe first, so
 * the read that follows reflects the host right now rather than the last few
 * minutes. A probe already in flight is joined, not restarted: it describes
 * the host now as well, and the app only cancels the plain read it belongs
 * to client-side, so a clear() here would have the host run a second probe
 * set concurrently and then fence the first set's answer out of the memo.
 * The install route keeps clear(): there the in-flight probe is pre-install.
 */
export async function getProviderInstallations(
  deps: AppDeps,
  args: { hostId: string; force: boolean },
): Promise<ProviderCliStatusResponse> {
  if (args.force) {
    deps.lifecycleDedupers.providerInstallationStatus.forgetSettled();
    deps.lifecycleDedupers.installedProviderProbe.forgetSettled();
  }
  const deadline = Date.now() + PROVIDER_INSTALLATION_STATUS_TIMEOUT_MS;
  const providers = await listSystemProviderInfos(deps, {
    hostId: args.hostId,
    capability: "installation",
  });
  const entries = await mapProviderMaintenanceRequests(
    providers,
    async (provider): Promise<[string, ProviderCliStatus] | null> => {
      const bridgeLaunch = resolveBridgeLaunchForProviderId(deps, provider.id);
      if (bridgeLaunch === null) {
        deps.logger.warn(
          {
            failure: "bridge_unavailable",
            hostId: args.hostId,
            providerId: provider.id,
          },
          "Failed to load provider installation status; omitting provider",
        );
        return null;
      }
      const remainingMs = deadline - Date.now();
      if (remainingMs <= 0) {
        deps.logger.warn(
          {
            failure: "aggregate_deadline_exceeded",
            hostId: args.hostId,
            providerId: provider.id,
          },
          "Failed to load provider installation status; omitting provider",
        );
        return null;
      }
      try {
        const status = await readProviderInstallationStatusMemoized(deps, {
          hostId: args.hostId,
          timeoutMs: Math.min(COMMAND_TIMEOUT_MS, remainingMs),
          command: {
            type: "provider.installation.status",
            providerId: provider.id,
            bridgeLaunch,
          },
        });
        return [provider.id, { displayName: provider.displayName, ...status }];
      } catch (error) {
        if (!canOmitProviderInstallationStatusError(error)) {
          throw error;
        }
        deps.logger.warn(
          {
            failure: "status_request_failed",
            hostId: args.hostId,
            providerId: provider.id,
          },
          "Failed to load provider installation status; omitting provider",
        );
        return null;
      }
    },
  );
  return Object.fromEntries(
    entries.filter(
      (entry): entry is [string, ProviderCliStatus] => entry !== null,
    ),
  );
}

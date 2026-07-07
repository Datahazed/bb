import { join } from "node:path";
import { z } from "zod";

/**
 * Contract between the server and the bb-app launcher for in-place self
 * updates ("update when agents finish").
 *
 * Flow: the server stages an `npm install` of the target bb-app version under
 * the data dir, writes the sentinel file, and — once no agents are running —
 * exits with the reserved exit code. The launcher, seeing that exit code plus
 * a valid sentinel, restarts the server and host daemon from the staged
 * package root instead of the original install.
 */

/** Server exit code that asks the launcher to swap to the staged version. */
export const BB_SELF_UPDATE_EXIT_CODE = 75;

/**
 * Env var the bb-app launcher sets (truthy) on the server child to advertise
 * that it understands the self-update protocol. Absent under `bb-server`,
 * dev runs, and the desktop shell (which updates through electron-updater
 * instead), so old launchers can never be asked to perform a swap they don't
 * understand. The server parses it as a boolean, so the value carries no
 * version information — a protocol change needs a new variable.
 */
export const BB_SELF_UPDATE_PROTOCOL_ENV_NAME = "BB_SELF_UPDATE_PROTOCOL";

/**
 * How long agents must stay continuously idle before a deferred update
 * applies. Shared by the server's idle watcher and the desktop shell's
 * deferred relaunch so the two policies cannot drift. Sized to comfortably
 * exceed the 10s queued-message auto-send sweep, whose dispatch gaps make a
 * mid-chain thread look momentarily idle.
 */
export const BB_UPDATE_QUIET_PERIOD_MS = 45_000;

export const selfUpdateSentinelSchema = z.object({
  /** bb-app version staged and ready to swap to. */
  targetVersion: z.string().min(1),
  /** Absolute path of the staged bb-app package root (contains package.json). */
  stagedPackageRoot: z.string().min(1),
  /** ISO timestamp of when the user scheduled the update. */
  requestedAt: z.string().min(1),
});
export type SelfUpdateSentinel = z.infer<typeof selfUpdateSentinelSchema>;

export function formatSelfUpdateSentinelPath(dataDir: string): string {
  return join(dataDir, "self-update.json");
}

/** Root directory holding one staged install per version. */
export function formatSelfUpdateStagingRoot(dataDir: string): string {
  return join(dataDir, "self-update");
}

/** npm --prefix target for a staged version. */
export function formatSelfUpdateStagingDir(
  dataDir: string,
  version: string,
): string {
  return join(formatSelfUpdateStagingRoot(dataDir), version);
}

/** Package root of a staged install: `<staging dir>/node_modules/bb-app`. */
export function formatStagedPackageRoot(
  dataDir: string,
  version: string,
): string {
  return join(
    formatSelfUpdateStagingDir(dataDir, version),
    "node_modules",
    "bb-app",
  );
}

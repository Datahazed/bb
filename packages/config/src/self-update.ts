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
 * Env var the bb-app launcher sets on the server child to advertise that it
 * understands the self-update protocol. Absent under `bb-server`, dev runs,
 * and the desktop shell (which updates through electron-updater instead), so
 * old launchers can never be asked to perform a swap they don't understand.
 */
export const BB_SELF_UPDATE_PROTOCOL_ENV_NAME = "BB_SELF_UPDATE_PROTOCOL";
export const BB_SELF_UPDATE_PROTOCOL_VERSION = "1";

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

export function parseSelfUpdateSentinel(value: unknown): SelfUpdateSentinel {
  return selfUpdateSentinelSchema.parse(value);
}

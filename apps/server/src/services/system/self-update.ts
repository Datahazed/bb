import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import semver from "semver";
import { z } from "zod";
import {
  BB_SELF_UPDATE_EXIT_CODE,
  formatSelfUpdateSentinelPath,
  formatSelfUpdateStagingDir,
  formatSelfUpdateStagingRoot,
  formatStagedPackageRoot,
  selfUpdateSentinelSchema,
  type SelfUpdateSentinel,
} from "@bb/config/self-update";
import type { DbConnection } from "@bb/db";
import type {
  SystemSelfUpdateScheduled,
  SystemSelfUpdateState,
} from "@bb/server-contract";
import { ApiError } from "../../errors.js";
import type { ServerLogger, ServerRuntimeConfig } from "../../types.js";
import { countBusyThreads, isServerAtRest } from "./agent-activity.js";
import type { AppVersionService } from "./app-version.js";

const DEFAULT_POLL_INTERVAL_MS = 15_000;
/**
 * How long the server must see zero busy agents before it exits for the swap.
 * Covers the gaps where a thread is momentarily idle between a finished turn
 * and a queued follow-up or automation-triggered turn starting.
 */
const DEFAULT_QUIET_PERIOD_MS = 45_000;
const STAGING_INSTALL_TIMEOUT_MS = 10 * 60 * 1000;
const INSTALL_LOG_TAIL_CHARS = 2_000;

const stagedPackageJsonSchema = z
  .object({ version: z.string().min(1) })
  .passthrough();

export interface StagingInstallArgs {
  packageSpec: string;
  prefixDir: string;
}

export type RunStagingInstallFn = (args: StagingInstallArgs) => Promise<void>;

export interface SelfUpdateService {
  getState(): SystemSelfUpdateState;
  schedule(): Promise<SystemSelfUpdateState>;
  cancel(): Promise<SystemSelfUpdateState>;
  /** Adopt a sentinel left by a previous run and clean stale staged installs. */
  resume(): Promise<void>;
  stop(): void;
}

export interface CreateSelfUpdateServiceArgs {
  appVersion: AppVersionService;
  config: Pick<
    ServerRuntimeConfig,
    "appVersion" | "dataDir" | "isDevelopment" | "selfUpdateProtocol"
  >;
  db: DbConnection;
  logger: ServerLogger;
  /** Runs the graceful server shutdown before the process exits for the swap. */
  prepareShutdown: () => Promise<void>;
  /** Overrides for tests. Production uses the defaults. */
  exitProcess?: (code: number) => void;
  now?: () => number;
  pollIntervalMs?: number;
  quietPeriodMs?: number;
  runStagingInstall?: RunStagingInstallFn;
}

export function resolveNpmInvocation(env: NodeJS.ProcessEnv): {
  command: string;
  argsPrefix: string[];
} {
  // Only honor npm_execpath when it is actually npm: when bb was launched
  // from a pnpm/yarn-managed process the variable points at that tool, which
  // rejects the npm flags we pass.
  const npmExecPath = env.npm_execpath;
  if (
    npmExecPath !== undefined &&
    /\.(c|m)?js$/.test(npmExecPath) &&
    /(^|\/)npm(-cli)?\.(c|m)?js$/.test(npmExecPath)
  ) {
    return { command: process.execPath, argsPrefix: [npmExecPath] };
  }
  return { command: "npm", argsPrefix: [] };
}

async function runNpmStagingInstall(args: StagingInstallArgs): Promise<void> {
  const { command, argsPrefix } = resolveNpmInvocation(process.env);
  const installArgs = [
    ...argsPrefix,
    "install",
    args.packageSpec,
    "--prefix",
    args.prefixDir,
    "--no-audit",
    "--no-fund",
    "--loglevel",
    "error",
  ];

  await new Promise<void>((resolvePromise, rejectPromise) => {
    const child = spawn(command, installArgs, {
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let outputTail = "";
    const collect = (chunk: Buffer): void => {
      outputTail = (outputTail + chunk.toString("utf8")).slice(
        -INSTALL_LOG_TAIL_CHARS,
      );
    };
    child.stdout?.on("data", collect);
    child.stderr?.on("data", collect);

    const timeoutHandle = setTimeout(() => {
      child.kill("SIGKILL");
    }, STAGING_INSTALL_TIMEOUT_MS);
    timeoutHandle.unref();

    child.once("error", (error) => {
      clearTimeout(timeoutHandle);
      rejectPromise(
        new Error(`Failed to run ${command} for staging install: ${error.message}`),
      );
    });
    child.once("close", (code, signal) => {
      clearTimeout(timeoutHandle);
      if (code === 0) {
        resolvePromise();
        return;
      }
      const exitDescription =
        signal !== null ? `signal ${signal}` : `exit code ${code}`;
      rejectPromise(
        new Error(
          `npm install ${args.packageSpec} failed (${exitDescription})${
            outputTail.trim().length > 0 ? `: ${outputTail.trim()}` : ""
          }`,
        ),
      );
    });
  });
}

async function readStagedPackageVersion(
  stagedPackageRoot: string,
): Promise<string> {
  const rawContents = await readFile(
    join(stagedPackageRoot, "package.json"),
    "utf8",
  );
  return stagedPackageJsonSchema.parse(JSON.parse(rawContents)).version;
}

async function writeSentinelFile(
  dataDir: string,
  sentinel: SelfUpdateSentinel,
): Promise<void> {
  const sentinelPath = formatSelfUpdateSentinelPath(dataDir);
  const tempPath = join(
    dataDir,
    `.self-update.json.${process.pid}.${randomUUID()}.tmp`,
  );
  try {
    await writeFile(tempPath, `${JSON.stringify(sentinel, null, 2)}\n`, "utf8");
    await rename(tempPath, sentinelPath);
  } catch (error) {
    await rm(tempPath, { force: true }).catch(() => undefined);
    throw error;
  }
}

async function readSentinelFile(
  dataDir: string,
): Promise<SelfUpdateSentinel | null> {
  try {
    const rawContents = await readFile(
      formatSelfUpdateSentinelPath(dataDir),
      "utf8",
    );
    return selfUpdateSentinelSchema.parse(JSON.parse(rawContents));
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

export function createSelfUpdateService(
  args: CreateSelfUpdateServiceArgs,
): SelfUpdateService {
  const { appVersion, config, db, logger } = args;
  const capable = config.selfUpdateProtocol && !config.isDevelopment;
  const exitProcess = args.exitProcess ?? ((code: number) => process.exit(code));
  const now = args.now ?? (() => Date.now());
  const pollIntervalMs = args.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const quietPeriodMs = args.quietPeriodMs ?? DEFAULT_QUIET_PERIOD_MS;
  const runStagingInstall = args.runStagingInstall ?? runNpmStagingInstall;

  let scheduled: SystemSelfUpdateScheduled | null = null;
  let lastError: string | null = null;
  let idleSince: number | null = null;
  // Set once any busy agent is seen after arming; from then on the full
  // quiet period applies (mid-chain idle gaps look like rest otherwise).
  let busyObservedSinceArm = false;
  let watcherHandle: ReturnType<typeof setInterval> | null = null;
  let exiting = false;
  // Bumped on cancel/re-schedule so an in-flight staging install of a stale
  // schedule can't adopt state when it eventually finishes.
  let scheduleGeneration = 0;

  function getState(): SystemSelfUpdateState {
    return { capable, scheduled, lastError };
  }

  function hasBusyThreads(): boolean {
    return countBusyThreads(db) > 0;
  }

  function stopWatcher(): void {
    if (watcherHandle !== null) {
      clearInterval(watcherHandle);
      watcherHandle = null;
    }
    idleSince = null;
  }

  function startWatcher(): void {
    if (watcherHandle !== null) {
      return;
    }
    idleSince = null;
    busyObservedSinceArm = false;
    watcherHandle = setInterval(() => {
      try {
        watcherTick();
      } catch (error) {
        logger.warn({ err: error }, "Self-update idle check failed");
        idleSince = null;
      }
    }, pollIntervalMs);
    watcherHandle.unref();
    // Check immediately so an already-idle server doesn't wait a full poll
    // interval before the quiet period starts counting.
    watcherTick();
  }

  function watcherTick(): void {
    if (scheduled === null || scheduled.phase !== "waiting" || exiting) {
      stopWatcher();
      return;
    }
    if (hasBusyThreads()) {
      busyObservedSinceArm = true;
      idleSince = null;
      return;
    }
    // "Update now": scheduled while nothing was running and nothing is
    // queued to start — no mid-chain gap to protect, so skip the quiet
    // period. Once any busy agent has been seen, the full period applies.
    if (!busyObservedSinceArm && isServerAtRest(db)) {
      triggerExitForSwap();
      return;
    }
    if (idleSince === null) {
      idleSince = now();
      return;
    }
    if (now() - idleSince < quietPeriodMs) {
      return;
    }
    triggerExitForSwap();
  }

  function triggerExitForSwap(): void {
    if (exiting || scheduled === null) {
      return;
    }
    exiting = true;
    stopWatcher();
    logger.info(
      { targetVersion: scheduled.targetVersion },
      "No agents running - exiting so the launcher can apply the staged update",
    );
    void args
      .prepareShutdown()
      .catch((error) => {
        logger.warn({ err: error }, "Graceful shutdown before update failed");
      })
      .finally(() => {
        exitProcess(BB_SELF_UPDATE_EXIT_CODE);
      });
  }

  async function removeStagedVersion(targetVersion: string): Promise<void> {
    await rm(formatSelfUpdateStagingDir(config.dataDir, targetVersion), {
      force: true,
      recursive: true,
    }).catch(() => undefined);
  }

  /**
   * Remove staged installs for versions that are neither the running version
   * (the server may have been started from that staged root by the launcher)
   * nor a pending schedule target.
   */
  async function cleanupStaleStaging(): Promise<void> {
    const stagingRoot = formatSelfUpdateStagingRoot(config.dataDir);
    let entries: string[];
    try {
      entries = await readdir(stagingRoot);
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry === config.appVersion || entry === scheduled?.targetVersion) {
        continue;
      }
      await rm(join(stagingRoot, entry), {
        force: true,
        recursive: true,
      }).catch(() => undefined);
    }
  }

  async function stageAndArm(
    targetVersion: string,
    requestedAt: string,
    generation: number,
  ): Promise<void> {
    const stagingDir = formatSelfUpdateStagingDir(config.dataDir, targetVersion);
    const stagedPackageRoot = formatStagedPackageRoot(
      config.dataDir,
      targetVersion,
    );
    try {
      await mkdir(stagingDir, { recursive: true });
      await runStagingInstall({
        packageSpec: `bb-app@${targetVersion}`,
        prefixDir: stagingDir,
      });
      const stagedVersion = await readStagedPackageVersion(stagedPackageRoot);
      if (stagedVersion !== targetVersion) {
        throw new Error(
          `Staged bb-app version ${stagedVersion} does not match requested ${targetVersion}`,
        );
      }
      if (generation !== scheduleGeneration) {
        // Cancelled (or re-scheduled) while installing; the staging dir was
        // already queued for removal by cancel().
        return;
      }
      await writeSentinelFile(config.dataDir, {
        targetVersion,
        stagedPackageRoot,
        requestedAt,
      });
      scheduled = { targetVersion, requestedAt, phase: "waiting" };
      logger.info(
        { targetVersion },
        "Self-update staged - waiting for agents to finish",
      );
      startWatcher();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.warn(
        { err: error, targetVersion },
        "Failed to stage self-update",
      );
      if (generation === scheduleGeneration) {
        // Stale generations must not touch the dir: a newer schedule for the
        // same version may be staging into it right now. cancel()/boot
        // cleanup remove their leftovers.
        await removeStagedVersion(targetVersion);
        scheduled = null;
        lastError = message;
      }
    }
  }

  async function schedule(): Promise<SystemSelfUpdateState> {
    if (!capable) {
      throw new ApiError(
        409,
        "self_update_unavailable",
        "This server is not managed by a bb-app launcher that supports scheduled updates. Restart bb-app manually to update.",
      );
    }
    const versionInfo = await appVersion.getSystemVersion();
    if (!versionInfo.updateAvailable || versionInfo.latestVersion === null) {
      throw new ApiError(409, "no_update_available", "bb is already up to date.");
    }
    const targetVersion = versionInfo.latestVersion;
    if (scheduled !== null && scheduled.targetVersion === targetVersion) {
      return getState();
    }
    if (scheduled !== null) {
      await clearSchedule();
    }

    lastError = null;
    const requestedAt = new Date(now()).toISOString();
    scheduled = { targetVersion, requestedAt, phase: "staging" };
    const generation = scheduleGeneration;
    void stageAndArm(targetVersion, requestedAt, generation);
    return getState();
  }

  async function clearSchedule(): Promise<void> {
    const previous = scheduled;
    scheduled = null;
    scheduleGeneration += 1;
    stopWatcher();
    await rm(formatSelfUpdateSentinelPath(config.dataDir), {
      force: true,
    }).catch(() => undefined);
    if (previous !== null) {
      await removeStagedVersion(previous.targetVersion);
    }
  }

  async function cancel(): Promise<SystemSelfUpdateState> {
    if (scheduled !== null) {
      logger.info(
        { targetVersion: scheduled.targetVersion },
        "Cancelled scheduled self-update",
      );
      await clearSchedule();
    }
    return getState();
  }

  async function resume(): Promise<void> {
    if (!capable) {
      return;
    }
    let sentinel: SelfUpdateSentinel | null = null;
    try {
      sentinel = await readSentinelFile(config.dataDir);
    } catch (error) {
      logger.warn({ err: error }, "Ignoring unreadable self-update sentinel");
      await rm(formatSelfUpdateSentinelPath(config.dataDir), {
        force: true,
      }).catch(() => undefined);
    }

    if (sentinel !== null) {
      const targetIsNewer =
        semver.valid(sentinel.targetVersion) !== null &&
        semver.valid(config.appVersion) !== null &&
        semver.gt(sentinel.targetVersion, config.appVersion);
      let stagedVersionMatches = false;
      if (targetIsNewer) {
        stagedVersionMatches = await readStagedPackageVersion(
          sentinel.stagedPackageRoot,
        )
          .then((version) => version === sentinel.targetVersion)
          .catch(() => false);
      }
      if (targetIsNewer && stagedVersionMatches) {
        scheduled = {
          targetVersion: sentinel.targetVersion,
          requestedAt: sentinel.requestedAt,
          phase: "waiting",
        };
        logger.info(
          { targetVersion: sentinel.targetVersion },
          "Resuming scheduled self-update from previous run",
        );
        startWatcher();
      } else {
        await rm(formatSelfUpdateSentinelPath(config.dataDir), {
          force: true,
        }).catch(() => undefined);
      }
    }

    await cleanupStaleStaging();
  }

  function stop(): void {
    stopWatcher();
  }

  return { getState, schedule, cancel, resume, stop };
}

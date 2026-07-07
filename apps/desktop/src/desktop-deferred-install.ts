import { z } from "zod";
import { BB_UPDATE_QUIET_PERIOD_MS } from "@bb/config/self-update";
import type { DesktopAutoUpdateLogger } from "./desktop-auto-update.js";

const DEFERRED_INSTALL_POLL_INTERVAL_MS = 15_000;
const ACTIVITY_FETCH_TIMEOUT_MS = 5_000;

const agentActivityResponseSchema = z
  .object({
    busyThreadCount: z.number().int().min(0),
  })
  .passthrough();

export interface DeferredInstallProbe {
  /** /system/agents/activity URL of the shell-owned runtime. */
  activityUrl: string;
}

export interface CreateDeferredInstallControllerArgs {
  /**
   * Where to poll for agent activity, or null when the shell does not own a
   * local runtime (attached/remote servers keep their agents across a shell
   * relaunch, so deferral is meaningless there).
   */
  getProbe: () => DeferredInstallProbe | null;
  /** Whether a downloaded update is ready to install right now. */
  isUpdateDownloaded: () => boolean;
  /** Performs the actual quit-and-install relaunch. */
  installUpdate: () => Promise<void> | void;
  logger: DesktopAutoUpdateLogger;
  /** Overrides for tests. Production uses the defaults. */
  fetchImpl?: typeof fetch;
  now?: () => number;
  pollIntervalMs?: number;
  quietPeriodMs?: number;
}

export interface DeferredInstallController {
  /** True when a deferred install can be offered (owned runtime present). */
  canDefer(): boolean;
  cancel(): void;
  /** True while a deferred install is pending. */
  isPending(): boolean;
  /** Returns true when the deferral was accepted and polling started. */
  request(): boolean;
  stop(): void;
  subscribe(listener: () => void): () => void;
}

export function createDeferredInstallController(
  args: CreateDeferredInstallControllerArgs,
): DeferredInstallController {
  const fetchImpl = args.fetchImpl ?? fetch;
  const now = args.now ?? (() => Date.now());
  const pollIntervalMs = args.pollIntervalMs ?? DEFERRED_INSTALL_POLL_INTERVAL_MS;
  const quietPeriodMs = args.quietPeriodMs ?? BB_UPDATE_QUIET_PERIOD_MS;

  let pending = false;
  let idleSince: number | null = null;
  let pollHandle: ReturnType<typeof setInterval> | null = null;
  let installing = false;
  const listeners = new Set<() => void>();

  function notify(): void {
    for (const listener of listeners) {
      listener();
    }
  }

  function clear(): void {
    if (pollHandle !== null) {
      clearInterval(pollHandle);
      pollHandle = null;
    }
    idleSince = null;
    if (pending) {
      pending = false;
      notify();
    }
  }

  async function fetchBusyThreadCount(activityUrl: string): Promise<number> {
    const controller = new AbortController();
    const timeoutHandle = setTimeout(
      () => controller.abort(),
      ACTIVITY_FETCH_TIMEOUT_MS,
    );
    try {
      const response = await fetchImpl(activityUrl, {
        headers: { accept: "application/json" },
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      return agentActivityResponseSchema.parse(await response.json())
        .busyThreadCount;
    } finally {
      clearTimeout(timeoutHandle);
    }
  }

  async function tick(): Promise<void> {
    if (!pending || installing) {
      return;
    }
    if (!args.isUpdateDownloaded()) {
      // The pending update went away (e.g. a newer check reset it); the
      // deferral no longer has anything to install.
      args.logger.info(
        "Deferred desktop install cancelled: no downloaded update is pending.",
      );
      clear();
      return;
    }
    const probe = args.getProbe();
    if (probe === null) {
      args.logger.info(
        "Deferred desktop install cancelled: no owned runtime to watch.",
      );
      clear();
      return;
    }

    let busyThreadCount: number;
    try {
      busyThreadCount = await fetchBusyThreadCount(probe.activityUrl);
    } catch {
      // Unreachable server counts as busy: don't relaunch on missing data.
      idleSince = null;
      return;
    }

    if (busyThreadCount > 0) {
      idleSince = null;
      return;
    }
    if (idleSince === null) {
      idleSince = now();
      return;
    }
    if (now() - idleSince < quietPeriodMs) {
      return;
    }

    installing = true;
    args.logger.info(
      "No agents running - relaunching to install the desktop update.",
    );
    try {
      await args.installUpdate();
    } catch (error) {
      installing = false;
      idleSince = null;
      args.logger.error(
        `Deferred desktop install failed to relaunch; will retry when idle: ${String(error)}`,
      );
    }
  }

  return {
    canDefer(): boolean {
      return args.getProbe() !== null;
    },
    cancel(): void {
      if (pending) {
        args.logger.info("Deferred desktop install cancelled by user.");
      }
      clear();
    },
    isPending(): boolean {
      return pending;
    },
    request(): boolean {
      if (!args.isUpdateDownloaded() || args.getProbe() === null) {
        return false;
      }
      if (pending) {
        return true;
      }
      pending = true;
      idleSince = null;
      pollHandle = setInterval(() => {
        void tick();
      }, pollIntervalMs);
      pollHandle.unref();
      void tick();
      notify();
      return true;
    },
    stop(): void {
      if (pollHandle !== null) {
        clearInterval(pollHandle);
        pollHandle = null;
      }
    },
    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

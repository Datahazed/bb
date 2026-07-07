import { useEffect, useRef, useState } from "react";
import { appToast } from "@/components/ui/app-toast";
import type { BbDesktopApi, BbDesktopInfo } from "@bb/desktop-contract";
import type { SystemSelfUpdateScheduled } from "@bb/server-contract";
import { getBbDesktopInfo } from "@/lib/bb-desktop";
import {
  useAgentsBusy,
  useCancelSelfUpdate,
  useScheduleSelfUpdate,
  useSystemVersion,
} from "./queries/system-queries";

const DISMISSED_STORAGE_KEY_PREFIX = "bb:update-toast:dismissed:";
/** Set just before the post-update reload so the fresh page can announce it. */
const UPDATED_SESSION_KEY = "bb:update-toast:completed";

interface VersionDismissalArgs {
  latestVersion: string;
  storageKeyPrefix: string;
}

interface DesktopToastActionArgs {
  desktopApi: BbDesktopApi;
  latestVersion: string;
}

function getLocalStorage(): Storage | null {
  if (typeof window === "undefined") {
    return null;
  }
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function isDismissedForVersion(args: VersionDismissalArgs): boolean {
  const storage = getLocalStorage();
  if (storage === null) {
    return false;
  }
  try {
    return (
      storage.getItem(`${args.storageKeyPrefix}${args.latestVersion}`) ===
      "true"
    );
  } catch {
    return false;
  }
}

function markDismissedForVersion(args: VersionDismissalArgs): void {
  const storage = getLocalStorage();
  if (storage === null) {
    return;
  }
  try {
    storage.setItem(`${args.storageKeyPrefix}${args.latestVersion}`, "true");
  } catch {
    // localStorage may be disabled; the in-memory ref keeps the toast hidden
    // for the rest of this session.
  }
}

/**
 * Scheduling dismisses the toast programmatically, which also fires
 * onDismiss and records a dismissal; clear it so cancelling the schedule
 * brings the update offer back.
 */
function clearDismissedForVersion(args: VersionDismissalArgs): void {
  const storage = getLocalStorage();
  if (storage === null) {
    return;
  }
  try {
    storage.removeItem(`${args.storageKeyPrefix}${args.latestVersion}`);
  } catch {
    // Ignore; worst case the toast stays hidden until reload.
  }
}

function availableToastTitle(latestVersion: string): string {
  return `bb-app ${latestVersion} available`;
}

/**
 * Reload into the post-update frontend, but only once the just-restarted
 * server actually serves the app shell — reloading mid-restart fails module
 * fetches, which never retry and strand a blank page (index.html's boot
 * watchdog is the second line of defense).
 */
async function reloadWhenShellServable(): Promise<void> {
  for (let attempt = 0; attempt < 15; attempt += 1) {
    try {
      const response = await fetch("/", { cache: "no-store" });
      if (response.ok) {
        break;
      }
    } catch {
      // Server still restarting; retry below.
    }
    await new Promise((resolve) => {
      setTimeout(resolve, 1_000);
    });
  }
  window.location.reload();
}

function scheduledUpdateToastId(targetVersion: string): string {
  return `bb-update-scheduled:${targetVersion}`;
}

function scheduledUpdateTitle(scheduled: SystemSelfUpdateScheduled): string {
  if (scheduled.mode === "now") {
    return `Updating to ${scheduled.targetVersion} now…`;
  }
  return scheduled.phase === "staging"
    ? `Preparing update to ${scheduled.targetVersion}…`
    : `Updating to ${scheduled.targetVersion} when idle`;
}

function desktopDeferredToastId(latestVersion: string): string {
  return `bb-desktop-update-deferred:${latestVersion}`;
}

function relaunchDesktopUpdate(args: DesktopToastActionArgs): void {
  void args.desktopApi.installUpdate().catch(() => undefined);
  appToast.dismiss(`bb-desktop-update-ready:${args.latestVersion}`);
}

function deferDesktopUpdate(args: DesktopToastActionArgs): void {
  void args.desktopApi.installUpdateWhenIdle?.().catch(() => undefined);
  appToast.dismiss(`bb-desktop-update-ready:${args.latestVersion}`);
}

function cancelDeferredDesktopUpdate(args: DesktopToastActionArgs): void {
  void args.desktopApi.cancelDeferredInstall?.().catch(() => undefined);
  appToast.dismiss(desktopDeferredToastId(args.latestVersion));
}

export function useUpdateAvailableToast(): void {
  const { data } = useSystemVersion();
  const scheduleSelfUpdate = useScheduleSelfUpdate();
  const cancelSelfUpdate = useCancelSelfUpdate();
  // Live agent load decides the action label: "Update now" when nothing is
  // running, "Update when idle" otherwise. Only polled while the
  // choice is actually on screen.
  const activityEnabled =
    getBbDesktopInfo() === null &&
    data !== undefined &&
    !data.isDevelopment &&
    data.updateAvailable &&
    data.selfUpdate.capable &&
    data.selfUpdate.scheduled === null;
  const agentsBusy = useAgentsBusy({ enabled: activityEnabled });
  const shownForVersionRef = useRef<string | null>(null);
  /** id of the scheduled-update toast currently on screen (version + phase). */
  const scheduledToastKeyRef = useRef<string | null>(null);
  /** Target of the schedule we last saw, to detect completion and failure. */
  const watchedTargetVersionRef = useRef<string | null>(null);
  const reportedErrorRef = useRef<string | null>(null);

  const scheduleMutate = scheduleSelfUpdate.mutate;
  const cancelMutate = cancelSelfUpdate.mutate;

  // Announce a completed update after the post-update reload, from the fresh
  // bundle. Session storage survives the reload but not the tab.
  useEffect(() => {
    try {
      const updatedVersion = sessionStorage.getItem(UPDATED_SESSION_KEY);
      if (updatedVersion !== null) {
        sessionStorage.removeItem(UPDATED_SESSION_KEY);
        appToast.success("bb-app updated", {
          description: `bb is now running ${updatedVersion}.`,
        });
      }
    } catch {
      // Session storage may be unavailable; skip the announcement.
    }
  }, []);

  useEffect(() => {
    if (!data) {
      return;
    }
    if (getBbDesktopInfo() !== null) {
      return;
    }
    if (data.isDevelopment) {
      return;
    }

    const { selfUpdate } = data;
    const watchedTargetVersion = watchedTargetVersionRef.current;

    if (selfUpdate.scheduled !== null) {
      const scheduled = selfUpdate.scheduled;
      watchedTargetVersionRef.current = scheduled.targetVersion;
      reportedErrorRef.current = null;
      // The plain "update available" toast is superseded by the scheduled one.
      if (data.latestVersion !== null) {
        appToast.dismiss(`bb-update-available:${data.latestVersion}`);
      }
      // Allow the "update available" toast to come back if this schedule is
      // cancelled later.
      shownForVersionRef.current = null;
      const toastKey = `${scheduled.targetVersion}:${scheduled.phase}:${scheduled.mode}`;
      if (scheduledToastKeyRef.current === toastKey) {
        return;
      }
      scheduledToastKeyRef.current = toastKey;
      const toastId = scheduledUpdateToastId(scheduled.targetVersion);
      appToast.message(scheduledUpdateTitle(scheduled), {
        id: toastId,
        duration: Infinity,
        // X hides the toast; the update itself continues.
        showCloseButton: true,
        cancel: {
          label: "Cancel update",
          onClick: () => {
            cancelMutate();
            appToast.dismiss(toastId);
          },
        },
      });
      return;
    }

    scheduledToastKeyRef.current = null;

    if (watchedTargetVersion !== null) {
      appToast.dismiss(scheduledUpdateToastId(watchedTargetVersion));
      if (data.currentVersion === watchedTargetVersion) {
        watchedTargetVersionRef.current = null;
        // The page is still running the pre-update frontend bundle; reload to
        // pick up the new one. The session flag re-announces after reload.
        try {
          sessionStorage.setItem(UPDATED_SESSION_KEY, data.currentVersion);
        } catch {
          // Reload anyway; only the announcement is lost.
        }
        void reloadWhenShellServable();
        return;
      }
      if (
        selfUpdate.lastError !== null &&
        reportedErrorRef.current !== selfUpdate.lastError
      ) {
        watchedTargetVersionRef.current = null;
        reportedErrorRef.current = selfUpdate.lastError;
        appToast.error("bb-app update failed", {
          description: selfUpdate.lastError,
        });
        return;
      }
      // Cancelled (here or from another client): fall through so the plain
      // "update available" toast can show again.
      watchedTargetVersionRef.current = null;
    }

    if (!data.updateAvailable) {
      return;
    }
    const { latestVersion } = data;
    if (latestVersion === null) {
      return;
    }
    // Keyed on busy state too, so the action label flips live when agents
    // start or finish while the toast is up.
    const availableKey = selfUpdate.capable
      ? `${latestVersion}:${agentsBusy ? "busy" : "idle"}`
      : latestVersion;
    if (shownForVersionRef.current === availableKey) {
      return;
    }
    if (
      isDismissedForVersion({
        latestVersion,
        storageKeyPrefix: DISMISSED_STORAGE_KEY_PREFIX,
      })
    ) {
      shownForVersionRef.current = availableKey;
      return;
    }
    shownForVersionRef.current = availableKey;
    const availableToastId = `bb-update-available:${latestVersion}`;
    const scheduleUpdate = (mode: "when-idle" | "now"): void => {
      scheduleMutate(mode, {
        onError: (error) => {
          appToast.error("Could not schedule the update", {
            description:
              error instanceof Error ? error.message : String(error),
          });
        },
      });
      appToast.dismiss(availableToastId);
      // Programmatic dismissal above also fires onDismiss; scheduling is not
      // a dismissal, so undo the recorded one.
      clearDismissedForVersion({
        latestVersion,
        storageKeyPrefix: DISMISSED_STORAGE_KEY_PREFIX,
      });
    };
    appToast.message(availableToastTitle(latestVersion), {
      id: availableToastId,
      duration: Infinity,
      // The corner X is the dismissal; it routes through onDismiss below.
      showCloseButton: true,
      ...(selfUpdate.capable
        ? agentsBusy
          ? {
              // Defer (safe default) or explicitly interrupt running agents.
              action: {
                label: "Update when idle",
                onClick: () => {
                  scheduleUpdate("when-idle");
                },
              },
              cancel: {
                label: "Update now",
                onClick: () => {
                  scheduleUpdate("now");
                },
              },
            }
          : {
              // At rest, when-idle's fast path already applies immediately —
              // and unlike mode "now" it still backs off if an agent starts
              // during staging.
              action: {
                label: "Update now",
                onClick: () => {
                  scheduleUpdate("when-idle");
                },
              },
            }
        : { description: "Restart bb-app to update." }),
      onDismiss: () => {
        markDismissedForVersion({
          latestVersion,
          storageKeyPrefix: DISMISSED_STORAGE_KEY_PREFIX,
        });
      },
    });
  }, [data, agentsBusy, scheduleMutate, cancelMutate]);
}

export function useDesktopUpdateAvailableToast(): void {
  const [desktopApi, setDesktopApi] = useState<BbDesktopApi | null>(null);
  const [desktopInfo, setDesktopInfo] = useState<BbDesktopInfo | null>(null);
  // The SPA in the desktop shell talks to the shell-owned server, so the same
  // activity endpoint decides "Relaunch now" vs the deferred option.
  const activityEnabled =
    desktopInfo !== null &&
    desktopInfo.updateDownloaded &&
    desktopInfo.deferredInstall !== true &&
    desktopInfo.canDeferInstall === true;
  const agentsBusy = useAgentsBusy({ enabled: activityEnabled });
  const shownForVersionRef = useRef<string | null>(null);

  useEffect(() => {
    const desktopApi = getBbDesktopInfo();
    if (desktopApi === null) {
      return;
    }
    setDesktopApi(desktopApi);

    let mounted = true;
    void desktopApi
      .getInfo()
      .then((info) => {
        if (mounted) {
          setDesktopInfo(info);
        }
      })
      .catch(() => undefined);
    const unsubscribe = desktopApi.onChange((info) => {
      setDesktopInfo(info);
    });

    return () => {
      mounted = false;
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (desktopInfo === null) {
      return;
    }
    if (desktopApi === null) {
      return;
    }
    if (!desktopInfo.updateDownloaded) {
      return;
    }
    const latestVersion =
      desktopInfo.pendingVersion !== null
        ? desktopInfo.pendingVersion
        : desktopInfo.latestVersion;
    if (latestVersion === null) {
      return;
    }

    if (desktopInfo.deferredInstall === true) {
      const deferredKey = `${latestVersion}:deferred`;
      if (shownForVersionRef.current === deferredKey) {
        return;
      }
      shownForVersionRef.current = deferredKey;
      appToast.dismiss(`bb-desktop-update-ready:${latestVersion}`);
      appToast.message(`Relaunching to ${latestVersion} when idle`, {
        id: desktopDeferredToastId(latestVersion),
        duration: Infinity,
        // X hides the toast; the deferred relaunch itself continues.
        showCloseButton: true,
        cancel: {
          label: "Cancel update",
          onClick: () => {
            cancelDeferredDesktopUpdate({ desktopApi, latestVersion });
          },
        },
      });
      return;
    }

    // Only offer "Relaunch when idle" when the shell owns a local runtime a
    // relaunch would interrupt, it's new enough to support deferral, and
    // agents are actually working; at rest a plain relaunch loses nothing.
    const canDefer =
      desktopInfo.canDeferInstall === true &&
      typeof desktopApi.installUpdateWhenIdle === "function" &&
      agentsBusy;
    const readyKey = `${latestVersion}:ready:${canDefer ? "busy" : "idle"}`;
    if (shownForVersionRef.current === readyKey) {
      return;
    }
    shownForVersionRef.current = readyKey;
    appToast.dismiss(desktopDeferredToastId(latestVersion));
    appToast.message(`bb desktop ${latestVersion} ready`, {
      id: `bb-desktop-update-ready:${latestVersion}`,
      duration: Infinity,
      showCloseButton: true,
      action: canDefer
        ? {
            label: "Relaunch when idle",
            onClick: () => {
              deferDesktopUpdate({ desktopApi, latestVersion });
            },
          }
        : {
            label: "Relaunch",
            onClick: () => {
              relaunchDesktopUpdate({ desktopApi, latestVersion });
            },
          },
      ...(canDefer
        ? {
            cancel: {
              label: "Relaunch now",
              onClick: () => {
                relaunchDesktopUpdate({ desktopApi, latestVersion });
              },
            },
          }
        : {}),
    });
  }, [desktopApi, desktopInfo, agentsBusy]);
}

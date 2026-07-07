import { useEffect, useRef, useState } from "react";
import { appToast } from "@/components/ui/app-toast";
import type { BbDesktopApi, BbDesktopInfo } from "@bb/desktop-contract";
import type { SystemSelfUpdateScheduled } from "@bb/server-contract";
import { getBbDesktopInfo } from "@/lib/bb-desktop";
import {
  useCancelSelfUpdate,
  useScheduleSelfUpdate,
  useSystemVersion,
} from "./queries/system-queries";

const DISMISSED_STORAGE_KEY_PREFIX = "bb:update-toast:dismissed:";

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

function appUpdateDescription(latestVersion: string): string {
  return `${latestVersion} is available. Restart bb-app to update.`;
}

function scheduledUpdateToastId(targetVersion: string): string {
  return `bb-update-scheduled:${targetVersion}`;
}

function scheduledUpdateDescription(
  scheduled: SystemSelfUpdateScheduled,
): string {
  return scheduled.phase === "staging"
    ? `Preparing update to ${scheduled.targetVersion}…`
    : `bb will update to ${scheduled.targetVersion} once no agents are running.`;
}

function desktopReadyToastDescription(latestVersion: string): string {
  return `bb desktop ${latestVersion} is ready to install.`;
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
  const shownForVersionRef = useRef<string | null>(null);
  /** id of the scheduled-update toast currently on screen (version + phase). */
  const scheduledToastKeyRef = useRef<string | null>(null);
  /** Target of the schedule we last saw, to detect completion and failure. */
  const watchedTargetVersionRef = useRef<string | null>(null);
  const reportedErrorRef = useRef<string | null>(null);

  const scheduleMutate = scheduleSelfUpdate.mutate;
  const cancelMutate = cancelSelfUpdate.mutate;

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
      const toastKey = `${scheduled.targetVersion}:${scheduled.phase}`;
      if (scheduledToastKeyRef.current === toastKey) {
        return;
      }
      scheduledToastKeyRef.current = toastKey;
      const toastId = scheduledUpdateToastId(scheduled.targetVersion);
      appToast.message("bb-app update scheduled", {
        id: toastId,
        description: scheduledUpdateDescription(scheduled),
        duration: Infinity,
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
        appToast.success("bb-app updated", {
          description: `bb is now running ${data.currentVersion}.`,
        });
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
    if (shownForVersionRef.current === latestVersion) {
      return;
    }
    if (
      isDismissedForVersion({
        latestVersion,
        storageKeyPrefix: DISMISSED_STORAGE_KEY_PREFIX,
      })
    ) {
      shownForVersionRef.current = latestVersion;
      return;
    }
    shownForVersionRef.current = latestVersion;
    const availableToastId = `bb-update-available:${latestVersion}`;
    appToast.message("bb-app update available", {
      id: availableToastId,
      description: selfUpdate.capable
        ? `${latestVersion} is available.`
        : appUpdateDescription(latestVersion),
      duration: Infinity,
      ...(selfUpdate.capable
        ? {
            action: {
              label: "Update when agents finish",
              onClick: () => {
                scheduleMutate(undefined, {
                  onError: (error) => {
                    appToast.error("Could not schedule the update", {
                      description:
                        error instanceof Error ? error.message : String(error),
                    });
                  },
                });
                appToast.dismiss(availableToastId);
              },
            },
          }
        : {}),
      cancel: {
        label: "Dismiss",
        onClick: () => {
          markDismissedForVersion({
            latestVersion,
            storageKeyPrefix: DISMISSED_STORAGE_KEY_PREFIX,
          });
          appToast.dismiss(availableToastId);
        },
      },
      onDismiss: () => {
        markDismissedForVersion({
          latestVersion,
          storageKeyPrefix: DISMISSED_STORAGE_KEY_PREFIX,
        });
      },
    });
  }, [data, scheduleMutate, cancelMutate]);
}

export function useDesktopUpdateAvailableToast(): void {
  const [desktopApi, setDesktopApi] = useState<BbDesktopApi | null>(null);
  const [desktopInfo, setDesktopInfo] = useState<BbDesktopInfo | null>(null);
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

    const deferredInstall = desktopInfo.deferredInstall ?? null;
    if (deferredInstall !== null) {
      const deferredKey = `${latestVersion}:deferred`;
      if (shownForVersionRef.current === deferredKey) {
        return;
      }
      shownForVersionRef.current = deferredKey;
      appToast.dismiss(`bb-desktop-update-ready:${latestVersion}`);
      appToast.message("Desktop update scheduled", {
        id: desktopDeferredToastId(latestVersion),
        description: `bb desktop will relaunch to ${latestVersion} once no agents are running.`,
        duration: Infinity,
        cancel: {
          label: "Cancel update",
          onClick: () => {
            cancelDeferredDesktopUpdate({ desktopApi, latestVersion });
          },
        },
      });
      return;
    }

    // Only offer "when agents finish" when the shell owns a local runtime a
    // relaunch would interrupt and is new enough to support deferral.
    const canDefer =
      desktopInfo.canDeferInstall === true &&
      typeof desktopApi.installUpdateWhenIdle === "function";
    const readyKey = `${latestVersion}:ready`;
    if (shownForVersionRef.current === readyKey) {
      return;
    }
    shownForVersionRef.current = readyKey;
    appToast.dismiss(desktopDeferredToastId(latestVersion));
    appToast.message("Desktop update ready", {
      id: `bb-desktop-update-ready:${latestVersion}`,
      description: desktopReadyToastDescription(latestVersion),
      duration: Infinity,
      action: canDefer
        ? {
            label: "Relaunch when agents finish",
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
  }, [desktopApi, desktopInfo]);
}

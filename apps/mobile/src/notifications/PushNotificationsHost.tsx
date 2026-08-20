import * as Notifications from "expo-notifications";
import { usePathname } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppState, type AppStateStatus } from "react-native";
import {
  pathnameIsThread,
  useOpenThreadInProfile,
  useProfiles,
  useRealtimeConnectionState,
} from "@/app-shell";
import {
  parsePushNotificationData,
  resolvePushTargetProfile,
  type PushNotificationTarget,
  type PushSyncProfile,
} from "@/data/notifications";
import type { ServerProfile } from "@/lib/profiles";
import { ActionSheet, toast, useSheet } from "@/ui";
import { AppBadgeSync } from "./AppBadgeSync";
import { getPushNotificationsModule } from "./expo-push-module";
import { getPushRegistrationController } from "./push-controller";
import { getPushStore } from "./push-storage";
import { hasThreadOnServer } from "./thread-probe";
import { usePushStoreSnapshot } from "./use-push-store";

/**
 * Everything push-related that must run while the app is up, mounted once
 * inside the ProfilesProvider + SheetProvider:
 *
 * - keeps the active profile's registration in sync (on connect, on
 *   AppState active, on a token roll, when the toggle changes) and removes
 *   registrations of profiles the user deleted;
 * - routes notification taps (cold start, background, foreground) to the
 *   thread on the right profile; foreground arrivals become a toast with
 *   "Open" instead of a system banner;
 * - mirrors the unread / pending count onto the app icon badge;
 * - asks for the OS permission once, after the first successful connection
 *   (never on launch), when the app can actually mint a token.
 */
export function PushNotificationsHost() {
  const { status, profiles, activeProfile, connection } = useProfiles();
  const realtimeState = useRealtimeConnectionState();
  const connected = connection !== null && realtimeState === "connected";
  const controller = getPushRegistrationController();
  const notifications = getPushNotificationsModule();
  const storeSnapshot = usePushStoreSnapshot();
  const openThreadInProfile = useOpenThreadInProfile();
  const pathname = usePathname();

  // Latest values for listeners that are registered once.
  const profilesRef = useRef(profiles);
  const activeProfileIdRef = useRef(activeProfile?.id ?? null);
  const pathnameRef = useRef(pathname);
  useEffect(() => {
    profilesRef.current = profiles;
    activeProfileIdRef.current = activeProfile?.id ?? null;
    pathnameRef.current = pathname;
  }, [profiles, activeProfile, pathname]);

  const syncProfile = useMemo<PushSyncProfile | null>(
    () =>
      activeProfile
        ? { id: activeProfile.id, serverUrl: activeProfile.serverUrl }
        : null,
    [activeProfile],
  );
  const activeEnabled =
    syncProfile !== null &&
    storeSnapshot.enabledProfileIds.includes(syncProfile.id);

  // Foreground arrivals: no system banner; the toast below carries "Open".
  useEffect(() => {
    Notifications.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowBanner: false,
        shouldShowList: true,
        shouldPlaySound: false,
        shouldSetBadge: false,
      }),
    });
    return () => Notifications.setNotificationHandler(null);
  }, []);

  const openTarget = useCallback(
    async (target: PushNotificationTarget) => {
      const profile = await resolvePushTargetProfile(target, {
        profiles: profilesRef.current,
        activeProfileId: activeProfileIdRef.current,
        hasThread: hasThreadOnServer,
      });
      if (!profile) {
        toast.error("Could not open the thread", {
          description: "None of your saved servers has it.",
        });
        return;
      }
      await openThreadInProfile(profile.id, target.threadId);
    },
    [openThreadInProfile],
  );

  // Taps: while running (background or foreground) and the cold-start one.
  useEffect(() => {
    const handle = (response: Notifications.NotificationResponse) => {
      const target = parsePushNotificationData(
        response.notification.request.content.data,
      );
      if (target) void openTarget(target);
    };
    const subscription =
      Notifications.addNotificationResponseReceivedListener(handle);
    const last = Notifications.getLastNotificationResponse();
    if (last) {
      Notifications.clearLastNotificationResponse();
      handle(last);
    }
    return () => subscription.remove();
  }, [openTarget]);

  // Foreground arrivals → toast with Open (unless that thread is on screen).
  useEffect(() => {
    const subscription = Notifications.addNotificationReceivedListener(
      (notification) => {
        const content = notification.request.content;
        const target = parsePushNotificationData(content.data);
        if (!target) return;
        if (pathnameIsThread(pathnameRef.current, target.threadId)) return;
        toast.message(content.title ?? "bb", {
          description: content.body ?? undefined,
          duration: 8_000,
          action: { label: "Open", onClick: () => void openTarget(target) },
        });
      },
    );
    return () => subscription.remove();
  }, [openTarget]);

  // Registration sync for the active profile.
  useEffect(() => {
    if (!syncProfile || !connected) return;
    void controller.sync(syncProfile);
  }, [controller, syncProfile, connected, activeEnabled]);

  // AppState active: the user may have changed the permission in Settings.
  useEffect(() => {
    const onChange = (state: AppStateStatus) => {
      if (state !== "active") return;
      void controller.refreshPermission().then(() => {
        if (syncProfile) void controller.sync(syncProfile);
      });
    };
    const subscription = AppState.addEventListener("change", onChange);
    return () => subscription.remove();
  }, [controller, syncProfile]);

  // Token roll: every registered profile re-registers.
  useEffect(
    () =>
      notifications.addTokenListener(() => {
        void controller.handleTokenRolled(
          profilesRef.current.map((profile) => ({
            id: profile.id,
            serverUrl: profile.serverUrl,
          })),
        );
      }),
    [controller, notifications],
  );

  // Profiles removed from the app: forget their server rows.
  useEffect(() => {
    if (status !== "ready") return;
    void controller.reconcileRemovedProfiles(profiles.map((p) => p.id));
  }, [controller, status, profiles]);

  return (
    <>
      {connection ? <AppBadgeSync pathname={pathname} /> : null}
      <FirstRunPrompt
        profile={activeProfile}
        connected={connected}
        available={notifications.projectId !== null}
        prompted={storeSnapshot.prompted}
      />
    </>
  );
}

/**
 * One-time "turn on notifications?" after the first successful connection.
 * Only when the app can mint a token (EAS project id) and the OS prompt was
 * never shown; declining or dismissing records the choice (Settings keeps
 * the toggle).
 */
function FirstRunPrompt({
  profile,
  connected,
  available,
  prompted,
}: {
  profile: ServerProfile | null;
  connected: boolean;
  available: boolean;
  prompted: boolean;
}) {
  const sheet = useSheet();
  const controller = getPushRegistrationController();
  const store = getPushStore();
  const notifications = getPushNotificationsModule();
  const [presentedFor, setPresentedFor] = useState<string | null>(null);
  const shouldAsk =
    available &&
    !prompted &&
    connected &&
    profile !== null &&
    presentedFor === null;

  useEffect(() => {
    if (!shouldAsk || !profile) return;
    let cancelled = false;
    void notifications.getPermission().then((permission) => {
      if (cancelled || permission !== "undetermined") return;
      setPresentedFor(profile.id);
      sheet.present();
    });
    return () => {
      cancelled = true;
    };
  }, [shouldAsk, profile, notifications, sheet]);

  const target = useMemo(
    () => (profile ? { id: profile.id, serverUrl: profile.serverUrl } : null),
    [profile],
  );

  return (
    <ActionSheet
      controller={sheet}
      title="Get notified when a thread needs you?"
      message="bb can send a push notification when a thread finishes, hits an error, or is waiting for your input. You can change this per server in Settings."
      actions={[
        {
          key: "enable",
          label: "Turn on notifications",
          icon: "Zap",
          onPress: () => {
            if (!target) return;
            void controller.setEnabled(target, true).then((outcome) => {
              if (outcome.action === "failed") {
                toast.error("Could not turn on notifications", {
                  description: outcome.error,
                });
              }
            });
          },
        },
        {
          key: "later",
          label: "Not now",
          onPress: () => store.markPrompted(),
        },
      ]}
      cancelLabel={undefined}
      onDismiss={() => {
        if (!store.hasPrompted()) store.markPrompted();
      }}
    />
  );
}

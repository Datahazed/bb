import { useCallback, useEffect, useSyncExternalStore } from "react";
import {
  describePushStatus,
  type PushPermissionState,
  type PushProfileSyncState,
  type PushSyncOutcome,
} from "@/data/notifications";
import { getPushNotificationsModule } from "./expo-push-module";
import { getPushRegistrationController } from "./push-controller";
import { getPushStore } from "./push-storage";

export interface PushRegistration {
  /** False until the app is built with EAS (no project id → no token). */
  available: boolean;
  enabled: boolean;
  permission: PushPermissionState | null;
  syncing: boolean;
  lastOutcome: PushSyncOutcome | null;
  /** One-line status for the Settings row. */
  statusText: string;
  setEnabled(enabled: boolean): Promise<PushSyncOutcome>;
}

const IDLE_STATE: PushProfileSyncState = {
  syncing: false,
  lastOutcome: null,
  permission: null,
};

/**
 * Push registration for one server profile: the "Push notifications" toggle
 * (asks for the OS permission the first time it is turned on), the sync
 * state, and a one-line status. The PushNotificationsHost performs the
 * actual register / re-register / unregister work; this hook drives and
 * observes it.
 */
export function usePushRegistration(profile: {
  id: string;
  serverUrl: string;
}): PushRegistration {
  const store = getPushStore();
  const controller = getPushRegistrationController();
  const notifications = getPushNotificationsModule();
  const storeSnapshot = useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getSnapshot,
  );
  const controllerSnapshot = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    controller.getSnapshot,
  );
  useEffect(() => {
    void controller.refreshPermission();
  }, [controller]);

  const state = controllerSnapshot.byProfileId[profile.id] ?? IDLE_STATE;
  const enabled = storeSnapshot.enabledProfileIds.includes(profile.id);
  const registration = storeSnapshot.registrations[profile.id] ?? null;
  const setEnabled = useCallback(
    (next: boolean) => controller.setEnabled(profile, next),
    [controller, profile],
  );
  return {
    available: notifications.projectId !== null,
    enabled,
    permission: state.permission,
    syncing: state.syncing,
    lastOutcome: state.lastOutcome,
    statusText: describePushStatus({
      projectId: notifications.projectId,
      enabled,
      permission: state.permission,
      registration,
      lastOutcome: state.lastOutcome,
    }),
    setEnabled,
  };
}

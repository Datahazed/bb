import type { PushPlatform } from "./push-contract";
import type { PushRegistrationRecord, PushStore } from "./push-store";
import type { PushSubscriptionsApi } from "./push-subscriptions-api";

/**
 * Per-profile Expo push registration policy. Pure apart from the injected
 * notifications module (expo-notifications in the app, a fake in tests) and
 * the subscriptions API.
 *
 * A phone registers its Expo push token with every server profile whose
 * "Push notifications" toggle is on, once the OS permission is granted and
 * the app knows its EAS project id (the token cannot be minted without one;
 * a dev-client built outside EAS reports "push unavailable"). The stored
 * registration record lets the sync re-register on a token change, refresh
 * `lastSeenAt` on the server periodically, and unregister a profile the user
 * removed from the app.
 */
export type PushPermissionState = "granted" | "denied" | "undetermined";

export interface PushNotificationsModule {
  /** EAS project id from the app config; null before the app is built with EAS. */
  readonly projectId: string | null;
  readonly platform: PushPlatform;
  getPermission(): Promise<PushPermissionState>;
  /** Shows the OS prompt (once); afterwards returns the settled state. */
  requestPermission(): Promise<PushPermissionState>;
  getExpoPushToken(projectId: string): Promise<string>;
  /** Fires when the OS rolls the device token; the Expo token must be re-read. */
  addTokenListener(listener: () => void): () => void;
  setBadgeCount(count: number): Promise<void>;
}

export type PushSkipReason =
  | "disabled"
  | "no-project-id"
  | "permission-undetermined"
  | "permission-denied"
  | "up-to-date";

export type PushSyncOutcome =
  | { action: "registered"; expoPushToken: string }
  | { action: "unregistered" }
  | { action: "skipped"; reason: PushSkipReason }
  | {
      action: "failed";
      step: "token" | "register" | "unregister";
      error: string;
    };

export interface PushSyncDeps {
  notifications: PushNotificationsModule;
  api: PushSubscriptionsApi;
  store: PushStore;
  deviceLabel: string;
  now?: () => number;
  /** Re-POST an unchanged registration after this long (keeps `lastSeenAt` fresh). */
  refreshAfterMs?: number;
}

export interface PushSyncProfile {
  id: string;
  serverUrl: string;
}

/** One day: a live phone re-asserts its subscription daily. */
export const PUSH_REGISTRATION_REFRESH_MS = 24 * 60 * 60 * 1000;

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export type PushSyncDecision =
  | { action: "skip"; reason: Exclude<PushSkipReason, "up-to-date"> }
  | { action: "unregister" }
  | { action: "fetch-token" };

/**
 * What to do before a token is known. Unregistering only happens when the
 * phone previously registered this profile: the server's state should track
 * the toggle and the OS permission.
 */
export function decidePushSync(input: {
  enabled: boolean;
  projectId: string | null;
  permission: PushPermissionState;
  existing: PushRegistrationRecord | null;
}): PushSyncDecision {
  if (!input.enabled) {
    return input.existing
      ? { action: "unregister" }
      : { action: "skip", reason: "disabled" };
  }
  if (input.projectId === null) {
    return { action: "skip", reason: "no-project-id" };
  }
  if (input.permission === "denied") {
    return input.existing
      ? { action: "unregister" }
      : { action: "skip", reason: "permission-denied" };
  }
  if (input.permission === "undetermined") {
    return { action: "skip", reason: "permission-undetermined" };
  }
  return { action: "fetch-token" };
}

/** Whether a fresh token/platform/server or a stale record needs a new POST. */
export function shouldReregister(input: {
  existing: PushRegistrationRecord | null;
  expoPushToken: string;
  platform: PushPlatform;
  serverUrl: string;
  now: number;
  refreshAfterMs: number;
}): boolean {
  const { existing } = input;
  if (!existing) return true;
  if (existing.expoPushToken !== input.expoPushToken) return true;
  if (existing.platform !== input.platform) return true;
  if (existing.serverUrl !== input.serverUrl) return true;
  return input.now - existing.registeredAt >= input.refreshAfterMs;
}

/**
 * Bring the server's subscription for `profile` in line with the local
 * toggle, the OS permission, and the current token. Never throws: failures
 * are reported so the caller can show them in Settings and retry later.
 */
export async function syncPushRegistration(
  deps: PushSyncDeps,
  profile: PushSyncProfile,
): Promise<PushSyncOutcome> {
  const now = deps.now ?? Date.now;
  const refreshAfterMs = deps.refreshAfterMs ?? PUSH_REGISTRATION_REFRESH_MS;
  const { notifications, api, store } = deps;
  const existing = store.getRegistration(profile.id);
  const decision = decidePushSync({
    enabled: store.isEnabled(profile.id),
    projectId: notifications.projectId,
    permission: await notifications.getPermission(),
    existing,
  });
  if (decision.action === "skip") {
    return { action: "skipped", reason: decision.reason };
  }
  if (decision.action === "unregister") {
    return unregisterPushRegistration(deps, profile.id);
  }

  let expoPushToken: string;
  try {
    // `decidePushSync` only reaches here with a project id.
    expoPushToken = await notifications.getExpoPushToken(
      notifications.projectId ?? "",
    );
  } catch (error) {
    return { action: "failed", step: "token", error: describe(error) };
  }
  const platform = notifications.platform;
  if (
    !shouldReregister({
      existing,
      expoPushToken,
      platform,
      serverUrl: profile.serverUrl,
      now: now(),
      refreshAfterMs,
    })
  ) {
    return { action: "skipped", reason: "up-to-date" };
  }
  // A token or server change leaves a stale row behind on the old server /
  // for the old token; remove it first (best effort) so the server does not
  // push to a dead token.
  if (
    existing &&
    (existing.expoPushToken !== expoPushToken ||
      existing.serverUrl !== profile.serverUrl)
  ) {
    try {
      await api.unregister(existing.serverUrl, existing);
    } catch {
      // The new registration below is what matters; the server also prunes
      // tokens Expo reports as DeviceNotRegistered.
    }
  }
  let subscriptionId: string;
  try {
    ({ subscriptionId } = await api.register(profile.serverUrl, {
      expoPushToken,
      platform,
      deviceLabel: deps.deviceLabel,
    }));
  } catch (error) {
    return { action: "failed", step: "register", error: describe(error) };
  }
  store.setRegistration(profile.id, {
    subscriptionId,
    expoPushToken,
    platform,
    serverUrl: profile.serverUrl,
    registeredAt: now(),
  });
  return { action: "registered", expoPushToken };
}

/**
 * Remove the phone's subscription for a profile (toggle off, permission
 * revoked, or the profile was removed from the app — which is why this takes
 * the id, not the profile: the record remembers the server URL).
 */
export async function unregisterPushRegistration(
  deps: Pick<PushSyncDeps, "api" | "store">,
  profileId: string,
): Promise<PushSyncOutcome> {
  const existing = deps.store.getRegistration(profileId);
  if (!existing) return { action: "skipped", reason: "disabled" };
  try {
    await deps.api.unregister(existing.serverUrl, existing);
  } catch (error) {
    return { action: "failed", step: "unregister", error: describe(error) };
  }
  deps.store.setRegistration(profileId, null);
  return { action: "unregistered" };
}

/**
 * Turn the toggle on for a profile, asking for the OS permission first when
 * it was never requested. Returns the permission the app ended up with so
 * the UI can explain a denial (and deep-link to the system settings).
 */
export async function enablePushForProfile(
  deps: Pick<PushSyncDeps, "notifications" | "store">,
  profileId: string,
): Promise<PushPermissionState> {
  let permission = await deps.notifications.getPermission();
  if (permission === "undetermined") {
    permission = await deps.notifications.requestPermission();
  }
  deps.store.markPrompted();
  deps.store.setEnabled(profileId, permission === "granted");
  return permission;
}

/** User-facing summary for the Settings row subtitle. */
export function describePushStatus(input: {
  projectId: string | null;
  enabled: boolean;
  permission: PushPermissionState | null;
  registration: PushRegistrationRecord | null;
  lastOutcome: PushSyncOutcome | null;
}): string {
  if (input.projectId === null) {
    return "Push unavailable until the app is built with EAS";
  }
  if (!input.enabled) return "Off";
  if (input.permission === "denied") {
    return "Notifications are blocked in system settings";
  }
  if (input.lastOutcome?.action === "failed") {
    return `Could not register: ${input.lastOutcome.error}`;
  }
  if (input.registration) return "On · registered with this server";
  if (input.permission === "undetermined") return "Waiting for permission";
  return "Registering…";
}

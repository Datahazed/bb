import { pushSubscriptionPlatformSchema } from "@bb/server-contract";
import { z } from "zod";

/**
 * Client-local push state, one MMKV store (`bb.preferences`, wiped by the
 * e2e reset): the per-profile "Push notifications" toggle, the registration
 * the phone last made for each profile (so a token change re-registers and a
 * removed profile can still be unregistered by its server URL), and whether
 * the first-run prompt was shown. Storage is injected (MMKV in the app, a Map
 * in tests); the store is the single writer and notifies in-process readers.
 */
export interface PushStorage {
  getString(key: string): string | undefined;
  set(key: string, value: string): void;
  remove(key: string): void;
}

export const pushRegistrationRecordSchema = z.object({
  /** The server row id (`POST` response); null for rows registered before ids were stored. */
  subscriptionId: z.string().min(1).nullable(),
  expoPushToken: z.string().min(1),
  platform: pushSubscriptionPlatformSchema,
  serverUrl: z.string().min(1),
  registeredAt: z.number().int().nonnegative(),
});
export type PushRegistrationRecord = z.infer<
  typeof pushRegistrationRecordSchema
>;

export interface PushStoreSnapshot {
  enabledProfileIds: readonly string[];
  registrations: Readonly<Record<string, PushRegistrationRecord>>;
  prompted: boolean;
}

export interface PushStore {
  getSnapshot(): PushStoreSnapshot;
  subscribe(listener: () => void): () => void;
  isEnabled(profileId: string): boolean;
  setEnabled(profileId: string, enabled: boolean): void;
  getRegistration(profileId: string): PushRegistrationRecord | null;
  setRegistration(
    profileId: string,
    record: PushRegistrationRecord | null,
  ): void;
  /** Profiles with a stored registration (including ones removed from the app). */
  registeredProfileIds(): readonly string[];
  hasPrompted(): boolean;
  markPrompted(): void;
  /** Forget every per-profile flag/record for `profileId`. */
  forgetProfile(profileId: string): void;
  /** Re-read storage (after an external wipe such as the e2e reset). */
  reload(): void;
}

export const PUSH_ENABLED_KEY_PREFIX = "bb.push.enabled.";
export const PUSH_REGISTRATION_KEY_PREFIX = "bb.push.registration.";
export const PUSH_REGISTRATION_INDEX_KEY = "bb.push.registrations";
export const PUSH_PROMPTED_KEY = "bb.push.prompted";
export const PUSH_ENABLED_INDEX_KEY = "bb.push.enabledProfiles";

const idListSchema = z.array(z.string().min(1));

function readIdList(storage: PushStorage, key: string): string[] {
  const raw = storage.getString(key);
  if (!raw) return [];
  try {
    const parsed = idListSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : [];
  } catch {
    return [];
  }
}

function readRegistration(
  storage: PushStorage,
  profileId: string,
): PushRegistrationRecord | null {
  const raw = storage.getString(`${PUSH_REGISTRATION_KEY_PREFIX}${profileId}`);
  if (!raw) return null;
  try {
    const parsed = pushRegistrationRecordSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export function createPushStore(storage: PushStorage): PushStore {
  const listeners = new Set<() => void>();

  function load(): PushStoreSnapshot {
    const enabledProfileIds = readIdList(
      storage,
      PUSH_ENABLED_INDEX_KEY,
    ).filter(
      (id) => storage.getString(`${PUSH_ENABLED_KEY_PREFIX}${id}`) === "1",
    );
    const registrations: Record<string, PushRegistrationRecord> = {};
    for (const id of readIdList(storage, PUSH_REGISTRATION_INDEX_KEY)) {
      const record = readRegistration(storage, id);
      if (record) registrations[id] = record;
    }
    return {
      enabledProfileIds,
      registrations,
      prompted: storage.getString(PUSH_PROMPTED_KEY) === "1",
    };
  }

  let snapshot = load();

  function commit(next: PushStoreSnapshot): void {
    snapshot = next;
    for (const listener of listeners) listener();
  }

  function writeIdList(key: string, ids: readonly string[]): void {
    if (ids.length === 0) storage.remove(key);
    else storage.set(key, JSON.stringify(ids));
  }

  return {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    isEnabled: (profileId) => snapshot.enabledProfileIds.includes(profileId),
    setEnabled(profileId, enabled) {
      const key = `${PUSH_ENABLED_KEY_PREFIX}${profileId}`;
      const ids = snapshot.enabledProfileIds.filter((id) => id !== profileId);
      if (enabled) {
        storage.set(key, "1");
        ids.push(profileId);
      } else {
        storage.remove(key);
      }
      writeIdList(PUSH_ENABLED_INDEX_KEY, ids);
      commit({ ...snapshot, enabledProfileIds: ids });
    },
    getRegistration: (profileId) => snapshot.registrations[profileId] ?? null,
    setRegistration(profileId, record) {
      const key = `${PUSH_REGISTRATION_KEY_PREFIX}${profileId}`;
      const registrations = { ...snapshot.registrations };
      if (record) {
        storage.set(key, JSON.stringify(record));
        registrations[profileId] = record;
      } else {
        storage.remove(key);
        delete registrations[profileId];
      }
      writeIdList(PUSH_REGISTRATION_INDEX_KEY, Object.keys(registrations));
      commit({ ...snapshot, registrations });
    },
    registeredProfileIds: () => Object.keys(snapshot.registrations),
    hasPrompted: () => snapshot.prompted,
    markPrompted() {
      storage.set(PUSH_PROMPTED_KEY, "1");
      commit({ ...snapshot, prompted: true });
    },
    reload() {
      commit(load());
    },
    forgetProfile(profileId) {
      storage.remove(`${PUSH_ENABLED_KEY_PREFIX}${profileId}`);
      storage.remove(`${PUSH_REGISTRATION_KEY_PREFIX}${profileId}`);
      const enabledProfileIds = snapshot.enabledProfileIds.filter(
        (id) => id !== profileId,
      );
      const registrations = { ...snapshot.registrations };
      delete registrations[profileId];
      writeIdList(PUSH_ENABLED_INDEX_KEY, enabledProfileIds);
      writeIdList(PUSH_REGISTRATION_INDEX_KEY, Object.keys(registrations));
      commit({ ...snapshot, enabledProfileIds, registrations });
    },
  };
}

/** In-memory storage for tests. */
export function createMemoryPushStorage(): PushStorage & {
  dump(): Record<string, string>;
} {
  const map = new Map<string, string>();
  return {
    getString: (key) => map.get(key),
    set: (key, value) => {
      map.set(key, value);
    },
    remove: (key) => {
      map.delete(key);
    },
    dump: () => Object.fromEntries(map),
  };
}

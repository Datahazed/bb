import { createMMKV } from "react-native-mmkv";
import {
  createPushStore,
  createPushSubscriptionsApi,
  type PushStore,
  type PushSubscriptionsApi,
} from "@/data/notifications";
import { createMobileFetch } from "@/lib/sdk";

let store: PushStore | null = null;
let api: PushSubscriptionsApi | null = null;

/**
 * App-wide push store on the shared `bb.preferences` MMKV instance (wiped by
 * the e2e reset together with the other client-local preferences).
 */
export function getPushStore(): PushStore {
  if (!store) {
    const mmkv = createMMKV({ id: "bb.preferences" });
    store = createPushStore({
      getString: (key) => mmkv.getString(key),
      set: (key, value) => mmkv.set(key, value),
      remove: (key) => {
        mmkv.remove(key);
      },
    });
  }
  return store;
}

/** The push-subscription routes over the global fetch + mobile surface header. */
export function getPushSubscriptionsApi(): PushSubscriptionsApi {
  api ??= createPushSubscriptionsApi(
    createMobileFetch((input, init) => fetch(input, init)),
  );
  return api;
}

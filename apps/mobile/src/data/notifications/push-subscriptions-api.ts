import { BbHttpError, createBrowserBbSdk } from "@bb/sdk/browser";
import type {
  PushSubscriptionInput,
  PushSubscriptionRecord,
  PushSubscriptionRef,
} from "./push-contract";

/**
 * `sdk.notifications.pushSubscriptions` keyed by server URL instead of by
 * profile: a profile the user removed still needs its row deleted, and the
 * per-profile client may already be disposed by then. Connect profiles
 * authenticate through the native cookie jar; nothing is added here.
 */
export interface PushSubscriptionsApi {
  /** Upsert by token; resolves with the server row id. */
  register(
    serverUrl: string,
    input: PushSubscriptionInput,
  ): Promise<{ subscriptionId: string }>;
  /**
   * Delete the row (by id when known, else by looking the token up). A row
   * that is already gone counts as success.
   */
  unregister(serverUrl: string, ref: PushSubscriptionRef): Promise<void>;
  list(
    serverUrl: string,
    signal?: AbortSignal,
  ): Promise<PushSubscriptionRecord[]>;
}

export function createPushSubscriptionsApi(
  fetchImpl: typeof fetch,
): PushSubscriptionsApi {
  const clients = new Map<string, ReturnType<typeof createBrowserBbSdk>>();
  function sdkFor(serverUrl: string) {
    const key = serverUrl.replace(/\/+$/u, "");
    let sdk = clients.get(key);
    if (!sdk) {
      sdk = createBrowserBbSdk({ baseUrl: key, fetch: fetchImpl });
      clients.set(key, sdk);
    }
    return sdk.notifications.pushSubscriptions;
  }

  async function remove(serverUrl: string, id: string): Promise<void> {
    try {
      await sdkFor(serverUrl).remove({ id });
    } catch (error) {
      if (error instanceof BbHttpError && error.status === 404) return;
      throw error;
    }
  }

  return {
    async register(serverUrl, input) {
      const result = await sdkFor(serverUrl).add(input);
      return { subscriptionId: result.subscription.id };
    },
    async unregister(serverUrl, ref) {
      if (ref.subscriptionId !== null) {
        await remove(serverUrl, ref.subscriptionId);
        return;
      }
      const rows = await sdkFor(serverUrl).list();
      const row = rows.find((r) => r.expoPushToken === ref.expoPushToken);
      if (row) await remove(serverUrl, row.id);
    },
    list(serverUrl, signal) {
      return sdkFor(serverUrl).list(signal ? { signal } : undefined);
    },
  };
}

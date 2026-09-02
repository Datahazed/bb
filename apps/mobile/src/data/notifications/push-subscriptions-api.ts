import { BbHttpError, createBrowserBbSdk } from "@bb/sdk/browser";
import type {
  PushSubscriptionInput,
  PushSubscriptionRecord,
  PushSubscriptionRef,
} from "./push-contract";

export interface PushSubscriptionsApi {
  register(
    serverUrl: string,
    input: PushSubscriptionInput,
  ): Promise<{ subscriptionId: string }>;
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
      const matches = rows.filter((row) => row.tokenSuffix === ref.tokenSuffix);
      if (matches.length === 1 && matches[0]) {
        await remove(serverUrl, matches[0].id);
      }
    },
    list(serverUrl, signal) {
      return sdkFor(serverUrl).list(signal ? { signal } : undefined);
    },
  };
}

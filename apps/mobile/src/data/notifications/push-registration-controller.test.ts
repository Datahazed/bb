import { describe, expect, it, vi } from "vitest";
import { createPushRegistrationController } from "./push-registration-controller";
import type { PushNotificationsModule } from "./push-registration";
import { createMemoryPushStorage, createPushStore } from "./push-store";
import type { PushSubscriptionsApi } from "./push-subscriptions-api";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

function setup() {
  const store = createPushStore(createMemoryPushStorage());
  const tokenGate = deferred<string>();
  const notifications: PushNotificationsModule = {
    projectId: "eas",
    platform: "ios",
    getPermission: async () => "granted",
    requestPermission: async () => "granted",
    getExpoPushToken: vi.fn(() => tokenGate.promise),
    addTokenListener: () => () => undefined,
    setBadgeCount: async () => undefined,
  };
  const api = {
    register: vi.fn<PushSubscriptionsApi["register"]>(async () => ({
      subscriptionId: "sub_1",
    })),
    unregister: vi.fn<PushSubscriptionsApi["unregister"]>(
      async () => undefined,
    ),
    list: vi.fn<PushSubscriptionsApi["list"]>(async () => []),
  };
  const controller = createPushRegistrationController({
    notifications,
    api,
    store,
    deviceLabel: "phone",
    now: () => 1,
  });
  return { store, notifications, api, controller, tokenGate };
}

const profile = { id: "p1", serverUrl: "https://a" };

describe("createPushRegistrationController", () => {
  it("coalesces concurrent syncs for one profile into one in-flight run plus a trailing run", async () => {
    const { controller, store, notifications, tokenGate, api } = setup();
    store.setEnabled(profile.id, true);
    const first = controller.sync(profile);
    const second = controller.sync(profile);
    expect(controller.getSnapshot().byProfileId.p1?.syncing).toBe(true);
    tokenGate.resolve("tok");
    // Both callers observe the settled state after the trailing run.
    expect(await first).toEqual({ action: "skipped", reason: "up-to-date" });
    expect(await second).toEqual({ action: "skipped", reason: "up-to-date" });
    expect(notifications.getExpoPushToken).toHaveBeenCalledTimes(2);
    expect(api.register).toHaveBeenCalledTimes(1);
    expect(controller.getSnapshot().byProfileId.p1).toMatchObject({
      syncing: false,
      lastOutcome: { action: "skipped", reason: "up-to-date" },
    });
  });

  it("unregisters and forgets profiles removed from the app", async () => {
    const { controller, store, api, tokenGate } = setup();
    tokenGate.resolve("tok");
    store.setEnabled("p1", true);
    await controller.sync(profile);
    store.setEnabled("p2", true);
    await controller.sync({ id: "p2", serverUrl: "https://b" });
    await controller.reconcileRemovedProfiles(["p2"]);
    expect(api.unregister).toHaveBeenCalledWith(
      "https://a",
      expect.objectContaining({
        subscriptionId: "sub_1",
        expoPushToken: "tok",
      }),
    );
    expect(store.registeredProfileIds()).toEqual(["p2"]);
    expect(store.isEnabled("p1")).toBe(false);
  });

  it("turning the toggle off removes the server row; on re-registers", async () => {
    const { controller, store, api, tokenGate } = setup();
    tokenGate.resolve("tok");
    expect(await controller.setEnabled(profile, true)).toEqual({
      action: "registered",
      expoPushToken: "tok",
    });
    expect(store.hasPrompted()).toBe(true);
    expect(await controller.setEnabled(profile, false)).toEqual({
      action: "unregistered",
    });
    expect(api.unregister).toHaveBeenCalledTimes(1);
    expect(store.isEnabled(profile.id)).toBe(false);
  });
});

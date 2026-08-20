import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createConnection,
  deletePushSubscription,
  deletePushSubscriptionByToken,
  getPushSubscription,
  getPushSubscriptionByToken,
  listPushSubscriptions,
  migrate,
  upsertPushSubscription,
  type DbConnection,
} from "../../src/index.js";

describe("push subscriptions data", () => {
  let db: DbConnection;

  beforeEach(() => {
    db = createConnection(":memory:");
    migrate(db);
  });

  afterEach(() => {
    db.$client.close();
    vi.useRealTimers();
  });

  it("re-registering a token refreshes the row instead of adding one", () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    const created = upsertPushSubscription(db, {
      expoPushToken: "ExponentPushToken[abc]",
      platform: "ios",
      deviceLabel: "Sawyer's iPhone",
    });
    expect(created.outcome).toBe("created");
    expect(created.subscription).toMatchObject({
      expoPushToken: "ExponentPushToken[abc]",
      platform: "ios",
      deviceLabel: "Sawyer's iPhone",
      createdAt: 1_000,
      lastSeenAt: 1_000,
    });
    expect(created.subscription.id).toMatch(/^push_/);

    vi.setSystemTime(5_000);
    const updated = upsertPushSubscription(db, {
      expoPushToken: "ExponentPushToken[abc]",
      platform: "ios",
      deviceLabel: "iPhone 17",
    });
    expect(updated.outcome).toBe("updated");
    expect(updated.subscription).toEqual({
      ...created.subscription,
      deviceLabel: "iPhone 17",
      lastSeenAt: 5_000,
    });
    expect(listPushSubscriptions(db)).toEqual([updated.subscription]);
  });

  it("lists oldest first and looks up by id or token", () => {
    vi.useFakeTimers();
    vi.setSystemTime(10);
    const first = upsertPushSubscription(db, {
      expoPushToken: "ExponentPushToken[first]",
      platform: "android",
      deviceLabel: "Pixel",
    }).subscription;
    vi.setSystemTime(20);
    const second = upsertPushSubscription(db, {
      expoPushToken: "ExponentPushToken[second]",
      platform: "ios",
      deviceLabel: "iPhone",
    }).subscription;

    expect(listPushSubscriptions(db).map((row) => row.id)).toEqual([
      first.id,
      second.id,
    ]);
    expect(getPushSubscription(db, second.id)).toEqual(second);
    expect(getPushSubscription(db, "push_missing")).toBeNull();
    expect(
      getPushSubscriptionByToken(db, "ExponentPushToken[first]"),
    ).toEqual(first);
    expect(getPushSubscriptionByToken(db, "ExponentPushToken[nope]")).toBeNull();
  });

  it("deletes by id or token and reports whether a row existed", () => {
    const row = upsertPushSubscription(db, {
      expoPushToken: "ExponentPushToken[abc]",
      platform: "ios",
      deviceLabel: "iPhone",
    }).subscription;
    const other = upsertPushSubscription(db, {
      expoPushToken: "ExponentPushToken[def]",
      platform: "ios",
      deviceLabel: "iPad",
    }).subscription;

    expect(deletePushSubscription(db, row.id)).toBe(true);
    expect(deletePushSubscription(db, row.id)).toBe(false);
    expect(deletePushSubscriptionByToken(db, "ExponentPushToken[def]")).toBe(
      true,
    );
    expect(deletePushSubscriptionByToken(db, "ExponentPushToken[def]")).toBe(
      false,
    );
    expect(listPushSubscriptions(db)).toEqual([]);
    expect(getPushSubscription(db, other.id)).toBeNull();
  });
});

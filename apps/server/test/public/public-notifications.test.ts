import {
  pushSubscriptionListResponseSchema,
  pushSubscriptionSchema,
} from "@bb/server-contract";
import { describe, expect, it } from "vitest";
import { readJson } from "../helpers/json.js";
import { withTestHarness, type TestAppHarness } from "../helpers/test-app.js";

const PATH = "/api/v1/notifications/push-subscriptions";

async function register(
  harness: TestAppHarness,
  body: unknown,
): Promise<Response> {
  return await harness.app.request(PATH, {
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
}

describe("public push subscriptions", () => {
  it("registers, refreshes, lists, and removes device tokens", async () => {
    await withTestHarness(async (harness) => {
      const created = await register(harness, {
        expoPushToken: "ExponentPushToken[abc]",
        platform: "ios",
        deviceLabel: "Sawyer's iPhone",
      });
      expect(created.status).toBe(201);
      const subscription = pushSubscriptionSchema.parse(
        await readJson(created),
      );
      expect(subscription).toMatchObject({
        expoPushToken: "ExponentPushToken[abc]",
        platform: "ios",
        deviceLabel: "Sawyer's iPhone",
      });

      const refreshed = await register(harness, {
        expoPushToken: "ExponentPushToken[abc]",
        platform: "ios",
        deviceLabel: "iPhone 17",
      });
      expect(refreshed.status).toBe(200);
      expect(pushSubscriptionSchema.parse(await readJson(refreshed))).toEqual({
        ...subscription,
        deviceLabel: "iPhone 17",
        lastSeenAt: expect.any(Number),
      });

      const listed = await harness.app.request(PATH);
      expect(listed.status).toBe(200);
      const list = pushSubscriptionListResponseSchema.parse(
        await readJson(listed),
      );
      expect(list.subscriptions.map((row) => row.id)).toEqual([
        subscription.id,
      ]);

      const removed = await harness.app.request(`${PATH}/${subscription.id}`, {
        method: "DELETE",
      });
      expect(removed.status).toBe(200);
      await expect(readJson(removed)).resolves.toEqual({ ok: true });

      const removedAgain = await harness.app.request(
        `${PATH}/${subscription.id}`,
        { method: "DELETE" },
      );
      expect(removedAgain.status).toBe(404);
      await expect(readJson(removedAgain)).resolves.toMatchObject({
        code: "push_subscription_not_found",
      });
      expect(
        pushSubscriptionListResponseSchema.parse(
          await readJson(await harness.app.request(PATH)),
        ).subscriptions,
      ).toEqual([]);
    });
  });

  it("rejects incomplete or unknown registration fields", async () => {
    await withTestHarness(async (harness) => {
      const missingLabel = await register(harness, {
        expoPushToken: "ExponentPushToken[abc]",
        platform: "ios",
      });
      expect(missingLabel.status).toBe(400);

      const unknownPlatform = await register(harness, {
        expoPushToken: "ExponentPushToken[abc]",
        platform: "web",
        deviceLabel: "Browser",
      });
      expect(unknownPlatform.status).toBe(400);

      const extraField = await register(harness, {
        expoPushToken: "ExponentPushToken[abc]",
        platform: "android",
        deviceLabel: "Pixel",
        sound: "chime",
      });
      expect(extraField.status).toBe(400);
      expect(
        pushSubscriptionListResponseSchema.parse(
          await readJson(await harness.app.request(PATH)),
        ).subscriptions,
      ).toEqual([]);
    });
  });
});

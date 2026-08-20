import { z } from "zod";
import {
  pushSubscriptionPlatformSchema,
  pushSubscriptionSchema,
} from "@bb/domain";

export {
  pushNotificationDataSchema,
  pushNotificationKindSchema,
  pushNotificationKindValues,
  pushSubscriptionPlatformSchema,
  pushSubscriptionPlatformValues,
  pushSubscriptionSchema,
} from "@bb/domain";
export type {
  PushNotificationData,
  PushNotificationKind,
  PushSubscription,
  PushSubscriptionPlatform,
} from "@bb/domain";

// Expo tokens look like `ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]`; the cap
// only bounds request size.
export const EXPO_PUSH_TOKEN_MAX_LENGTH = 512;
export const PUSH_SUBSCRIPTION_DEVICE_LABEL_MAX_LENGTH = 120;

/**
 * Registers a device for push, or refreshes its row when the token is already
 * known (same id, new label and `lastSeenAt`). Every field is required: the
 * device knows its own platform and name, and the server never guesses them.
 */
export const registerPushSubscriptionRequestSchema = z
  .object({
    expoPushToken: z.string().trim().min(1).max(EXPO_PUSH_TOKEN_MAX_LENGTH),
    platform: pushSubscriptionPlatformSchema,
    deviceLabel: z
      .string()
      .trim()
      .min(1)
      .max(PUSH_SUBSCRIPTION_DEVICE_LABEL_MAX_LENGTH),
  })
  .strict();
export type RegisterPushSubscriptionRequest = z.infer<
  typeof registerPushSubscriptionRequestSchema
>;

export const pushSubscriptionListResponseSchema = z
  .object({
    subscriptions: z.array(pushSubscriptionSchema),
  })
  .strict();
export type PushSubscriptionListResponse = z.infer<
  typeof pushSubscriptionListResponseSchema
>;

export const pushSubscriptionResponseSchema = pushSubscriptionSchema;
export type PushSubscriptionResponse = z.infer<
  typeof pushSubscriptionResponseSchema
>;

export const deletePushSubscriptionResponseSchema = z
  .object({ ok: z.literal(true) })
  .strict();
export type DeletePushSubscriptionResponse = z.infer<
  typeof deletePushSubscriptionResponseSchema
>;

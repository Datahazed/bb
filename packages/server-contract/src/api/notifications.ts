import { z } from "zod";
import {
  pushSubscriptionPlatformSchema,
  pushSubscriptionSchema,
  pushSubscriptionSummarySchema,
} from "@bb/domain";

export {
  pushNotificationDataSchema,
  pushNotificationKindSchema,
  pushNotificationKindValues,
  pushSubscriptionPlatformSchema,
  pushSubscriptionPlatformValues,
  pushSubscriptionSchema,
  pushSubscriptionSummarySchema,
} from "@bb/domain";
export type {
  PushNotificationData,
  PushNotificationKind,
  PushSubscription,
  PushSubscriptionPlatform,
  PushSubscriptionSummary,
} from "@bb/domain";

export const EXPO_PUSH_TOKEN_MAX_LENGTH = 512;
export const PUSH_SUBSCRIPTION_DEVICE_LABEL_MAX_LENGTH = 120;

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
    subscriptions: z.array(pushSubscriptionSummarySchema),
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

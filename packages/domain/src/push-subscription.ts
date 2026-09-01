import { z } from "zod";

export const pushSubscriptionPlatformValues = ["ios", "android"] as const;
export const pushSubscriptionPlatformSchema = z.enum(
  pushSubscriptionPlatformValues,
);
export type PushSubscriptionPlatform = z.infer<
  typeof pushSubscriptionPlatformSchema
>;

export const pushSubscriptionSchema = z
  .object({
    id: z.string().min(1),
    expoPushToken: z.string().min(1),
    platform: pushSubscriptionPlatformSchema,
    deviceLabel: z.string(),
    createdAt: z.number().int().nonnegative(),
    lastSeenAt: z.number().int().nonnegative(),
  })
  .strict();
export type PushSubscription = z.infer<typeof pushSubscriptionSchema>;

export const pushSubscriptionSummarySchema = pushSubscriptionSchema
  .omit({ expoPushToken: true })
  .extend({ tokenSuffix: z.string().min(1).max(6) })
  .strict();
export type PushSubscriptionSummary = z.infer<
  typeof pushSubscriptionSummarySchema
>;

export const pushNotificationKindValues = [
  "pending-interaction",
  "turn-finished",
  "thread-error",
] as const;
export const pushNotificationKindSchema = z.enum(pushNotificationKindValues);
export type PushNotificationKind = z.infer<typeof pushNotificationKindSchema>;

export const pushNotificationDataSchema = z.object({
  kind: pushNotificationKindSchema,
  projectId: z.string().min(1),
  serverUrl: z.string().url().optional(),
  threadId: z.string().min(1),
});
export type PushNotificationData = z.infer<typeof pushNotificationDataSchema>;

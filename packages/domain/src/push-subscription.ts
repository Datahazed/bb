import { z } from "zod";

/**
 * Expo push tokens registered by bb mobile devices. The server keeps one row
 * per token and fans every push-worthy thread change out to all of them; the
 * APNs/FCM credentials live in the EAS project, never in bb.
 */
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
    /** Last time the device (re-)registered this token. */
    lastSeenAt: z.number().int().nonnegative(),
  })
  .strict();
export type PushSubscription = z.infer<typeof pushSubscriptionSchema>;

/**
 * Why a push was sent. `pending-interaction` is a new approval/question the
 * agent is blocked on, `turn-finished` a root thread that stopped and wants
 * input, `thread-error` a run that failed.
 */
export const pushNotificationKindValues = [
  "pending-interaction",
  "turn-finished",
  "thread-error",
] as const;
export const pushNotificationKindSchema = z.enum(pushNotificationKindValues);
export type PushNotificationKind = z.infer<typeof pushNotificationKindSchema>;

/**
 * The `data` payload of every bb push message. Clients route a tap to the
 * thread with it; parse leniently (`pushNotificationDataSchema.safeParse`)
 * because an older app can receive a newer server's payload.
 */
export const pushNotificationDataSchema = z.object({
  kind: pushNotificationKindSchema,
  projectId: z.string().min(1),
  threadId: z.string().min(1),
});
export type PushNotificationData = z.infer<typeof pushNotificationDataSchema>;

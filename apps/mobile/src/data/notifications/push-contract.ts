import type {
  PushSubscription,
  PushSubscriptionPlatform,
  RegisterPushSubscriptionRequest,
} from "@bb/server-contract";

/**
 * The server's push-subscription contract as the phone uses it
 * (`/api/v1/notifications/push-subscriptions`, SDK area
 * `sdk.notifications.pushSubscriptions`). The server owns the table and the
 * Expo Push sender; the phone registers / removes its Expo token per server
 * profile and tags a tap with the payload's `threadId`.
 */
export type PushPlatform = PushSubscriptionPlatform;
export type PushSubscriptionInput = RegisterPushSubscriptionRequest;
export type PushSubscriptionRecord = PushSubscription;

/** Which server row the phone holds for a profile (enough to remove it later). */
export interface PushSubscriptionRef {
  subscriptionId: string | null;
  expoPushToken: string;
}

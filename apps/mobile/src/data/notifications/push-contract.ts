import type {
  PushSubscription,
  PushSubscriptionPlatform,
  PushSubscriptionSummary,
  RegisterPushSubscriptionRequest,
} from "@bb/server-contract";

export type PushPlatform = PushSubscriptionPlatform;
export type PushSubscriptionInput = RegisterPushSubscriptionRequest;
export type PushSubscriptionRecord = PushSubscriptionSummary;
export type RegisteredPushSubscription = PushSubscription;

export interface PushSubscriptionRef {
  subscriptionId: string | null;
  expoPushToken: string;
  tokenSuffix: string;
}

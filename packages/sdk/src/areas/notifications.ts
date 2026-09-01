import type {
  DeletePushSubscriptionResponse,
  PushSubscription,
  RegisterPushSubscriptionRequest,
} from "@bb/server-contract";
import {
  deletePushSubscriptionResponseSchema,
  pushSubscriptionListResponseSchema,
  pushSubscriptionSchema,
} from "@bb/server-contract";
import { signalRequestArgs, type CreateSdkAreaArgs } from "./common.js";

export interface PushSubscriptionListArgs {
  signal?: AbortSignal;
}
export type PushSubscriptionListResult = PushSubscription[];

/** Every field is required: the device reports its own platform and name. */
export type PushSubscriptionAddArgs = RegisterPushSubscriptionRequest;
export interface PushSubscriptionAddResult {
  /** `true` when the token was new, `false` when an existing row was refreshed. */
  created: boolean;
  subscription: PushSubscription;
}

export interface PushSubscriptionRemoveArgs {
  id: string;
}
export type PushSubscriptionRemoveResult = DeletePushSubscriptionResponse;

export interface PushSubscriptionsArea {
  /** Register an Expo push token, or refresh the registration for a known one. */
  add(args: PushSubscriptionAddArgs): Promise<PushSubscriptionAddResult>;
  list(args?: PushSubscriptionListArgs): Promise<PushSubscriptionListResult>;
  remove(
    args: PushSubscriptionRemoveArgs,
  ): Promise<PushSubscriptionRemoveResult>;
}

export interface NotificationsArea {
  /** Devices the server pushes thread updates to through the Expo Push API. */
  pushSubscriptions: PushSubscriptionsArea;
}

export function createNotificationsArea(
  args: CreateSdkAreaArgs,
): NotificationsArea {
  const { transport } = args;
  // Resolve lazily, like every other area: the CLI test harness builds the SDK
  // over a partial hono client, and an eager dereference here would throw for
  // every command that never touches notifications.
  const endpoint = () => transport.api.v1.notifications["push-subscriptions"];
  const pushSubscriptions: PushSubscriptionsArea = {
    async add(input) {
      const response = await transport.resolve(
        endpoint().$post({ json: input }),
      );
      const body: unknown = await response.json();
      return {
        created: response.status === 201,
        subscription: pushSubscriptionSchema.parse(body),
      };
    },
    async list(input) {
      const body = await transport.readJson(
        endpoint().$get({}, ...signalRequestArgs(input?.signal)),
      );
      return pushSubscriptionListResponseSchema.parse(body).subscriptions;
    },
    async remove(input) {
      const body = await transport.readJson(
        endpoint()[":id"].$delete({ param: { id: input.id } }),
      );
      return deletePushSubscriptionResponseSchema.parse(body);
    },
  };
  return { pushSubscriptions };
}

import type {
  DeletePushSubscriptionResponse,
  PushSubscription,
  PushSubscriptionSummary,
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
export type PushSubscriptionListResult = PushSubscriptionSummary[];

export type PushSubscriptionAddArgs = RegisterPushSubscriptionRequest;
export interface PushSubscriptionAddResult {
  created: boolean;
  subscription: PushSubscription;
}

export interface PushSubscriptionRemoveArgs {
  id: string;
}
export type PushSubscriptionRemoveResult = DeletePushSubscriptionResponse;

export interface PushSubscriptionsArea {
  add(args: PushSubscriptionAddArgs): Promise<PushSubscriptionAddResult>;
  list(args?: PushSubscriptionListArgs): Promise<PushSubscriptionListResult>;
  remove(
    args: PushSubscriptionRemoveArgs,
  ): Promise<PushSubscriptionRemoveResult>;
}

export interface NotificationsArea {
  pushSubscriptions: PushSubscriptionsArea;
}

export function createNotificationsArea(
  args: CreateSdkAreaArgs,
): NotificationsArea {
  const { transport } = args;
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

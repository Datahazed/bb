import { createNodeBbSdk, type BbSdk, type BbSdkContext } from "@bb/sdk/node";
import type { ClaimedIdentity } from "@bb/domain";

export interface CreateCliBbSdkOptions {
  context?: BbSdkContext;
  claimedIdentity?: ClaimedIdentity;
}

export function cliFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  return fetch(input, init);
}

export function createCliBbSdk(
  baseUrl: string,
  options: CreateCliBbSdkOptions = {},
): BbSdk {
  return createNodeBbSdk({
    baseUrl,
    context: options.context,
    ...(options.claimedIdentity
      ? { claimedIdentity: options.claimedIdentity }
      : {}),
    fetch: cliFetch,
  });
}

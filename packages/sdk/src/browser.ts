import { createBbSdk, type BbSdk } from "./core.js";
import type { ClaimedIdentity } from "@bb/domain";
import { createHttpTransport } from "./transport-http.js";
import type {
  BbRealtimeSocketFactory,
  BbSdkContext,
  BbSdkTransport,
} from "./transport.js";

export interface CreateBrowserTransportArgs {
  baseUrl?: string;
  claimedIdentity?: ClaimedIdentity;
  fetch?: typeof fetch;
  realtimeUrl?: string;
  websocket?: BbRealtimeSocketFactory;
}

export interface CreateBrowserBbSdkArgs extends CreateBrowserTransportArgs {
  context?: BbSdkContext;
}

export function createBrowserTransport(
  args: CreateBrowserTransportArgs = {},
): BbSdkTransport {
  return createHttpTransport({
    baseUrl: args.baseUrl,
    ...(args.claimedIdentity ? { claimedIdentity: args.claimedIdentity } : {}),
    fetch: args.fetch,
    realtimeUrl: args.realtimeUrl,
    runtime: "browser",
    websocket: args.websocket,
  });
}

export function createBrowserBbSdk(args: CreateBrowserBbSdkArgs = {}): BbSdk {
  return createBbSdk({
    context: args.context,
    transport: createBrowserTransport(args),
  });
}

export const bb = createBrowserBbSdk();

export { BbHttpError, BbRequestTimeoutError } from "./response.js";
export type { BbHttpErrorArgs } from "./response.js";
export { createBbSdk, createHttpTransport };
export type { BbSdk, BbSdkContext, BbSdkTransport };
export type * from "./public-types.js";

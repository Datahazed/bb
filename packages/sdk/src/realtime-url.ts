import type { BbSdkTransport } from "./transport.js";

export interface ResolveRealtimeUrlArgs {
  transport: BbSdkTransport;
}

interface WebsocketUrlFromHttpUrlArgs {
  /**
   * Whether the URL's path is a server mount prefix to keep (configured
   * baseUrl behind a reverse proxy) or an SPA page path to discard
   * (same-origin browser location).
   */
  preservePathPrefix: boolean;
  url: URL;
}

function websocketUrlFromHttpUrl(args: WebsocketUrlFromHttpUrlArgs): string {
  const websocketUrl = new URL(args.url.href);
  if (websocketUrl.protocol === "http:") {
    websocketUrl.protocol = "ws:";
  } else if (websocketUrl.protocol === "https:") {
    websocketUrl.protocol = "wss:";
  }
  websocketUrl.pathname = args.preservePathPrefix
    ? `${args.url.pathname.replace(/\/+$/u, "")}/ws`
    : "/ws";
  websocketUrl.search = "";
  websocketUrl.hash = "";
  return websocketUrl.href;
}

function absoluteHttpBaseUrl(baseUrl: string): URL | null {
  try {
    const url = new URL(baseUrl);
    if (url.protocol === "http:" || url.protocol === "https:") {
      return url;
    }
    return null;
  } catch {
    return null;
  }
}

function browserSameOriginRealtimeUrl(): string | null {
  if (typeof location === "undefined") {
    return null;
  }
  const currentUrl = new URL(location.href);
  if (currentUrl.protocol !== "http:" && currentUrl.protocol !== "https:") {
    return null;
  }
  return websocketUrlFromHttpUrl({
    preservePathPrefix: false,
    url: currentUrl,
  });
}

export function resolveRealtimeUrl(args: ResolveRealtimeUrlArgs): string {
  const { transport } = args;
  let resolved: string;
  if (transport.realtimeUrl) {
    resolved = transport.realtimeUrl;
  } else {
    // Mirror the HTTP transport's derivation (`${baseUrl}/api/v1${path}`): a
    // path-prefixed baseUrl keeps its prefix for the websocket endpoint too.
    const absoluteBaseUrl = absoluteHttpBaseUrl(transport.baseUrl);
    if (absoluteBaseUrl) {
      resolved = websocketUrlFromHttpUrl({
        preservePathPrefix: true,
        url: absoluteBaseUrl,
      });
    } else if (transport.runtime === "browser") {
      const sameOriginUrl = browserSameOriginRealtimeUrl();
      if (!sameOriginUrl) {
        throw new Error(
          "BB SDK realtime requires an absolute baseUrl or realtimeUrl in this runtime.",
        );
      }
      resolved = sameOriginUrl;
    } else {
      throw new Error(
        "BB SDK realtime requires an absolute baseUrl or realtimeUrl in this runtime.",
      );
    }
  }

  if (transport.claimedIdentityHeader) {
    const url = new URL(resolved);
    url.searchParams.set("identity", transport.claimedIdentityHeader);
    return url.href;
  }
  return resolved;
}

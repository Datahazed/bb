import {
  APP_SURFACE_DESKTOP,
  APP_SURFACE_HEADER_NAME,
  APP_SURFACE_WEB,
  type AppSurface,
} from "@bb/config/app-surface";
import { CLAIMED_IDENTITY_HEADER } from "@bb/domain";
import { getClaimedIdentityHeaderValue } from "./claimed-identity-store";

export function getAppSurface(): AppSurface {
  if (typeof window !== "undefined" && window.bbDesktop !== undefined) {
    return APP_SURFACE_DESKTOP;
  }
  return APP_SURFACE_WEB;
}

export function appSurfaceRequestInit(init?: RequestInit): RequestInit {
  const headers = new Headers(init?.headers);
  headers.set(APP_SURFACE_HEADER_NAME, getAppSurface());
  // Remote sessions self-assert who they are on every request; absent identity
  // (desktop/localhost) falls back to the server's local-operator default.
  const claimedIdentity = getClaimedIdentityHeaderValue();
  if (claimedIdentity !== null) {
    headers.set(CLAIMED_IDENTITY_HEADER, claimedIdentity);
  }
  return {
    ...init,
    headers,
  };
}

export function fetchWithAppSurface(
  input: Parameters<typeof fetch>[0],
  init?: RequestInit,
): ReturnType<typeof fetch> {
  return fetch(input, appSurfaceRequestInit(init));
}

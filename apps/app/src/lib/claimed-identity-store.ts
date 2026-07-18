import { useSyncExternalStore } from "react";
import {
  claimedIdentitySchema,
  encodeClaimedIdentityHeader,
  normalizeHandle,
  type ClaimedIdentity,
} from "@bb/domain";

/**
 * Client-side owner of the CLAIMED multiplayer identity (see
 * @bb/domain/claimed-identity: self-asserted, attribution-only, never used for
 * authorization). The desktop shell and localhost browsers send no identity at
 * all — the server's local-operator default covers the single-player case —
 * so the store only activates for a remote web origin.
 */
const CLAIMED_IDENTITY_STORAGE_KEY = "bb.claimedIdentity";
const CLIENT_ID_STORAGE_KEY = "bb.claimedIdentity.clientId";

/**
 * True when this app instance is a remote browser session: not the desktop
 * shell (`window.bbDesktop`, same signal as getAppSurface) and not a localhost
 * origin. Only remote sessions claim an identity.
 */
export function isRemoteAppContext(): boolean {
  if (typeof window === "undefined" || window.bbDesktop !== undefined) {
    return false;
  }
  const hostname = window.location.hostname;
  return (
    hostname !== "localhost" &&
    hostname !== "127.0.0.1" &&
    hostname !== "[::1]" &&
    hostname !== "::1"
  );
}

function readStorage(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: string | null): void {
  try {
    if (value === null) {
      localStorage.removeItem(key);
    } else {
      localStorage.setItem(key, value);
    }
  } catch {
    // Best-effort persistence; private-mode/quota failures degrade to a
    // per-session identity.
  }
}

let cachedClientId: string | null = null;

/** Per-device presence-bookkeeping hint; generated once and persisted. */
function getOrCreateClientId(): string {
  if (cachedClientId !== null) {
    return cachedClientId;
  }
  const stored = readStorage(CLIENT_ID_STORAGE_KEY);
  if (stored !== null && stored.length > 0 && stored.length <= 64) {
    cachedClientId = stored;
    return stored;
  }
  const created = crypto.randomUUID();
  writeStorage(CLIENT_ID_STORAGE_KEY, created);
  cachedClientId = created;
  return created;
}

function readStoredIdentity(): ClaimedIdentity | null {
  const raw = readStorage(CLAIMED_IDENTITY_STORAGE_KEY);
  if (raw === null) {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  const result = claimedIdentitySchema.safeParse(parsed);
  if (!result.success) {
    return null;
  }
  const handle = normalizeHandle(result.data.handle);
  if (handle.length === 0) {
    return null;
  }
  return { ...result.data, handle };
}

let currentIdentity: ClaimedIdentity | null = readStoredIdentity();
const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of listeners) {
    listener();
  }
}

/**
 * The active claimed identity, or null when none applies. Always null outside
 * a remote app context so desktop/localhost requests carry no identity even if
 * a stale stored value exists (e.g. a copied browser profile).
 */
export function getClaimedIdentity(): ClaimedIdentity | null {
  return isRemoteAppContext() ? currentIdentity : null;
}

/** Encoded x-bb-claimed-identity value, or null when no identity applies. */
export function getClaimedIdentityHeaderValue(): string | null {
  const identity = getClaimedIdentity();
  return identity === null ? null : encodeClaimedIdentityHeader(identity);
}

/**
 * Claims an identity from a freeform display name (handle derived via
 * normalizeHandle). Returns the stored identity, or null when the name
 * normalizes to nothing.
 */
export function setClaimedDisplayName(
  displayName: string,
): ClaimedIdentity | null {
  const trimmed = displayName.trim().slice(0, 128);
  const handle = normalizeHandle(trimmed).slice(0, 64);
  if (trimmed.length === 0 || handle.length === 0) {
    return null;
  }
  const identity: ClaimedIdentity = {
    handle,
    displayName: trimmed,
    imageUrl: null,
    clientId: getOrCreateClientId(),
  };
  currentIdentity = identity;
  writeStorage(CLAIMED_IDENTITY_STORAGE_KEY, JSON.stringify(identity));
  notify();
  return identity;
}

export function clearClaimedIdentity(): void {
  if (currentIdentity === null) {
    return;
  }
  currentIdentity = null;
  writeStorage(CLAIMED_IDENTITY_STORAGE_KEY, null);
  notify();
}

export function subscribeClaimedIdentity(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Reactive claimed identity (null when absent or not a remote context). */
export function useClaimedIdentity(): ClaimedIdentity | null {
  return useSyncExternalStore(
    subscribeClaimedIdentity,
    getClaimedIdentity,
    () => null,
  );
}

/** Test-only: reset module state so each test starts from storage. */
export function resetClaimedIdentityStoreForTest(): void {
  cachedClientId = null;
  currentIdentity = readStoredIdentity();
  notify();
}

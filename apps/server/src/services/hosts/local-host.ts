import os from "node:os";
import type { Host } from "@bb/domain";
import { ApiError } from "../../errors.js";

/**
 * The single synthetic local host (plan §2 Decision 4, §4.1). With the daemon
 * transport gone, exactly one host exists: the server process itself. One
 * constant everywhere (risk R6) — the round-trip is three-way: REST host ids,
 * the local-API `/status` `hostId`, and the picker-submitted hostId must all
 * be this value, emitted and accepted alike.
 */
export const LOCAL_HOST_ID = "local";

/**
 * Stand-in for the daemon session id in surviving session-shaped seams: the
 * `pending_interactions.sessionId` column and the fabricated settlement
 * `commandRow.sessionId`. In-process there is exactly one "session" — the
 * engine, alive for the server's lifetime — so the value never varies. Dies
 * when those columns die (Phase 2).
 */
export const LOCAL_ENGINE_SESSION_ID = "local";

const BOOT_TIME = Date.now();

/**
 * The full-`hostSchema` synthetic host (Decision 4): the hosts table is dead
 * weight at runtime; this constant answers every host read. `lastSeenAt` is
 * "now" (the in-process host is always live), `createdAt`/`updatedAt` are the
 * server boot — the frozen FE reads `lastSeenAt` and spreads whole Host
 * objects, so every field matters (contract test `hosts.test.ts`).
 */
export function getLocalHost(): Host {
  return {
    id: LOCAL_HOST_ID,
    name: os.hostname(),
    type: "persistent",
    status: "connected",
    lastSeenAt: Date.now(),
    createdAt: BOOT_TIME,
    updatedAt: BOOT_TIME,
  };
}

/**
 * The single-host answer to every place the server used to resolve/validate a
 * request-supplied hostId against the hosts table: `'local'` is the one host
 * and is always connected (`host_unavailable` can no longer fire); anything
 * else does not exist.
 */
export function requireLocalHost(hostId: string): Host {
  if (hostId !== LOCAL_HOST_ID) {
    throw new ApiError(404, "host_not_found", "Host not found");
  }
  return getLocalHost();
}

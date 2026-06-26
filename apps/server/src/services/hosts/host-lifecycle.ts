import { getHost, getSessionById, heartbeatSession } from "@bb/db";
import type { WorkSessionDeps } from "../../types.js";
import { ApiError } from "../../errors.js";
import { requireConnectedHostSession } from "../lib/entity-lookup.js";

export async function ensureHostSessionReadyForWork(
  deps: WorkSessionDeps,
  args: { hostId: string },
) {
  const host = getHost(deps.db, args.hostId);
  if (!host || host.destroyedAt !== null) {
    throw new ApiError(404, "host_not_found", "Host not found");
  }

  try {
    return requireConnectedHostSession(deps, host.id);
  } catch (error) {
    const liveSessionId = deps.hub.getDaemonSessionIdForHost(host.id);
    if (!liveSessionId) {
      throw error;
    }
    const session = getSessionById(deps.db, { sessionId: liveSessionId });
    if (!session || session.hostId !== host.id || session.status !== "active") {
      throw error;
    }
    const renewedSession = heartbeatSession(
      deps.db,
      session.id,
      Date.now() + session.leaseTimeoutMs,
    );
    if (!renewedSession) {
      throw error;
    }
    return renewedSession;
  }
}

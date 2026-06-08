import type { SystemProvidersQuery } from "@bb/server-contract";
import type { AppDeps } from "../../types.js";
import { LOCAL_HOST_ID } from "../hosts/local-host.js";
import { requireEnvironment } from "../lib/entity-lookup.js";

export type SystemHostLookupQuery = Pick<
  SystemProvidersQuery,
  "environmentId" | "hostId"
>;

/**
 * Resolves the host id a system lookup is scoped to. The query parameters
 * stay accepted per the frozen contract (plan §4.1), but the daemon-era
 * connected-host and hosts-table validation died with the transport — every
 * lookup is answered by the in-process engine, so only the environment
 * reference (a real row) is validated.
 */
export function resolveSystemLookupHostId(
  deps: AppDeps,
  query: SystemHostLookupQuery,
): string {
  if (query.environmentId) {
    const environment = requireEnvironment(deps.db, query.environmentId);
    return environment.hostId;
  }
  if (query.hostId) {
    return query.hostId;
  }
  return LOCAL_HOST_ID;
}

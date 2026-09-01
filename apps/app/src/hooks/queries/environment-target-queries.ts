import { useQuery } from "@tanstack/react-query";
import type { SystemEnvironmentTarget } from "@bb/server-contract";
import { sdk } from "@/lib/sdk";
import { SERVER_SESSION_QUERY_POLICY } from "./query-policies";

const SYSTEM_ENVIRONMENT_TARGETS_QUERY_KEY = "systemEnvironmentTargets";

export function systemEnvironmentTargetsQueryKey(): readonly [
  typeof SYSTEM_ENVIRONMENT_TARGETS_QUERY_KEY,
] {
  return [SYSTEM_ENVIRONMENT_TARGETS_QUERY_KEY];
}

const NO_ENVIRONMENT_TARGETS: readonly SystemEnvironmentTarget[] = [];

export function useSystemEnvironmentTargets(): {
  targets: readonly SystemEnvironmentTarget[] | undefined;
} {
  const query = useQuery({
    queryKey: systemEnvironmentTargetsQueryKey(),
    queryFn: async () => (await sdk.system.environmentTargets()).targets,
    ...SERVER_SESSION_QUERY_POLICY,
  });
  return { targets: query.isError ? NO_ENVIRONMENT_TARGETS : query.data };
}

import type { QueryClientArg } from "../cache-effect-types";
import {
  projectSkillsQueryKey,
  skillContentQueryKey,
} from "../queries/query-keys";
import { invalidateQueryKeys } from "./cache-effect-utils";

interface SkillContentInvalidationArg extends QueryClientArg {
  projectId: string;
  scope: string;
  name: string;
}

/**
 * Invalidate a skill's cached SKILL.md and the project skills list after an
 * update. Centralized here so the skills mutation hooks stay off raw cache
 * writes.
 */
export function invalidateSkillContentMutationQueries({
  projectId,
  scope,
  name,
  queryClient,
}: SkillContentInvalidationArg): void {
  invalidateQueryKeys({
    queryClient,
    queryKeys: [
      skillContentQueryKey(projectId, scope, name),
      projectSkillsQueryKey(projectId),
    ],
  });
}

interface ProjectSkillsInvalidationArg extends QueryClientArg {
  projectId: string;
}

/** Invalidate the project skills list after a skill is deleted. */
export function invalidateProjectSkillsMutationQueries({
  projectId,
  queryClient,
}: ProjectSkillsInvalidationArg): void {
  invalidateQueryKeys({
    queryClient,
    queryKeys: [projectSkillsQueryKey(projectId)],
  });
}

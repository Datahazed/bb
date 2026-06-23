import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  DeleteSkillRequest,
  SkillSummary,
  UpdateSkillRequest,
} from "@bb/server-contract";
import * as api from "@/lib/api";

const PROJECT_SKILLS_QUERY_KEY = "projectSkills";
const SKILL_CONTENT_QUERY_KEY = "skillContent";

function projectSkillsKey(projectId: string) {
  return [PROJECT_SKILLS_QUERY_KEY, projectId] as const;
}

function skillContentKey(projectId: string, scope: string, name: string) {
  return [SKILL_CONTENT_QUERY_KEY, projectId, scope, name] as const;
}

/**
 * Skills discovered for a project's default workspace (user/builtin/provider
 * scopes plus that project's `.bb/skills`). The top-level Skills page passes the
 * personal project so it surfaces the user's global skill set.
 */
export function useProjectSkills(projectId: string) {
  return useQuery({
    queryKey: projectSkillsKey(projectId),
    queryFn: ({ signal }) =>
      api.listProjectSkills({ projectId, environmentId: null, signal }),
    enabled: projectId.length > 0,
    // Skills are on-disk files mutated out-of-band — agents write SKILL.md, and
    // users edit them in their own editor (the detail view's "Open in editor").
    // Always re-read from disk on mount/focus so the list never shows a stale set.
    staleTime: 0,
    refetchOnMount: "always",
  });
}

/** Read a skill's SKILL.md (lazily; only when a skill is selected). */
export function useSkillContent(
  projectId: string,
  skill: SkillSummary | null,
) {
  return useQuery({
    queryKey: skill
      ? skillContentKey(projectId, skill.scope, skill.name)
      : [SKILL_CONTENT_QUERY_KEY, projectId, "none"],
    queryFn: ({ signal }) =>
      api.getSkillContent({
        projectId,
        scope: skill!.scope,
        name: skill!.name,
        environmentId: null,
        signal,
      }),
    enabled: skill !== null && projectId.length > 0,
    // Re-read SKILL.md from disk every time the detail view opens or regains
    // focus — the user may have just edited the file in their own editor.
    staleTime: 0,
    refetchOnMount: "always",
  });
}

export function useUpdateSkill(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    meta: { errorMessage: "Failed to save skill." },
    mutationFn: (body: UpdateSkillRequest) =>
      api.updateSkillContent(projectId, body),
    onSuccess: (_data, variables) => {
      void queryClient.invalidateQueries({
        queryKey: skillContentKey(projectId, variables.scope, variables.name),
      });
      void queryClient.invalidateQueries({
        queryKey: projectSkillsKey(projectId),
      });
    },
  });
}

export function useDeleteSkill(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    meta: { errorMessage: "Failed to delete skill." },
    mutationFn: (body: DeleteSkillRequest) =>
      api.deleteProjectSkill(projectId, body),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: projectSkillsKey(projectId),
      });
    },
  });
}

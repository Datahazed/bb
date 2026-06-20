import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { DeleteSkillRequest } from "@bb/server-contract";
import * as api from "@/lib/api";

const PROJECT_SKILLS_QUERY_KEY = "projectSkills";

function projectSkillsKey(projectId: string) {
  return [PROJECT_SKILLS_QUERY_KEY, projectId] as const;
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

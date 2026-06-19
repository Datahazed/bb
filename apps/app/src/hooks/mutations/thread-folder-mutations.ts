import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { CreateThreadFolderRequest } from "@bb/server-contract";
import * as api from "@/lib/api";
import { invalidateProjectListQueries } from "../cache-owners/mutation-cache-effects";

export function useCreateThreadFolder() {
  const queryClient = useQueryClient();

  return useMutation({
    meta: {
      errorMessage: "Failed to create folder.",
    },
    mutationFn: (request: CreateThreadFolderRequest) =>
      api.createThreadFolder(request),
    onSuccess: () => {
      invalidateProjectListQueries({ queryClient });
    },
  });
}

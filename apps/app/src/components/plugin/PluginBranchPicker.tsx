import { useCallback, useMemo, useState } from "react";
import type { ExperimentalBranchPickerProps } from "@get-bb/plugin-sdk";
import { BranchPicker } from "@/components/pickers/BranchPicker";
import { useProjectSourceBranches } from "@/hooks/queries/project-queries";
import { buildRootComposeBranchUiState } from "@/views/root-compose-branch-ui";

export function PluginBranchPicker({
  hostId,
  projectId,
  value,
  onChange,
  disabled,
}: ExperimentalBranchPickerProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const enabled = hostId !== null && projectId !== null;
  const branchesQuery = useProjectSourceBranches(
    projectId ?? undefined,
    hostId,
    {
      enabled,
      query: searchQuery,
      selectedBranch: value ?? "",
    },
  );
  const branchOptions = useMemo(() => {
    if (!enabled) return [];
    const branches = branchesQuery.data?.branches ?? [];
    const selectedRef = branchesQuery.data?.selectedBranch;
    return selectedRef?.kind === "local" && !branches.includes(selectedRef.name)
      ? [selectedRef.name, ...branches]
      : branches;
  }, [
    branchesQuery.data?.branches,
    branchesQuery.data?.selectedBranch,
    enabled,
  ]);
  const remoteBranchOptions = useMemo(() => {
    if (!enabled) return [];
    const branches = branchesQuery.data?.remoteBranches ?? [];
    const selectedRef = branchesQuery.data?.selectedBranch;
    return selectedRef?.kind === "remote" &&
      !branches.includes(selectedRef.name)
      ? [selectedRef.name, ...branches]
      : branches;
  }, [
    branchesQuery.data?.remoteBranches,
    branchesQuery.data?.selectedBranch,
    enabled,
  ]);
  const selectedBranch = useMemo(
    () => (value === null ? null : { name: value, isNew: false }),
    [value],
  );
  const uiState = useMemo(
    () =>
      buildRootComposeBranchUiState({
        checkout: branchesQuery.data,
        isFetching: branchesQuery.isFetching,
        isLoading: branchesQuery.isLoading,
        mode: "worktree",
        selectedBranch,
      }),
    [
      branchesQuery.data,
      branchesQuery.isFetching,
      branchesQuery.isLoading,
      selectedBranch,
    ],
  );
  const refreshFromRemote = branchesQuery.refreshFromRemote;
  const handleOpenChange = useCallback(
    (open: boolean) => {
      if (open && enabled) {
        void refreshFromRemote().catch(() => undefined);
      }
    },
    [enabled, refreshFromRemote],
  );
  const handleChange = useCallback(
    (branch: string) => onChange(branch),
    [onChange],
  );
  const handleClear = useCallback(() => onChange(null), [onChange]);

  return (
    <BranchPicker
      variant="option"
      muted
      value={value}
      options={branchOptions}
      remoteOptions={remoteBranchOptions}
      loading={enabled && branchesQuery.isFetching}
      placeholder={uiState.placeholder}
      triggerLabel={uiState.triggerLabel}
      triggerTitle={uiState.triggerTitle}
      menuKind="base"
      disabled={!enabled || disabled === true}
      onChange={handleChange}
      onClear={handleClear}
      onOpenChange={handleOpenChange}
      onSearchQueryChange={setSearchQuery}
    />
  );
}

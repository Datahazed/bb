import { useMemo } from "react";
import { resolveEnvironmentMergeBaseBranch } from "@bb/domain";
import { GIT_DIFF_VIEW_BASE_OPTIONS } from "@/components/git-diff/GitDiffCard";
import { useGitDiffPanelState } from "@/components/secondary-panel/git-diff/useGitDiffPanelState";
import { GitDiffTabContent } from "@/components/secondary-panel/ThreadSecondaryPanelTabContent";
import { usePreferredTheme } from "@/hooks/useTheme";
import { useEnvironment } from "@/hooks/queries/environment-queries";
import { useThread } from "@/hooks/queries/thread-queries";

function DiffPlaceholder({ children }: { children: string }) {
  return (
    <div className="flex min-h-0 min-w-0 flex-1 items-center justify-center px-4 text-center text-sm text-muted-foreground">
      {children}
    </div>
  );
}

export function DiffPaneContent({
  projectId,
  threadId,
}: {
  projectId: string;
  threadId: string;
}) {
  const threadQuery = useThread(threadId);
  const environmentId = threadQuery.data?.environmentId;
  const environmentQuery = useEnvironment(environmentId);
  const preferredTheme = usePreferredTheme();
  const defaultMergeBaseBranch = resolveEnvironmentMergeBaseBranch(
    environmentQuery.data,
  );
  const { gitDiffTarget } = useGitDiffPanelState({
    environmentId: environmentId ?? undefined,
    isDiffPanelActive: true,
    defaultMergeBaseBranch,
  });
  const gitDiffViewOptions = useMemo(
    () => ({
      ...GIT_DIFF_VIEW_BASE_OPTIONS,
      diffStyle: "unified",
      themeType: preferredTheme,
    }),
    [preferredTheme],
  );

  if (
    threadQuery.data === undefined &&
    (threadQuery.isLoading || threadQuery.isFetching)
  ) {
    return <DiffPlaceholder>Loading diff…</DiffPlaceholder>;
  }

  if (
    threadQuery.data === undefined ||
    threadQuery.data.projectId !== projectId
  ) {
    return <DiffPlaceholder>Diff unavailable</DiffPlaceholder>;
  }

  if (environmentId === null) {
    return (
      <DiffPlaceholder>
        Diff unavailable: thread has no environment
      </DiffPlaceholder>
    );
  }

  if (
    environmentQuery.data === undefined &&
    (environmentQuery.isLoading || environmentQuery.isFetching)
  ) {
    return <DiffPlaceholder>Loading diff…</DiffPlaceholder>;
  }

  if (environmentQuery.data === undefined) {
    return <DiffPlaceholder>Diff unavailable</DiffPlaceholder>;
  }

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-background">
      <GitDiffTabContent
        environmentId={environmentId}
        target={gitDiffTarget}
        isDiffPanelActive
        gitDiffViewOptions={gitDiffViewOptions}
        workspaceRootPath={environmentQuery.data.path}
      />
    </div>
  );
}

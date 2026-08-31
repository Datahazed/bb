import { useRef, useState } from "react";
import {
  EnvironmentRenameDialog,
  type EnvironmentRenameDialogTarget,
} from "@/components/dialogs/EnvironmentRenameDialog";
import {
  ThreadMetadataContent,
  type ThreadMetadataContentProps,
} from "./ThreadMetadataContent";
import {
  PanelStage,
  baseProps,
  makePullRequest,
  makeThread,
} from "./ThreadMetadataContent.fixtures";
import { StoryCard, StoryRow } from "../../../.ladle/story-card";

export default {
  title: "right-panel/Info",
};

function render(overrides: Partial<ThreadMetadataContentProps>) {
  return <MetadataFixture overrides={overrides} />;
}

function MetadataFixture({
  overrides,
}: {
  overrides: Partial<ThreadMetadataContentProps>;
}) {
  const initialEnvironment = Object.prototype.hasOwnProperty.call(
    overrides,
    "environment",
  )
    ? (overrides.environment ?? null)
    : baseProps.environment;
  const [environmentName, setEnvironmentName] = useState<string | null>(
    initialEnvironment?.name ?? null,
  );
  const [renameTarget, setRenameTarget] =
    useState<EnvironmentRenameDialogTarget | null>(null);
  const renameTriggerRef = useRef<HTMLElement | null>(null);
  const environment = initialEnvironment
    ? { ...initialEnvironment, name: environmentName }
    : null;
  const workspaceStatus = Object.prototype.hasOwnProperty.call(
    overrides,
    "workspaceStatus",
  )
    ? overrides.workspaceStatus
    : baseProps.workspaceStatus;
  const canRenameWorktree =
    environment?.status === "ready" &&
    (environment.isWorktree ||
      environment.workspaceProvisionType === "managed-worktree");
  const closeRename = () => {
    const renameTrigger = renameTriggerRef.current;
    renameTriggerRef.current = null;
    setRenameTarget(null);
    requestAnimationFrame(() => {
      if (renameTrigger?.isConnected) renameTrigger.focus();
    });
  };

  return (
    <>
      <PanelStage>
        <ThreadMetadataContent
          {...baseProps}
          {...overrides}
          environment={environment}
          workspaceStatus={workspaceStatus}
          {...(canRenameWorktree && environment
            ? {
                onRenameWorktree: () => {
                  renameTriggerRef.current =
                    document.activeElement instanceof HTMLElement
                      ? document.activeElement
                      : null;
                  setRenameTarget({
                    ...(workspaceStatus?.checkout.kind === "branch"
                      ? { branchName: workspaceStatus.checkout.branchName }
                      : {}),
                    id: environment.id,
                    currentName: environment.name ?? "",
                    canClearName: environment.name !== null,
                  });
                },
              }
            : {})}
        />
      </PanelStage>
      <EnvironmentRenameDialog
        target={renameTarget}
        pending={false}
        onOpenChange={(open) => {
          if (!open) closeRename();
        }}
        onRename={(_environmentId, nextName) => {
          setEnvironmentName(nextName);
          closeRename();
        }}
      />
    </>
  );
}

export function Overview() {
  return (
    <StoryCard>
      <StoryRow
        label="standard"
        hint="canonical state — worktree + machine + path + Git context + pull request"
        className="max-sm:grid-cols-1 max-sm:gap-y-3"
      >
        {render({
          pullRequest: makePullRequest(),
        })}
      </StoryRow>
      <StoryRow
        label="standard, child thread"
        hint="thread.parentThreadId set — selector renders the link form"
        className="max-sm:grid-cols-1 max-sm:gap-y-3"
      >
        {render({
          thread: makeThread({ parentThreadId: "thr_codex_parent" }),
          parentThreadProjectId: null,
          parentThreadDisplayName: "Codex Parent",
          canAssignToParent: false,
          canTakeOverThread: true,
        })}
      </StoryRow>
      <StoryRow
        label="standard, archived"
        hint="thread.archivedAt set — Archived row + unarchive button render"
        className="max-sm:grid-cols-1 max-sm:gap-y-3"
      >
        {render({
          thread: makeThread({ archivedAt: 1_700_000_000_000 }),
        })}
      </StoryRow>
      <StoryRow
        label="parent thread"
        hint="parent thread with no environment — environment/branch/merge-base hidden"
        className="max-sm:grid-cols-1 max-sm:gap-y-3"
      >
        {render({
          thread: makeThread({
            title: "Codex Parent",
            titleFallback: "Codex Parent",
            environmentId: null,
          }),
          environment: null,
          environmentHostName: "",
          workspaceStatus: undefined,
        })}
      </StoryRow>
    </StoryCard>
  );
}

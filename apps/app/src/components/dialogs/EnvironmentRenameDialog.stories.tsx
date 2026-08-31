import { useRef, useState } from "react";
import {
  EnvironmentRenameDialog,
  EnvironmentRenameDialogContent,
  type EnvironmentRenameDialogTarget,
} from "./EnvironmentRenameDialog";
import { StoryCard, StoryRow } from "../../../.ladle/story-card";
import { DialogStage } from "../../../.ladle/story-dialog-stage";

export default {
  title: "dialogs/Worktree Rename",
};

const STORY_BRANCH_NAME = "bb/design-system-polish";

const unnamedTarget: EnvironmentRenameDialogTarget = {
  id: "env_unnamed",
  currentName: "",
  branchName: STORY_BRANCH_NAME,
  canClearName: false,
};

const customNameTarget: EnvironmentRenameDialogTarget = {
  id: "env_named",
  currentName: "Design system polish",
  branchName: STORY_BRANCH_NAME,
  canClearName: true,
};

interface ContentFixtureProps {
  target: EnvironmentRenameDialogTarget;
  pending?: boolean;
  errorMessage?: string;
}

function ContentFixture({
  target,
  pending = false,
  errorMessage,
}: ContentFixtureProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [savedName, setSavedName] = useState<string | null>(
    target.currentName || null,
  );
  const [currentError, setCurrentError] = useState(errorMessage);
  const currentTarget = {
    ...target,
    currentName: savedName ?? "",
    canClearName: savedName !== null,
  };

  return (
    <div className="w-full space-y-2">
      <DialogStage>
        <EnvironmentRenameDialogContent
          key={`${target.id}:${savedName ?? "unnamed"}`}
          target={currentTarget}
          pending={pending}
          errorMessage={currentError}
          onRename={(_environmentId, nextName) => {
            setSavedName(nextName);
            setCurrentError(undefined);
          }}
          inputRef={inputRef}
        />
      </DialogStage>
      <p className="text-xs text-muted-foreground">
        Saved metadata: {savedName ?? "none"}
      </p>
    </div>
  );
}

function ResponsiveDialogFixture() {
  const [name, setName] = useState<string | null>("Design system polish");
  const [target, setTarget] = useState<EnvironmentRenameDialogTarget | null>({
    ...customNameTarget,
  });
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const closeDialog = () => {
    setTarget(null);
    requestAnimationFrame(() => triggerRef.current?.focus());
  };
  const openDialog = () => {
    setTarget({
      ...customNameTarget,
      currentName: name ?? "",
      canClearName: name !== null,
    });
  };

  return (
    <div className="flex min-h-[80dvh] flex-col items-center justify-center gap-2 p-6">
      <button
        ref={triggerRef}
        type="button"
        className="rounded-md border px-3 py-2 text-sm"
        onClick={openDialog}
      >
        {name === null ? "Name worktree" : `Rename ${name}`}
      </button>
      <p className="text-xs text-muted-foreground">
        Saved metadata: {name ?? "none"}
      </p>
      <EnvironmentRenameDialog
        target={target}
        pending={false}
        onOpenChange={(open) => {
          if (!open) closeDialog();
        }}
        onRename={(_environmentId, nextName) => {
          setName(nextName);
          closeDialog();
        }}
      />
    </div>
  );
}

export function Overview() {
  return (
    <StoryCard>
      <StoryRow label="branch placeholder" hint="unnamed worktree">
        <ContentFixture target={unnamedTarget} />
      </StoryRow>
      <StoryRow label="custom name" hint="clear removes display-name metadata">
        <ContentFixture target={customNameTarget} />
      </StoryRow>
      <StoryRow label="pending" hint="submit in flight">
        <ContentFixture target={customNameTarget} pending />
      </StoryRow>
      <StoryRow label="server error" hint="mutation error surfaced">
        <ContentFixture
          target={customNameTarget}
          errorMessage="Worktree name must be 80 characters or fewer."
        />
      </StoryRow>
    </StoryCard>
  );
}

export function Responsive() {
  return <ResponsiveDialogFixture />;
}

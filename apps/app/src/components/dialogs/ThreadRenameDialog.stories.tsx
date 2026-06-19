import { useRef } from "react";
import { ThreadRenameDialogContent } from "./ThreadRenameDialog";
import { StoryCard, StoryRow } from "../../../.ladle/story-card";
import { DialogStage } from "../../../.ladle/story-dialog-stage";

export default {
  title: "dialogs/Thread Rename",
};

const noop = () => {};

function RenameStory({
  draft,
  validationMessage = null,
  pending = false,
}: {
  draft: string;
  validationMessage?: string | null;
  pending?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  return (
    <DialogStage>
      <ThreadRenameDialogContent
        draft={draft}
        validationMessage={validationMessage}
        pending={pending}
        onDraftChange={noop}
        onSubmit={noop}
        inputRef={inputRef}
      />
    </DialogStage>
  );
}

export function Overview() {
  return (
    <StoryCard>
      <StoryRow label="default" hint="single segment — preview reads “No folder”">
        <RenameStory draft="Audit recurring permission failures" />
      </StoryRow>
      <StoryRow
        label="folder preview"
        hint="“/” reveals the folder + leaf beneath the input"
      >
        <RenameStory draft="Work/Q3/Planning" />
      </StoryRow>
      <StoryRow
        label="normalization (trailing/doubled slash)"
        hint="preview reflects the normalized path, not the raw text"
      >
        <RenameStory draft="/Work//Q3/Planning/" />
      </StoryRow>
      <StoryRow
        label="empty after normalize"
        hint="all-slashes draft submits to an empty-name validation error"
      >
        <RenameStory draft="///" validationMessage="Thread name cannot be empty." />
      </StoryRow>
      <StoryRow
        label="pending"
        hint="submit in flight — input and submit are disabled"
      >
        <RenameStory draft="Audit recurring permission failures" pending />
      </StoryRow>
      <StoryRow
        label="long title"
        hint="input overflows horizontally inside the dialog frame"
      >
        <RenameStory draft="Investigate slow tests on recurring CI failures after the timeline pagination v2 merge" />
      </StoryRow>
    </StoryCard>
  );
}

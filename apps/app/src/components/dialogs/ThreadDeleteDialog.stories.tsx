import { ThreadDeleteDialogContent } from "./ThreadDeleteDialog";
import { makeThread } from "../../../.ladle/story-fixtures";
import { StoryCard, StoryRow } from "../../../.ladle/story-card";
import { DialogStage } from "../../../.ladle/story-dialog-stage";

export default {
  title: "dialogs/Thread Delete",
};

const noop = () => {};

const standardThread = makeThread();

export function Thread() {
  return (
    <StoryCard>
      <StoryRow
        label="clean workspace"
        hint="basic confirm — no warnings, just 'cannot be undone'"
      >
        <DialogStage>
          <ThreadDeleteDialogContent
            target={{ thread: standardThread }}
            pending={false}
            onOpenChange={noop}
            onDelete={noop}
          />
        </DialogStage>
      </StoryRow>
      <StoryRow label="pending" hint="delete request in flight">
        <DialogStage>
          <ThreadDeleteDialogContent
            target={{ thread: standardThread }}
            pending
            onOpenChange={noop}
            onDelete={noop}
          />
        </DialogStage>
      </StoryRow>
    </StoryCard>
  );
}

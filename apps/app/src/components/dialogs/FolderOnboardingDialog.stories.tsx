import { StoryCard, StoryRow } from "../../../.ladle/story-card";
import { DialogStage } from "../../../.ladle/story-dialog-stage";
import { FolderOnboardingDialogContent } from "./FolderOnboardingDialog";

export default {
  title: "dialogs/Folder onboarding",
};

const noop = () => {};

function OnboardingStory({
  pathLabel,
  pending = false,
  showGroupingHint = true,
}: {
  pathLabel: string;
  pending?: boolean;
  showGroupingHint?: boolean;
}) {
  return (
    <DialogStage>
      <FolderOnboardingDialogContent
        pathLabel={pathLabel}
        showGroupingHint={showGroupingHint}
        pending={pending}
        onConfirm={noop}
        onCancel={noop}
      />
    </DialogStage>
  );
}

export function Overview() {
  return (
    <StoryCard>
      <StoryRow label="default" hint="first folder creation, grouping off">
        <OnboardingStory pathLabel="Work / Q3 / Planning" />
      </StoryRow>
      <StoryRow label="grouping already on" hint="no auto-enable hint">
        <OnboardingStory
          pathLabel="Clients / Acme / Onboarding"
          showGroupingHint={false}
        />
      </StoryRow>
      <StoryRow label="long path" hint="preview wraps in the dialog body">
        <OnboardingStory pathLabel="Customers / Enterprise rollout / Migration planning / Cutover checklist" />
      </StoryRow>
      <StoryRow label="pending" hint="buttons disabled while rename submits">
        <OnboardingStory pathLabel="Work / Q4 / Roadmap" pending />
      </StoryRow>
    </StoryCard>
  );
}

import {
  formatEnvironmentDisplay,
  type EnvironmentDisplayHostContext,
} from "@bb/core-ui";
import { ThreadEnvironmentSummary } from "@/components/promptbox/ThreadEnvironmentSummary";
import { getEnvironmentWorkspaceSummaryDisplay } from "@/lib/environment-workspace-display";
import { formatWorkspaceCheckoutDisplay } from "@/lib/workspace-checkout-display";
import { useWorktreeNameStoryState } from "../../../.ladle/worktree-name-story-fixture";
import { StoryCard, StoryRow } from "../../../.ladle/story-card";
import {
  EnvironmentRow,
  MachineRow,
  ThreadMetadataCard,
} from "./ThreadMetadataContent";
import {
  PanelStage,
  makeEnvironment,
  makeThread,
} from "./ThreadMetadataContent.fixtures";

export default {
  title: "right-panel/Info/Worktree",
};

const noop = () => {};
const STORY_BRANCH_NAME = "bb/design-system-polish";
const STORY_WORKTREE_NAME = "Design system polish";
const STORY_LONG_WORKTREE_NAME =
  "internal-tooling-ingest-pipeline-rewrite-2026-cross-platform-rollout-monitoring";
const STORY_HOST_NAME = "Bersabel's MacBook Pro";
const STORY_CHECKOUT_DISPLAY = formatWorkspaceCheckoutDisplay({
  checkout: {
    kind: "branch",
    branchName: STORY_BRANCH_NAME,
    headSha: null,
  },
});
const localEnvironmentDisplayHost: EnvironmentDisplayHostContext = {
  locality: "local",
  identity: null,
};

interface WorktreeNamingFixtureProps {
  fixtureId: string;
  initialName: string | null;
}

function WorktreeNamingFixture({
  fixtureId,
  initialName,
}: WorktreeNamingFixtureProps) {
  const environmentId = `env_${fixtureId}`;
  const { name, onRenameWorktree, renameDialog } = useWorktreeNameStoryState({
    environmentId,
    initialName,
    branchName: STORY_BRANCH_NAME,
  });
  const environment = makeEnvironment({
    id: environmentId,
    name,
    isWorktree: true,
    workspaceProvisionType: "managed-worktree",
    status: "ready",
  });
  const display = formatEnvironmentDisplay({
    environment,
    host: localEnvironmentDisplayHost,
  });
  const summaryDisplay = getEnvironmentWorkspaceSummaryDisplay({
    display,
    environmentName: name,
    hostName: STORY_HOST_NAME,
    locality: "local",
  });

  return (
    <>
      <div className="grid w-full min-w-0 gap-3 lg:grid-cols-2">
        <section className="min-w-0 space-y-1.5">
          <p className="text-xs font-medium text-muted-foreground">Composer</p>
          <div
            data-promptbox=""
            className="w-full min-w-0 rounded-md border bg-background p-3"
          >
            <ThreadEnvironmentSummary
              environmentLabel={summaryDisplay.label}
              environmentCompactLabel={summaryDisplay.compactLabel}
              environmentIcon={summaryDisplay.icon}
              environmentTypeLabel={summaryDisplay.typeLabel}
              environmentCheckout={STORY_CHECKOUT_DISPLAY}
              onRenameWorktree={name === null ? undefined : onRenameWorktree}
              onCreateNewThreadInWorktree={noop}
            />
          </div>
        </section>
        <section className="min-w-0 space-y-1.5">
          <p className="text-xs font-medium text-muted-foreground">Info</p>
          <PanelStage>
            <ThreadMetadataCard>
              <EnvironmentRow
                thread={makeThread({ environmentId })}
                environment={environment}
                environmentDisplayHost={localEnvironmentDisplayHost}
                onRenameWorktree={onRenameWorktree}
              />
              <MachineRow name={STORY_HOST_NAME} />
            </ThreadMetadataCard>
          </PanelStage>
        </section>
      </div>
      {renameDialog}
    </>
  );
}

export function Naming() {
  return (
    <StoryCard>
      <StoryRow
        label="custom name"
        hint="rename from Composer or Info; both surfaces update together"
        className="max-sm:grid-cols-1 max-sm:gap-y-3"
      >
        <WorktreeNamingFixture
          fixtureId="custom"
          initialName={STORY_WORKTREE_NAME}
        />
      </StoryRow>
      <StoryRow
        label="maximum-length custom name"
        hint="valid 79-character metadata truncates within each surface"
        className="max-sm:grid-cols-1 max-sm:gap-y-3"
      >
        <WorktreeNamingFixture
          fixtureId="long"
          initialName={STORY_LONG_WORKTREE_NAME}
        />
      </StoryRow>
      <StoryRow
        label="no custom name"
        hint="Composer uses the machine fallback; Info provides Add name"
        className="max-sm:grid-cols-1 max-sm:gap-y-3"
      >
        <WorktreeNamingFixture fixtureId="unnamed" initialName={null} />
      </StoryRow>
    </StoryCard>
  );
}

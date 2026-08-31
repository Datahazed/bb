import {
  formatEnvironmentDisplay,
  type EnvironmentDisplayHostContext,
} from "@bb/core-ui";
import { ThreadEnvironmentSummary } from "@/components/promptbox/ThreadEnvironmentSummary";
import {
  getEnvironmentWorkspaceSummaryDisplay,
  shouldShowWorktreeMachineInComposer,
} from "@/lib/environment-workspace-display";
import { formatWorkspaceCheckoutDisplay } from "@/lib/workspace-checkout-display";
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

interface WorktreeMachineVisibilityFixtureProps {
  connected: boolean;
  locality: "local" | "remote";
  machineCount: number;
  machineName: string;
}

function WorktreeMachineVisibilityFixture({
  connected,
  locality,
  machineCount,
  machineName,
}: WorktreeMachineVisibilityFixtureProps) {
  const environment = makeEnvironment({
    name: STORY_WORKTREE_NAME,
    isWorktree: true,
    workspaceProvisionType: "managed-worktree",
    status: "ready",
  });
  const host: EnvironmentDisplayHostContext = {
    locality,
    identity: null,
  };
  const display = formatEnvironmentDisplay({ environment, host });
  const summaryDisplay = getEnvironmentWorkspaceSummaryDisplay({
    display,
    environmentName: environment.name,
    hostName: machineName,
  });
  const showMachine = shouldShowWorktreeMachineInComposer({
    connected,
    hasCustomName: environment.name !== null,
    locality,
    machineCount,
  });

  return (
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
        machineName={showMachine ? machineName : undefined}
        machineConnected={showMachine ? connected : undefined}
      />
    </div>
  );
}

interface WorktreeNamingFixtureProps {
  fixtureId: string;
  name: string | null;
}

function WorktreeNamingFixture({
  fixtureId,
  name,
}: WorktreeNamingFixtureProps) {
  const environmentId = `env_${fixtureId}`;
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
  });

  return (
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
            />
            <MachineRow name={STORY_HOST_NAME} />
          </ThreadMetadataCard>
        </PanelStage>
      </section>
    </div>
  );
}

export function Presentation() {
  return (
    <StoryCard>
      <StoryRow
        label="custom name"
        hint="existing custom metadata is read-only in Composer and Info"
        className="max-sm:grid-cols-1 max-sm:gap-y-3"
      >
        <WorktreeNamingFixture fixtureId="custom" name={STORY_WORKTREE_NAME} />
      </StoryRow>
      <StoryRow
        label="maximum-length custom name"
        hint="valid 79-character metadata truncates without edit controls"
        className="max-sm:grid-cols-1 max-sm:gap-y-3"
      >
        <WorktreeNamingFixture
          fixtureId="long"
          name={STORY_LONG_WORKTREE_NAME}
        />
      </StoryRow>
      <StoryRow
        label="no custom name"
        hint="Composer uses the machine fallback; Info reports Unnamed"
        className="max-sm:grid-cols-1 max-sm:gap-y-3"
      >
        <WorktreeNamingFixture fixtureId="unnamed" name={null} />
      </StoryRow>
    </StoryCard>
  );
}

export function MachineVisibility() {
  return (
    <StoryCard>
      <StoryRow
        label="single local machine"
        hint="machine hidden because it adds no new context"
      >
        <WorktreeMachineVisibilityFixture
          connected
          locality="local"
          machineCount={1}
          machineName={STORY_HOST_NAME}
        />
      </StoryRow>
      <StoryRow
        label="remote machine"
        hint="machine shown because the worktree runs remotely"
      >
        <WorktreeMachineVisibilityFixture
          connected
          locality="remote"
          machineCount={1}
          machineName="Build Mac mini"
        />
      </StoryRow>
      <StoryRow
        label="offline machine"
        hint="issue icon explains Offline; name tooltip reveals the full machine name"
      >
        <WorktreeMachineVisibilityFixture
          connected={false}
          locality="local"
          machineCount={1}
          machineName={STORY_HOST_NAME}
        />
      </StoryRow>
      <StoryRow
        label="multiple machines"
        hint="machine shown to distinguish which machine owns the worktree"
      >
        <WorktreeMachineVisibilityFixture
          connected
          locality="local"
          machineCount={2}
          machineName={STORY_HOST_NAME}
        />
      </StoryRow>
    </StoryCard>
  );
}

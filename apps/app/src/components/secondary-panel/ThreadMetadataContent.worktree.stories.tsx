import type { ReactNode } from "react";
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

function StorySection({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <section>
      <header className="mx-10 mt-6 max-w-3xl space-y-1">
        <h2 className="text-sm font-medium text-foreground">{title}</h2>
        <p className="text-xs text-muted-foreground">{description}</p>
      </header>
      <StoryCard className="!mt-2">{children}</StoryCard>
    </section>
  );
}

function ScenarioRow({
  label,
  howItHappens,
  whatAppears,
  children,
}: {
  label: string;
  howItHappens: string;
  whatAppears: string;
  children: ReactNode;
}) {
  return (
    <StoryRow
      label={label}
      className="max-sm:grid-cols-1 max-sm:gap-y-3"
    >
      <div className="w-full min-w-0 space-y-3">
        <dl className="grid gap-1 text-xs text-muted-foreground">
          <div>
            <dt className="inline font-medium text-foreground">
              How it happens:{" "}
            </dt>
            <dd className="inline">{howItHappens}</dd>
          </div>
          <div>
            <dt className="inline font-medium text-foreground">
              What appears:{" "}
            </dt>
            <dd className="inline">{whatAppears}</dd>
          </div>
        </dl>
        {children}
      </div>
    </StoryRow>
  );
}

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
  const environmentId =
    `env_${locality}_${connected ? "connected" : "offline"}_${machineCount}`;
  const environment = makeEnvironment({
    id: environmentId,
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
    <div className="grid w-full min-w-0 gap-3 2xl:grid-cols-2">
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
            machineName={showMachine ? machineName : undefined}
            machineConnected={showMachine ? connected : undefined}
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
              environmentDisplayHost={host}
            />
            <MachineRow name={machineName} connected={connected} />
          </ThreadMetadataCard>
        </PanelStage>
      </section>
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
    <div className="grid w-full min-w-0 gap-3 2xl:grid-cols-2">
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

export function Overview() {
  return (
    <>
      <StorySection
        title="Worktree name"
        description="A worktree can have an optional name set from its sidebar row. When present, Composer and Info show it; editing stays in the sidebar."
      >
        <ScenarioRow
          label="Named"
          howItHappens="The user names the worktree from its sidebar row."
          whatAppears="Composer and Info show the custom display name; editing remains in the sidebar."
        >
          <WorktreeNamingFixture
            fixtureId="custom"
            name={STORY_WORKTREE_NAME}
          />
        </ScenarioRow>
        <ScenarioRow
          label="Long name"
          howItHappens="The user enters a long valid name in the sidebar rename dialog."
          whatAppears="Both surfaces truncate the display name without overlapping adjacent controls; the full value remains available in a tooltip."
        >
          <WorktreeNamingFixture
            fixtureId="long"
            name={STORY_LONG_WORKTREE_NAME}
          />
        </ScenarioRow>
        <ScenarioRow
          label="No custom name"
          howItHappens="No sidebar display name has been set, or the existing name was cleared."
          whatAppears="Composer uses the owning machine name as a fallback while the worktree icon preserves the resource type and keeps the create-thread action available. Info omits the optional Worktree row and lists the machine separately."
        >
          <WorktreeNamingFixture fixtureId="no-custom-name" name={null} />
        </ScenarioRow>
      </StorySection>

      <StorySection
        title="Machine context"
        description="Info always identifies the owning machine. Composer shows it only when it clarifies where the worktree runs or signals that the machine is offline."
      >
        <ScenarioRow
          label="One local machine"
          howItHappens="The worktree runs on the user's only connected local machine."
          whatAppears="Composer omits the redundant machine name. Info still lists the owning machine."
        >
          <WorktreeMachineVisibilityFixture
            connected
            locality="local"
            machineCount={1}
            machineName={STORY_HOST_NAME}
          />
        </ScenarioRow>
        <ScenarioRow
          label="Remote machine"
          howItHappens="The worktree runs on an enrolled remote machine."
          whatAppears="Composer shows the remote machine beside the worktree; Info lists the same machine."
        >
          <WorktreeMachineVisibilityFixture
            connected
            locality="remote"
            machineCount={1}
            machineName="Build Mac mini"
          />
        </ScenarioRow>
        <ScenarioRow
          label="Offline machine"
          howItHappens="The machine that owns the worktree disconnects while the worktree and thread remain."
          whatAppears="Composer keeps the neutral worktree icon and places an amber alert beside the offline machine name. Info uses the same alert for machine status. The long fixture also verifies safe truncation."
        >
          <WorktreeMachineVisibilityFixture
            connected={false}
            locality="local"
            machineCount={1}
            machineName={
              "Bersabel's remote build MacBook Pro for design-system verification"
            }
          />
        </ScenarioRow>
        <ScenarioRow
          label="Multiple machines"
          howItHappens="The user has more than one enrolled machine."
          whatAppears="Composer names the machine that owns this worktree so it cannot be confused with another machine. Info lists the same owner."
        >
          <WorktreeMachineVisibilityFixture
            connected
            locality="local"
            machineCount={2}
            machineName={STORY_HOST_NAME}
          />
        </ScenarioRow>
      </StorySection>
    </>
  );
}

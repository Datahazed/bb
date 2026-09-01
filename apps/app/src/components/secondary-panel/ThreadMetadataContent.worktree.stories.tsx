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

const BRANCH = formatWorkspaceCheckoutDisplay({
  checkout: {
    kind: "branch",
    branchName: "bb/design-system-polish",
    headSha: null,
  },
});
const LOCAL_HOST: EnvironmentDisplayHostContext = {
  locality: "local",
  identity: null,
};

interface ContextFixtureProps {
  connected?: boolean;
  locality?: "local" | "remote";
  machineCount?: number;
  machineName?: string;
  name: string | null;
}

function ContextFixture({
  connected = true,
  locality = "local",
  machineCount = 1,
  machineName = "Bersabel's MacBook Pro",
  name,
}: ContextFixtureProps) {
  const environment = makeEnvironment({
    id: `env_${locality}_${connected ? "connected" : "offline"}_${name ?? "unnamed"}`,
    name,
    isWorktree: true,
    workspaceProvisionType: "managed-worktree",
    status: "ready",
  });
  const host = { ...LOCAL_HOST, locality };
  const display = formatEnvironmentDisplay({ environment, host });
  const summary = getEnvironmentWorkspaceSummaryDisplay({
    display,
    environmentName: name,
    hostName: machineName,
  });
  const showMachine = shouldShowWorktreeMachineInComposer({
    connected,
    hasCustomName: name !== null,
    locality,
    machineCount,
  });

  return (
    <div className="grid w-full min-w-0 gap-3 2xl:grid-cols-2">
      <section className="min-w-0 space-y-1.5">
        <p className="text-xs font-medium text-muted-foreground">Composer</p>
        <div data-promptbox="" className="rounded-md border bg-background p-3">
          <ThreadEnvironmentSummary
            environmentLabel={summary.label}
            environmentIcon={summary.icon}
            environmentTypeLabel={summary.typeLabel}
            environmentCheckout={BRANCH}
            machineName={showMachine ? machineName : undefined}
            machineConnected={connected}
          />
        </div>
      </section>
      <section className="min-w-0 space-y-1.5">
        <p className="text-xs font-medium text-muted-foreground">Info</p>
        <PanelStage>
          <ThreadMetadataCard>
            <EnvironmentRow
              thread={makeThread({ environmentId: environment.id })}
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

export function Overview() {
  return (
    <StoryCard>
      <StoryRow
        label="Named · one local machine"
        hint="Set from the sidebar row. Composer shows the name; Info identifies the environment as a worktree and includes the name."
      >
        <ContextFixture name="Design system polish" />
      </StoryRow>
      <StoryRow
        label="Long name"
        hint="A valid long sidebar name truncates without colliding with branch or actions; focus reveals the full value."
      >
        <ContextFixture name="internal-tooling-ingest-pipeline-rewrite-2026-cross-platform-rollout-monitoring" />
      </StoryRow>
      <StoryRow
        label="No custom name"
        hint="No sidebar name is set. Composer uses the machine as a readable fallback with the worktree icon; Info still identifies the environment as a worktree."
      >
        <ContextFixture name={null} />
      </StoryRow>
      <StoryRow
        label="Remote machine"
        hint="The worktree runs remotely. Composer includes its machine to distinguish where it runs; Info always lists the owner."
      >
        <ContextFixture
          name="Design system polish"
          locality="remote"
          machineName="Build Mac mini"
        />
      </StoryRow>
      <StoryRow
        label="Offline machine"
        hint="The owning machine disconnects. A separate amber alert carries the Offline tooltip while long machine text truncates safely."
      >
        <ContextFixture
          connected={false}
          name="Design system polish"
          machineName="Bersabel's remote build MacBook Pro for design-system verification"
        />
      </StoryRow>
    </StoryCard>
  );
}

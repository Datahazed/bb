import { PERSONAL_PROJECT_ID } from "@bb/domain";
import type { Automation } from "@bb/server-contract";
import { PROJECT_IDS, PROJECT_NAMES } from "../../.ladle/story-fixtures";
import {
  AutomationsOverview,
  type AutomationRowActions,
  type AutomationsOverviewProps,
} from "./AutomationsView";

export default {
  title: "Automations",
};

interface AutomationOverviewEntry {
  automation: Automation;
  project: { id: string; name: string };
}

function makeAutomation(overrides: Partial<Automation> = {}): Automation {
  return {
    id: "auto_demo",
    projectId: PROJECT_IDS.bb,
    name: "Daily standup digest",
    enabled: true,
    trigger: {
      triggerType: "schedule",
      cron: "0 9 * * 1-5",
      timezone: "America/New_York",
    },
    execution: {
      mode: "agent",
      prompt: "Summarize yesterday's merged PRs and post the digest.",
      providerId: "codex",
      model: "gpt-5",
      permissionMode: "readonly",
    },
    environment: { type: "host", workspace: { type: "personal" } },
    autoArchive: false,
    origin: "human",
    createdByThreadId: null,
    nextRunAt: 1_700_003_600_000,
    lastRunAt: null,
    runCount: 0,
    lastRunStatus: null,
    lastRunThreadId: null,
    lastError: null,
    createdAt: 0,
    updatedAt: 100,
    ...overrides,
  };
}

function entry(
  automation: Automation,
  project: { id: string; name: string },
): AutomationOverviewEntry {
  return { automation, project };
}

const projectBb = { id: PROJECT_IDS.bb, name: PROJECT_NAMES.bb };
const projectPersonal = { id: PERSONAL_PROJECT_ID, name: "Personal" };

const sampleEntries: AutomationOverviewEntry[] = [
  entry(
    makeAutomation({
      lastRunStatus: "succeeded",
      lastRunAt: 1_700_000_000_000,
    }),
    projectBb,
  ),
  entry(
    makeAutomation({
      id: "auto_watchdog",
      name: "Disk space watchdog",
      projectId: PERSONAL_PROJECT_ID,
      origin: "agent",
      lastRunStatus: "failed",
      lastRunAt: 1_700_001_000_000,
      execution: {
        mode: "script",
        scriptFile: "disk.sh",
        interpreter: "bash",
        timeoutMs: 30_000,
      },
      trigger: {
        triggerType: "schedule",
        cron: "*/15 * * * *",
        timezone: "America/New_York",
      },
    }),
    projectPersonal,
  ),
  entry(
    makeAutomation({
      id: "auto_new",
      name: "Release notes draft",
      lastRunStatus: null,
      lastRunAt: null,
      trigger: {
        triggerType: "schedule",
        cron: "0 17 * * 5",
        timezone: "America/New_York",
      },
    }),
    projectBb,
  ),
  entry(
    makeAutomation({
      id: "auto_cleanup",
      name: "Weekly cleanup",
      enabled: false,
      nextRunAt: null,
      trigger: {
        triggerType: "schedule",
        cron: "0 18 * * 5",
        timezone: "America/New_York",
      },
    }),
    projectBb,
  ),
  entry(
    makeAutomation({
      id: "auto_running",
      name: "Flaky-test sweep",
      projectId: PERSONAL_PROJECT_ID,
      origin: "agent",
      lastRunStatus: "running",
      lastRunAt: 1_700_002_000_000,
    }),
    projectPersonal,
  ),
  entry(
    makeAutomation({
      id: "auto_skipped",
      name: "Error sentinel",
      lastRunStatus: "skipped",
      lastRunAt: 1_700_001_500_000,
    }),
    projectBb,
  ),
];

const NOOP = () => {};

const NOOP_ACTIONS: AutomationRowActions = {
  onPause: NOOP,
  onResume: NOOP,
  onRun: NOOP,
  onDelete: NOOP,
};

function Story(props: Partial<AutomationsOverviewProps>) {
  return (
    <main className="flex h-screen min-w-0 flex-col p-4 md:p-5">
      <AutomationsOverview
        entries={props.entries ?? sampleEntries}
        isLoading={props.isLoading ?? false}
        hasInitialLoadError={props.hasInitialLoadError ?? false}
        actions={props.actions ?? NOOP_ACTIONS}
        onCreateAutomation={NOOP}
      />
    </main>
  );
}

export function Overview() {
  return <Story />;
}

export function Empty() {
  return <Story entries={[]} />;
}

export function Loading() {
  return <Story entries={[]} isLoading />;
}

export function Error() {
  return <Story entries={[]} hasInitialLoadError />;
}

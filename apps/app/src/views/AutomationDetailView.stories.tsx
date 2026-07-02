import { PERSONAL_PROJECT_ID } from "@bb/domain";
import type { Automation, AutomationRun } from "@bb/server-contract";
import { getAutomationsRoutePath } from "@/lib/route-paths";
import { ModelPickerStoryQueryProvider } from "../../.ladle/model-picker-query-provider";
import { PROJECT_IDS } from "../../.ladle/story-fixtures";
import { AutomationDetailContent } from "./AutomationDetailView";

export default {
  title: "Automations / Detail",
};

function makeAutomation(overrides: Partial<Automation> = {}): Automation {
  return {
    id: "auto_watchdog",
    projectId: PERSONAL_PROJECT_ID,
    name: "Disk space watchdog",
    enabled: true,
    trigger: {
      triggerType: "schedule",
      cron: "*/15 * * * *",
      timezone: "America/New_York",
    },
    execution: {
      mode: "script",
      scriptFile: "disk.sh",
      interpreter: "bash",
      timeoutMs: 30_000,
    },
    environment: { type: "host", workspace: { type: "personal" } },
    autoArchive: false,
    origin: "agent",
    createdByThreadId: "thr_8x",
    nextRunAt: 1_700_003_600_000,
    lastRunAt: 1_700_000_000_000,
    runCount: 3,
    lastRunStatus: "succeeded",
    lastRunThreadId: null,
    lastError: null,
    createdAt: 0,
    updatedAt: 100,
    ...overrides,
  };
}

function makeRun(overrides: Partial<AutomationRun> = {}): AutomationRun {
  return {
    id: "run_1",
    automationId: "auto_watchdog",
    runMode: "script",
    threadId: null,
    status: "succeeded",
    trigger: "schedule",
    skipReason: null,
    error: null,
    output: "Disk at 92%",
    exitCode: 0,
    scheduledFor: 1_700_000_000_000,
    startedAt: 1_700_000_000_000,
    finishedAt: 1_700_000_000_300,
    ...overrides,
  };
}

const NOOP = () => {};

const scriptRuns: AutomationRun[] = [
  makeRun(),
  makeRun({ id: "run_silent", output: null, startedAt: 1_699_999_100_000 }),
  makeRun({
    id: "run_fail",
    status: "failed",
    output: null,
    error: "df: /xyz: No such file or directory",
    exitCode: 1,
    startedAt: 1_699_998_200_000,
  }),
];

const agentAutomation = makeAutomation({
  id: "auto_digest",
  name: "Daily standup digest",
  projectId: PROJECT_IDS.bb,
  origin: "agent",
  execution: {
    mode: "agent",
    prompt: "Summarize yesterday's merged PRs and post the digest.",
    providerId: "codex",
    model: "gpt-5",
    permissionMode: "readonly",
  },
  trigger: {
    triggerType: "schedule",
    cron: "0 9 * * 1-5",
    timezone: "America/New_York",
  },
});

const agentRuns: AutomationRun[] = [
  makeRun({
    id: "run_agent",
    runMode: "agent",
    threadId: "thr_digest",
    output: null,
    exitCode: null,
  }),
  makeRun({
    id: "run_agent_prev",
    runMode: "agent",
    threadId: "thr_digest_prev",
    output: null,
    exitCode: null,
    startedAt: 1_699_999_000_000,
  }),
];

// A script loop that escalates: a cheap script ticks on schedule and stays
// silent when there's nothing to do, but spawns an agent thread when it finds
// real work — the Hermes "script -> agent on escalation" shape.
const escalatingScriptAutomation = makeAutomation({
  id: "auto_flaky_sweep",
  name: "Flaky-test sweep",
  projectId: PROJECT_IDS.bb,
  origin: "agent",
  execution: {
    mode: "script",
    scriptFile: "flaky-sweep.sh",
    interpreter: "bash",
    timeoutMs: 120_000,
  },
  environment: {
    type: "host",
    workspace: { type: "managed-worktree", baseBranch: { kind: "default" } },
  },
  trigger: {
    triggerType: "schedule",
    cron: "0 3 * * *",
    timezone: "America/New_York",
  },
});

const escalatingRuns: AutomationRun[] = [
  // Escalation: the script found flaky suites and spawned a fixer thread.
  makeRun({
    id: "run_escalate",
    runMode: "script",
    threadId: "thr_flakyfix",
    output:
      "2 flaky suites detected across 14 reruns. Spawned a fixer thread to triage and patch them.",
    startedAt: 1_700_000_000_000,
    finishedAt: 1_700_000_004_500,
  }),
  // Quiet tick: nothing flaky, stays silent, no token spend, no thread.
  makeRun({
    id: "run_quiet",
    runMode: "script",
    output: null,
    startedAt: 1_699_999_100_000,
    finishedAt: 1_699_999_102_900,
  }),
  // An earlier escalation, for the run-history pattern.
  makeRun({
    id: "run_escalate_prev",
    runMode: "script",
    threadId: "thr_flakyfix_prev",
    output: "1 flaky suite detected. Spawned a fixer thread.",
    startedAt: 1_699_998_200_000,
    finishedAt: 1_699_998_205_100,
  }),
];

function Story(props: Partial<Parameters<typeof AutomationDetailContent>[0]>) {
  return (
    <main className="flex h-screen min-w-0 flex-col p-4 md:p-5">
      <AutomationDetailContent
        automation={props.automation ?? makeAutomation()}
        runs={props.runs ?? scriptRuns}
        runsLoading={props.runsLoading ?? false}
        runsError={props.runsError ?? false}
        onPause={NOOP}
        onResume={NOOP}
        onDelete={NOOP}
        onSave={() => Promise.resolve()}
        savePending={props.savePending ?? false}
        actionsPending={props.actionsPending ?? false}
        initialEditing={props.initialEditing}
        backHref={props.backHref ?? getAutomationsRoutePath()}
      />
    </main>
  );
}

export function ScriptAutomation() {
  return <Story />;
}

export function AgentAutomation() {
  return <Story automation={agentAutomation} runs={agentRuns} />;
}

export function ScriptEscalatesToAgent() {
  return (
    <Story automation={escalatingScriptAutomation} runs={escalatingRuns} />
  );
}

export function Paused() {
  return <Story automation={makeAutomation({ enabled: false })} />;
}

export function NoRuns() {
  return <Story runs={[]} />;
}

export function RunsLoading() {
  return <Story runs={[]} runsLoading />;
}

export function RunsError() {
  return <Story runs={[]} runsError />;
}

// A script loop that exercises the less-common config — an inline `sh` script in
// a reused environment — paired with a run history that hits every run-row state
// in one pane: running, succeeded, failed, a silent (no-output) run, an agent
// run with a thread, a script run that spawned a thread, and a long error.
const allStatesAutomation = makeAutomation({
  id: "auto_all_states",
  name: "Deploy checks",
  projectId: PROJECT_IDS.bb,
  origin: "agent",
  runCount: 61,
  lastRunStatus: "running",
  nextRunAt: null,
  execution: {
    mode: "script",
    script: "set -e\npnpm test\npnpm build\n",
    interpreter: "sh",
    timeoutMs: 300_000,
  },
  environment: { type: "reuse", environmentId: "env_ci" },
});

const allStatesRuns: AutomationRun[] = [
  makeRun({
    id: "r_running",
    status: "running",
    trigger: "manual",
    output: null,
    exitCode: null,
    startedAt: 1_700_000_500_000,
    finishedAt: null,
  }),
  makeRun({
    id: "r_ok",
    output: "All checks passed",
    exitCode: 0,
    startedAt: 1_700_000_000_000,
    finishedAt: 1_700_000_045_000,
  }),
  makeRun({
    id: "r_fail",
    status: "failed",
    output: null,
    error: "build failed: TS2339: Property 'foo' does not exist",
    exitCode: 1,
    startedAt: 1_699_999_000_000,
    finishedAt: 1_699_999_030_000,
  }),
  makeRun({
    id: "r_silent",
    output: null,
    exitCode: 0,
    startedAt: 1_699_997_000_000,
    finishedAt: 1_699_997_002_000,
  }),
  makeRun({
    id: "r_agent",
    runMode: "agent",
    threadId: "thr_deploy",
    output: "Rolled back the bad deploy and filed an incident report.",
    exitCode: null,
    startedAt: 1_699_996_000_000,
    finishedAt: 1_699_996_120_000,
  }),
  makeRun({
    id: "r_spawn",
    threadId: "thr_spawn",
    output: "Flaky suite detected — spawned a fixer thread.",
    exitCode: 0,
    startedAt: 1_699_995_000_000,
    finishedAt: 1_699_995_005_000,
  }),
  makeRun({
    id: "r_longerr",
    status: "failed",
    output: null,
    error:
      "Traceback (most recent call last):\n" +
      '  File "deploy.py", line 42, in <module>\n' +
      "    main()\n" +
      '  File "deploy.py", line 20, in main\n' +
      "    raise RuntimeError('unreachable host: prod-3')\n" +
      "RuntimeError: unreachable host: prod-3",
    exitCode: 2,
    startedAt: 1_699_994_000_000,
    finishedAt: 1_699_994_030_000,
  }),
];

// Agent loop that fills the rest of the config surface: Claude Code, full access,
// an unmanaged workspace, an "app"-created origin, and auto-archive on.
const agentAllOptionsAutomation = makeAutomation({
  id: "auto_all_opts",
  name: "Overnight triage",
  projectId: PROJECT_IDS.bb,
  origin: "app",
  autoArchive: true,
  runCount: 240,
  execution: {
    mode: "agent",
    prompt: "Triage overnight alerts and open fix PRs where safe.",
    providerId: "claude-code",
    model: "claude-sonnet-4-6",
    permissionMode: "full",
  },
  environment: {
    type: "host",
    hostId: "host_mbp",
    workspace: { type: "unmanaged", path: "~/code/service" },
  },
});

/** Every run-history row state at once; config uses sh + inline script + reuse. */
export function AllRunStates() {
  return <Story automation={allStatesAutomation} runs={allStatesRuns} />;
}

/** Claude Code · full access · unmanaged workspace · app origin · auto-archive. */
export function AgentAllOptions() {
  return <Story automation={agentAllOptionsAutomation} runs={agentRuns} />;
}

/** The full-page edit form for a script loop (opened via the Edit action). */
export function Editing() {
  return <Story automation={allStatesAutomation} initialEditing />;
}

/** Script loop mid-save: the Cancel + Save changes buttons are disabled. */
export function EditingScriptSaving() {
  return <Story automation={allStatesAutomation} initialEditing savePending />;
}

/**
 * Editing an agent loop — the richer composer: prompt editor, provider/model +
 * permission pickers, and auto-archive. Wrapped in the model-picker seeder so the
 * pickers populate (this loop is Claude Code · full access · auto-archive on).
 */
export function EditingAgent() {
  return (
    <ModelPickerStoryQueryProvider>
      <Story
        automation={agentAllOptionsAutomation}
        runs={agentRuns}
        initialEditing
      />
    </ModelPickerStoryQueryProvider>
  );
}

/** Agent loop mid-save: the composer's Save action is disabled. */
export function EditingAgentSaving() {
  return (
    <ModelPickerStoryQueryProvider>
      <Story
        automation={agentAllOptionsAutomation}
        runs={agentRuns}
        initialEditing
        savePending
      />
    </ModelPickerStoryQueryProvider>
  );
}

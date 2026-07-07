import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { PERSONAL_PROJECT_ID } from "@bb/domain";
import type { Automation, AutomationRun } from "@bb/server-contract";
import { PROJECT_IDS, PROJECT_NAMES } from "../../.ladle/story-fixtures";
import { Button } from "../components/ui/button";
import { Icon } from "../components/ui/icon";
import { appToast } from "../components/ui/app-toast";
import {
  automationDetailQueryKey,
  automationRunsQueryKey,
} from "../hooks/queries/query-keys";
import { AutomationDetailContent } from "./AutomationDetailView";
import { AutomationDetailPane } from "./AutomationDetailPane";
import {
  ConfirmDeleteDialog,
  ConfirmDeleteDialogContent,
} from "../components/dialogs/ConfirmDeleteDialog";
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

/** A schedule override for a given cron, so stories show varied cadences. */
function every(cron: string): Partial<Automation> {
  return {
    trigger: { triggerType: "schedule", cron, timezone: "America/New_York" },
  };
}

const HOST_ID = "host_mbp";

const sampleEntries: AutomationOverviewEntry[] = [
  // Personal · bash script on the personal workspace, currently failing.
  entry(
    makeAutomation({
      id: "auto_watchdog",
      name: "Disk space watchdog",
      projectId: PERSONAL_PROJECT_ID,
      origin: "agent",
      runCount: 128,
      lastRunStatus: "failed",
      lastRunAt: 1_700_001_000_000,
      lastError: "df exited 1: No such file or directory",
      execution: {
        mode: "script",
        scriptFile: "disk.sh",
        interpreter: "bash",
        timeoutMs: 30_000,
        env: { THRESHOLD: "90" },
      },
      environment: { type: "host", workspace: { type: "personal" } },
      ...every("*/15 * * * *"),
    }),
    projectPersonal,
  ),
  // Personal · node smoke test against an unmanaged checkout, failing.
  entry(
    makeAutomation({
      id: "auto_deploy_smoke",
      name: "Deploy smoke test",
      projectId: PERSONAL_PROJECT_ID,
      origin: "human",
      runCount: 44,
      lastRunStatus: "failed",
      lastRunAt: 1_700_000_900_000,
      lastError: "Timed out waiting for https://staging (120s)",
      execution: {
        mode: "script",
        scriptFile: "smoke.mjs",
        interpreter: "node",
        timeoutMs: 120_000,
      },
      environment: {
        type: "host",
        hostId: HOST_ID,
        workspace: { type: "unmanaged", path: "~/code/app" },
      },
      ...every("*/30 * * * *"),
    }),
    projectPersonal,
  ),
  // Personal · read-only Codex agent.
  entry(
    makeAutomation({
      id: "auto_health",
      name: "Health ping",
      projectId: PERSONAL_PROJECT_ID,
      origin: "human",
      runCount: 512,
      lastRunStatus: "succeeded",
      lastRunAt: 1_700_002_500_000,
      execution: {
        mode: "agent",
        prompt: "Curl the health endpoints and flag anything non-200.",
        providerId: "codex",
        model: "gpt-5",
        permissionMode: "readonly",
      },
      environment: { type: "host", workspace: { type: "personal" } },
      ...every("0 * * * *"),
    }),
    projectPersonal,
  ),
  // Personal · read-only Claude Code agent.
  entry(
    makeAutomation({
      id: "auto_standup_reminder",
      name: "Standup reminder",
      projectId: PERSONAL_PROJECT_ID,
      origin: "human",
      runCount: 60,
      lastRunStatus: "succeeded",
      lastRunAt: 1_700_001_600_000,
      execution: {
        mode: "agent",
        prompt: "DM me my open PRs and today's meetings before standup.",
        providerId: "claude-code",
        model: "claude-sonnet-4-6",
        permissionMode: "readonly",
      },
      environment: { type: "host", workspace: { type: "personal" } },
      ...every("30 8 * * 1"),
    }),
    projectPersonal,
  ),
  // bb · the default digest (read-only Codex agent on personal).
  entry(
    makeAutomation({
      runCount: 47,
      lastRunStatus: "succeeded",
      lastRunAt: 1_700_000_000_000,
      ...every("0 9 * * 1-5"),
    }),
    projectBb,
  ),
  // bb · write-capable Claude Code agent in a managed worktree, auto-archived.
  entry(
    makeAutomation({
      id: "auto_triage",
      name: "Triage sweep",
      origin: "agent",
      autoArchive: true,
      runCount: 18,
      lastRunStatus: "succeeded",
      lastRunAt: 1_700_001_800_000,
      execution: {
        mode: "agent",
        prompt: "Label and de-duplicate new issues, then open a summary PR.",
        providerId: "claude-code",
        model: "claude-sonnet-4-6",
        permissionMode: "workspace-write",
      },
      environment: {
        type: "host",
        hostId: HOST_ID,
        workspace: {
          type: "managed-worktree",
          baseBranch: { kind: "default" },
        },
      },
      ...every("0 9 * * 1,3,5"),
    }),
    projectBb,
  ),
  // bb · write-capable agent off a named branch, never run yet.
  entry(
    makeAutomation({
      id: "auto_new",
      name: "Release notes draft",
      autoArchive: true,
      runCount: 0,
      lastRunStatus: null,
      lastRunAt: null,
      execution: {
        mode: "agent",
        prompt: "Draft release notes from merged PRs since the last tag.",
        providerId: "codex",
        model: "gpt-5",
        permissionMode: "workspace-write",
      },
      environment: {
        type: "host",
        hostId: HOST_ID,
        workspace: {
          type: "managed-worktree",
          baseBranch: { kind: "named", name: "main" },
        },
      },
      ...every("0 17 * * 5"),
    }),
    projectBb,
  ),
  // bb · node link checker on an unmanaged checkout.
  entry(
    makeAutomation({
      id: "auto_link_checker",
      name: "Link checker",
      origin: "human",
      runCount: 220,
      lastRunStatus: "succeeded",
      lastRunAt: 1_700_002_100_000,
      execution: {
        mode: "script",
        scriptFile: "check-links.mjs",
        interpreter: "node",
        timeoutMs: 60_000,
      },
      environment: {
        type: "host",
        hostId: HOST_ID,
        workspace: { type: "unmanaged", path: "~/code/site" },
      },
      ...every("0 */6 * * *"),
    }),
    projectBb,
  ),
  // bb · long-running bash backup with env vars, on personal.
  entry(
    makeAutomation({
      id: "auto_nightly",
      name: "Nightly backup",
      origin: "human",
      runCount: 90,
      lastRunStatus: "succeeded",
      lastRunAt: 1_700_000_500_000,
      execution: {
        mode: "script",
        scriptFile: "backup.sh",
        interpreter: "bash",
        timeoutMs: 600_000,
        env: { DEST: "s3://acme-backups", RETAIN_DAYS: "30" },
      },
      environment: { type: "host", workspace: { type: "personal" } },
      ...every("0 2 * * *"),
    }),
    projectBb,
  ),
  // bb · full-access agent reusing a shared environment.
  entry(
    makeAutomation({
      id: "auto_metrics",
      name: "Metrics rollup",
      origin: "agent",
      runCount: 12,
      lastRunStatus: "succeeded",
      lastRunAt: 1_700_001_500_000,
      execution: {
        mode: "agent",
        prompt: "Roll up last month's metrics into the dashboard table.",
        providerId: "codex",
        model: "gpt-5",
        permissionMode: "full",
      },
      environment: { type: "reuse", environmentId: "env_analytics" },
      ...every("0 0 1 * *"),
    }),
    projectBb,
  ),
  // bb · currently running; also exercises sh + an inline script in a reused env.
  entry(
    makeAutomation({
      id: "auto_build",
      name: "Build & deploy",
      origin: "agent",
      runCount: 310,
      lastRunStatus: "running",
      lastRunAt: 1_700_002_900_000,
      nextRunAt: 1_700_010_000_000,
      execution: {
        mode: "script",
        script: "set -e\npnpm build\npnpm deploy\n",
        interpreter: "sh",
        timeoutMs: 300_000,
      },
      environment: { type: "reuse", environmentId: "env_ci" },
      ...every("*/10 * * * *"),
    }),
    projectBb,
  ),
  // bb · paused full-access cleanup agent.
  entry(
    makeAutomation({
      id: "auto_cleanup",
      name: "Weekly cleanup",
      enabled: false,
      nextRunAt: null,
      runCount: 30,
      lastRunStatus: "succeeded",
      lastRunAt: 1_699_990_000_000,
      execution: {
        mode: "agent",
        prompt: "Delete merged branches and stale worktrees.",
        providerId: "claude-code",
        model: "claude-sonnet-4-6",
        permissionMode: "full",
      },
      environment: { type: "host", workspace: { type: "personal" } },
      ...every("0 3 * * 0"),
    }),
    projectBb,
  ),
];

/** A short, plausible run history ending in the automation's current status. */
function runsFor(a: Automation): AutomationRun[] {
  if (a.lastRunStatus === null) {
    return [];
  }
  const isScript = a.execution.mode === "script";
  const history: AutomationRun["status"][] = [
    a.lastRunStatus,
    "succeeded",
    a.lastRunStatus === "failed" ? "failed" : "succeeded",
    "succeeded",
  ];
  return history.map((status, index) => {
    const running = status === "running";
    // One quiet, no-output success so the silent-run treatment shows up too.
    const silent = status === "succeeded" && index === 3;
    const startedAt = (a.lastRunAt ?? 0) - index * 6 * 60 * 60 * 1000;
    const finishedAt = running
      ? null
      : startedAt + (isScript ? 400 : 4_000) + index * 900;
    return {
      id: `${a.id}_run_${index}`,
      automationId: a.id,
      runMode: isScript ? "script" : "agent",
      threadId: isScript ? null : `thr_${a.id}_${index}`,
      status,
      trigger: "schedule",
      skipReason: null,
      error: status === "failed" ? (a.lastError ?? "Run failed.") : null,
      output:
        running || silent || status === "failed"
          ? null
          : isScript
            ? "OK · 0 warnings"
            : "Posted the summary to #eng.",
      exitCode: isScript
        ? status === "failed"
          ? 1
          : running
            ? null
            : 0
        : null,
      scheduledFor: startedAt,
      startedAt,
      finishedAt,
    };
  });
}

const NOOP = () => {};

const NOOP_ACTIONS: AutomationRowActions = {
  onOpen: NOOP,
  onEdit: NOOP,
  onRun: NOOP,
  onDelete: NOOP,
};

function Story(props: Partial<AutomationsOverviewProps>) {
  return (
    <div className="h-screen">
      <AutomationsOverview
        entries={props.entries ?? sampleEntries}
        isLoading={props.isLoading ?? false}
        hasInitialLoadError={props.hasInitialLoadError ?? false}
        actions={props.actions ?? NOOP_ACTIONS}
        onCreateAutomation={NOOP}
        onRetry={NOOP}
      />
    </div>
  );
}

// Fully wired so the row actions actually do something in the story: Run toasts,
// Delete opens a confirm dialog (then removes the row), Open docks the read-only
// detail pane beside the list, and Edit toasts (it would open the full page).
export function Overview() {
  const [entries, setEntries] = useState(sampleEntries);
  const queryClient = useQueryClient();
  // Seed react-query so the docked pane shows real config + run history in the
  // story (Ladle has no backend to fetch from).
  useEffect(() => {
    for (const { automation: a } of sampleEntries) {
      queryClient.setQueryData(automationDetailQueryKey(a.projectId, a.id), a);
      queryClient.setQueryData(automationRunsQueryKey(a.projectId, a.id), {
        runs: runsFor(a),
      });
    }
  }, [queryClient]);
  const [detail, setDetail] = useState<{
    automation: Automation;
  } | null>(null);
  const [session, setSession] = useState(0);
  const openDetail = (automation: Automation) => {
    setSession((value) => value + 1);
    setDetail({ automation });
  };
  // Editing lives on the full page; in this routerless story we just signal it.
  const openEditor = (automation: Automation) =>
    appToast.message(`Editing "${automation.name}" opens the full page`);
  const [pendingDelete, setPendingDelete] =
    useState<AutomationOverviewEntry | null>(null);
  const actions: AutomationRowActions = {
    onOpen: (entry) => openDetail(entry.automation),
    onEdit: (entry) => openEditor(entry.automation),
    onRun: (entry) => appToast.message(`Running "${entry.automation.name}"…`),
    onDelete: (entry) => setPendingDelete(entry),
  };
  const confirmDelete = () => {
    if (pendingDelete) {
      setEntries((prev) =>
        prev.filter(
          (item) => item.automation.id !== pendingDelete.automation.id,
        ),
      );
    }
    setPendingDelete(null);
  };
  return (
    <div className="flex h-screen min-w-0">
      <div className="min-w-0 flex-1">
        <AutomationsOverview
          entries={entries}
          isLoading={false}
          hasInitialLoadError={false}
          actions={actions}
          onCreateAutomation={NOOP}
          onRetry={NOOP}
          selectedId={detail?.automation.id ?? null}
        />
      </div>
      {detail ? (
        <AutomationDetailPane
          automation={detail.automation}
          sessionKey={session}
          onEdit={() => openEditor(detail.automation)}
          onClose={() => setDetail(null)}
        />
      ) : null}
      <ConfirmDeleteDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => {
          if (!open) {
            setPendingDelete(null);
          }
        }}
      >
        <ConfirmDeleteDialogContent
          title="Delete automation?"
          description={
            pendingDelete
              ? `"${pendingDelete.automation.name}" and its run history will be permanently removed. This can't be undone.`
              : ""
          }
          confirmLabel="Delete"
          pending={false}
          onConfirm={confirmDelete}
          onCancel={() => setPendingDelete(null)}
        />
      </ConfirmDeleteDialog>
    </div>
  );
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

const drawerAutomation = makeAutomation({
  id: "auto_watchdog",
  name: "Disk space watchdog",
  projectId: PERSONAL_PROJECT_ID,
  origin: "agent",
  runCount: 42,
  lastRunStatus: "failed",
  lastRunAt: 1_700_001_000_000,
  lastError: "df exited 1: No such file or directory",
  execution: {
    mode: "script",
    scriptFile: "disk.sh",
    interpreter: "bash",
    timeoutMs: 30_000,
  },
  ...every("*/15 * * * *"),
});

const drawerRuns: AutomationRun[] = [
  makeRun({
    id: "run_4",
    status: "running",
    output: null,
    exitCode: null,
    scheduledFor: 1_700_001_400_000,
    startedAt: 1_700_001_400_000,
    finishedAt: null,
  }),
  makeRun({
    id: "run_3",
    status: "failed",
    error: "df exited 1: No such file or directory",
    output: null,
    exitCode: 1,
    scheduledFor: 1_700_001_000_000,
    startedAt: 1_700_001_000_000,
    finishedAt: 1_700_001_000_400,
  }),
  makeRun({
    id: "run_2",
    scheduledFor: 1_700_000_500_000,
    startedAt: 1_700_000_500_000,
    finishedAt: 1_700_000_500_600,
  }),
  makeRun({ id: "run_1" }),
];

/**
 * Docked detail pane — selecting a row opens the detail inline on the right,
 * beside the list (no scrim). Presentational: renders the pane chrome directly
 * with mock data.
 */
export function DetailPane() {
  return (
    <div className="flex h-screen min-w-0">
      <div className="min-w-0 flex-1" />
      <aside className="flex h-full w-[28rem] shrink-0 flex-col overflow-hidden border-l border-border bg-background">
        <div className="flex shrink-0 items-center justify-end px-3 pt-3">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="Close"
            className="size-7 rounded-md p-0 text-muted-foreground"
          >
            <Icon name="X" className="size-4" />
          </Button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-6 pt-1">
          <AutomationDetailContent
            automation={drawerAutomation}
            runs={drawerRuns}
            runsLoading={false}
            runsError={false}
            onPause={NOOP}
            onResume={NOOP}
            onEdit={NOOP}
            onDelete={NOOP}
            onSave={async () => {}}
            savePending={false}
            actionsPending={false}
          />
        </div>
      </aside>
    </div>
  );
}

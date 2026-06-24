import { useCallback, useState, type ReactNode } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import type {
  Automation,
  AutomationRun,
  UpdateAutomationRequest,
} from "@bb/server-contract";
import { Button } from "@/components/ui/button.js";
import {
  ConfirmDeleteDialog,
  ConfirmDeleteDialogContent,
} from "@/components/dialogs/ConfirmDeleteDialog.js";
import { EmptyStatePanel } from "@/components/ui/empty-state.js";
import { Skeleton } from "@/components/ui/skeleton.js";
import { Icon, type IconName } from "@/components/ui/icon.js";
import { Input } from "@/components/ui/input.js";
import { PageShell } from "@/components/ui/page-shell.js";
import { Pill } from "@/components/ui/pill.js";
import { Switch } from "@/components/ui/switch.js";
import { useDialogState } from "@/hooks/useDialogState";
import {
  useAutomationDetail,
  useAutomationRuns,
  useDeleteAutomation,
  usePauseAutomation,
  useResumeAutomation,
  useUpdateAutomation,
} from "@/hooks/queries/automation-queries";
import { formatCronCadence } from "@/lib/format-schedule";
import { getProviderIconInfo } from "@/lib/provider-icon";
import {
  getAutomationsRoutePath,
  getThreadRoutePath,
} from "@/lib/route-paths";
import { cn } from "@/lib/utils";

const RUN_TIME_FORMATTER = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

function formatRunTimestamp(timestamp: number): string {
  return RUN_TIME_FORMATTER.format(new Date(timestamp));
}

function formatRunDuration(run: AutomationRun): string | null {
  if (run.finishedAt === null) {
    return null;
  }
  const seconds = (run.finishedAt - run.startedAt) / 1000;
  if (seconds < 0) {
    return null;
  }
  return `${seconds.toFixed(seconds < 10 ? 1 : 0)}s`;
}

/** A succeeded script run that produced no surfaced output reads as "silent". */
function isSilentRun(run: AutomationRun): boolean {
  return (
    run.status === "succeeded" &&
    run.runMode === "script" &&
    (run.output === null || run.output.trim().length === 0)
  );
}

interface RunStatusLabel {
  label: string;
  tone: "ok" | "fail" | "muted";
}

function getRunStatusLabel(run: AutomationRun): RunStatusLabel {
  switch (run.status) {
    case "running":
      return { label: "Running", tone: "muted" };
    case "failed":
      return { label: "Failed", tone: "fail" };
    case "skipped":
      return { label: "Skipped", tone: "muted" };
    case "succeeded":
      return isSilentRun(run)
        ? { label: "Succeeded · silent", tone: "muted" }
        : { label: "Succeeded", tone: "ok" };
    default: {
      const _exhaustive: never = run.status;
      return _exhaustive;
    }
  }
}

const RUN_STATUS_TONE_CLASS: Record<RunStatusLabel["tone"], string> = {
  ok: "text-foreground",
  fail: "text-destructive",
  muted: "text-muted-foreground",
};

/** Semantic icon + tone per run status, leading each run-history row. */
const RUN_STATUS_META: Record<
  AutomationRun["status"],
  { icon: IconName; tone: string }
> = {
  running: { icon: "Clock", tone: "text-file-accent" },
  succeeded: { icon: "CircleCheck", tone: "text-success" },
  failed: { icon: "CircleX", tone: "text-destructive" },
  skipped: { icon: "CircleDashed", tone: "text-muted-foreground" },
};

function describeEnvironment(automation: Automation): string {
  const { environment } = automation;
  if (environment.type === "reuse") {
    return "Reuses an existing environment";
  }
  switch (environment.workspace.type) {
    case "personal":
      return "Personal workspace";
    case "managed-worktree":
      return "Managed worktree";
    case "unmanaged":
      return environment.workspace.path
        ? `Workspace: ${environment.workspace.path}`
        : "Unmanaged workspace";
    default: {
      const _exhaustive: never = environment.workspace;
      return _exhaustive;
    }
  }
}

const PERMISSION_LABEL: Record<string, string> = {
  readonly: "Read-only",
  "workspace-write": "Workspace write",
  full: "Full access",
};

/**
 * Execution shown the way the prompt box shows it: provider logo + model, with
 * the permission mode as a chip. Script loops show interpreter/file/timeout.
 */
function ExecutionSummary({ automation }: { automation: Automation }) {
  const { execution } = automation;
  if (execution.mode === "agent") {
    const ProviderLogo = getProviderIconInfo(execution.providerId)?.icon;
    return (
      <span className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
        {ProviderLogo ? <ProviderLogo className="size-3.5 shrink-0" /> : null}
        {execution.model}
        <Pill variant="outline" className="text-muted-foreground">
          {PERMISSION_LABEL[execution.permissionMode] ?? execution.permissionMode}
        </Pill>
      </span>
    );
  }
  const interpreter = execution.interpreter ?? "bash";
  const target = execution.scriptFile ?? "inline script";
  const timeoutSeconds = Math.round(execution.timeoutMs / 1000);
  return <>{`${interpreter} · ${target} · ${timeoutSeconds}s timeout`}</>;
}

function EnvironmentSummary({ automation }: { automation: Automation }) {
  return (
    <span className="flex items-center gap-1.5">
      <Icon
        name="Folder"
        className="size-3.5 shrink-0 text-muted-foreground"
        aria-hidden
      />
      {describeEnvironment(automation)}
    </span>
  );
}

interface RunRowProps {
  run: AutomationRun;
  projectId: string;
}

function RunRow({ run, projectId }: RunRowProps) {
  const meta = RUN_STATUS_META[run.status];
  const status = getRunStatusLabel(run);
  const duration = formatRunDuration(run);
  const silent = isSilentRun(run);
  // One subtle detail line, not a heavy output banner: the error, the skip
  // reason, the silent note, or the script's captured output.
  const detail =
    run.error ??
    run.skipReason ??
    (run.runMode === "script"
      ? silent
        ? "No output · silent gate held, nothing surfaced"
        : run.output
      : null);
  const detailTone = run.error
    ? "text-destructive"
    : silent
      ? "italic text-subtle-foreground"
      : "text-muted-foreground";

  return (
    <div className="border-b border-border-seam py-2.5 last:border-0">
      <div className="flex items-center gap-2 text-sm">
        <Icon
          name={meta.icon}
          className={cn("size-4 shrink-0", meta.tone)}
          aria-hidden
        />
        <span className={cn("font-medium", RUN_STATUS_TONE_CLASS[status.tone])}>
          {status.label}
        </span>
        <span className="text-xs text-muted-foreground">
          {formatRunTimestamp(run.startedAt)}
          {duration ? ` · ${duration}` : ""}
        </span>
        {run.threadId !== null ||
        (run.runMode === "script" && run.exitCode !== null) ? (
          <div className="ml-auto flex shrink-0 items-center gap-2.5">
            {run.runMode === "script" && run.exitCode !== null ? (
              <span className="font-mono text-xs text-muted-foreground">
                exit {run.exitCode}
              </span>
            ) : null}
            {run.threadId !== null ? (
              <Link
                to={getThreadRoutePath({ projectId, threadId: run.threadId })}
                className="text-xs text-muted-foreground hover:text-foreground hover:underline"
              >
                {/* An agent run IS its thread; a script run that set a thread
                    escalated by spawning one. */}
                {run.runMode === "script" ? "View spawned thread" : "View thread"}
              </Link>
            ) : null}
          </div>
        ) : null}
      </div>
      {detail ? (
        <p
          className={cn(
            "mt-1 whitespace-pre-wrap break-words pl-6 font-mono text-xs leading-relaxed",
            detailTone,
          )}
        >
          {detail}
        </p>
      ) : null}
    </div>
  );
}

function ConfigLine({ k, v }: { k: string; v: ReactNode }) {
  return (
    <div className="flex gap-3 border-b border-border-seam py-2 text-sm last:border-0">
      <span className="w-24 shrink-0 text-muted-foreground">{k}</span>
      <span className="min-w-0 break-words text-foreground">{v}</span>
    </div>
  );
}

interface AutomationDetailContentProps {
  automation: Automation;
  runs: readonly AutomationRun[];
  runsLoading: boolean;
  runsError: boolean;
  onPause: () => void;
  onResume: () => void;
  onDelete: () => void;
  onSave: (patch: UpdateAutomationRequest) => Promise<void>;
  savePending: boolean;
  actionsPending: boolean;
}

/**
 * Presentational body of the automation detail page: header, config summary,
 * action row, and run history. Split from the data-fetching container so it
 * renders without query/provider context in tests and stories.
 */
export function AutomationDetailContent({
  automation,
  runs,
  runsLoading,
  runsError,
  onPause,
  onResume,
  onDelete,
  onSave,
  savePending,
  actionsPending,
}: AutomationDetailContentProps) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(automation.name);
  const [cron, setCron] = useState(
    automation.trigger.triggerType === "schedule" ? automation.trigger.cron : "",
  );
  const [timezone, setTimezone] = useState(
    automation.trigger.triggerType === "schedule"
      ? automation.trigger.timezone
      : "",
  );
  const [prompt, setPrompt] = useState(
    automation.execution.mode === "agent" ? automation.execution.prompt : "",
  );
  const [autoArchive, setAutoArchive] = useState(automation.autoArchive);

  function startEditing() {
    setName(automation.name);
    setCron(
      automation.trigger.triggerType === "schedule"
        ? automation.trigger.cron
        : "",
    );
    setTimezone(
      automation.trigger.triggerType === "schedule"
        ? automation.trigger.timezone
        : "",
    );
    setPrompt(
      automation.execution.mode === "agent" ? automation.execution.prompt : "",
    );
    setAutoArchive(automation.autoArchive);
    setEditing(true);
  }

  async function handleSave() {
    const patch: UpdateAutomationRequest = {
      name,
      trigger: { triggerType: "schedule", cron, timezone },
      autoArchive,
      ...(automation.execution.mode === "agent"
        ? {
            execution: {
              mode: "agent" as const,
              prompt,
              providerId: automation.execution.providerId,
              model: automation.execution.model,
              permissionMode: automation.execution.permissionMode,
              ...(automation.execution.targetThreadId
                ? { targetThreadId: automation.execution.targetThreadId }
                : {}),
            },
          }
        : {}),
    };
    try {
      await onSave(patch);
      setEditing(false);
    } catch {
      // Mutation errors are surfaced by the global error handler; stay in edit
      // mode so the user can retry without losing their changes.
    }
  }

  const nextRunLabel = automation.enabled
    ? automation.nextRunAt !== null
      ? `Next run ${formatRunTimestamp(automation.nextRunAt)}`
      : "Not scheduled"
    : "Paused";

  return (
    <PageShell contentClassName="pt-4 md:pt-5">
      <div className="mx-auto w-full max-w-3xl space-y-6">
        <div className="min-w-0">
          <h1 className="truncate text-xl font-semibold tracking-tight text-foreground">
            {automation.name}
          </h1>
          {/* Next run + inline management. Run history below carries the rest of
              the health story (success/last/avg), so it's not duplicated here. */}
          <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="mr-1.5 inline-flex items-center gap-1.5 text-xs text-muted-foreground">
              <Icon name="Clock" className="size-3.5 shrink-0" aria-hidden />
              {nextRunLabel}
            </span>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={actionsPending}
              onClick={startEditing}
            >
              <Icon name="Edit" className="size-4" />
              Edit
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={actionsPending}
              onClick={automation.enabled ? onPause : onResume}
            >
              <Icon
                name={automation.enabled ? "Pause" : "Play"}
                className="size-4"
              />
              {automation.enabled ? "Pause" : "Resume"}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="text-destructive hover:text-destructive"
              disabled={actionsPending}
              onClick={onDelete}
            >
              <Icon name="Trash2" className="size-4" />
              Delete
            </Button>
          </div>
        </div>

        <section className="space-y-2">
          <h2 className="text-sm font-semibold text-foreground">Configuration</h2>
          <div className="rounded-lg border border-border bg-card px-3.5">
            {editing ? (
              <div className="space-y-3 py-3">
                <div>
                  <label className="mb-1 block text-xs font-medium text-muted-foreground">
                    Name
                  </label>
                  <Input
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    className="h-8 text-sm"
                    aria-label="Loop name"
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="mb-1 block text-xs font-medium text-muted-foreground">
                      Schedule (cron)
                    </label>
                    <Input
                      value={cron}
                      onChange={(event) => setCron(event.target.value)}
                      className="h-8 font-mono text-sm"
                      aria-label="Cron schedule"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-medium text-muted-foreground">
                      Timezone
                    </label>
                    <Input
                      value={timezone}
                      onChange={(event) => setTimezone(event.target.value)}
                      className="h-8 text-sm"
                      aria-label="Timezone"
                    />
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">
                  {formatCronCadence(cron)}
                </p>
                {automation.execution.mode === "agent" ? (
                  <div>
                    <label className="mb-1 block text-xs font-medium text-muted-foreground">
                      Prompt
                    </label>
                    <textarea
                      value={prompt}
                      onChange={(event) => setPrompt(event.target.value)}
                      rows={3}
                      aria-label="Prompt"
                      className="block w-full resize-none rounded-md border border-input bg-transparent px-3 py-2 text-sm leading-relaxed focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                    />
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    Script edits aren't available here — delete and recreate the
                    loop to change its script.
                  </p>
                )}
                <div className="flex items-center justify-between">
                  <span className="text-sm text-foreground">
                    Auto-archive the thread when it finishes
                  </span>
                  <Switch
                    checked={autoArchive}
                    onCheckedChange={setAutoArchive}
                    aria-label="Auto-archive the thread when it finishes"
                  />
                </div>
                <div className="flex justify-end gap-2 pt-1">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={savePending}
                    onClick={() => setEditing(false)}
                  >
                    Cancel
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    disabled={savePending}
                    onClick={handleSave}
                  >
                    Save changes
                  </Button>
                </div>
              </div>
            ) : (
              <>
                <ConfigLine
                  k="Schedule"
                  v={`${formatCronCadence(automation.trigger.cron)} · ${automation.trigger.timezone}`}
                />
                <ConfigLine
                  k="Execution"
                  v={<ExecutionSummary automation={automation} />}
                />
                <ConfigLine
                  k="Environment"
                  v={<EnvironmentSummary automation={automation} />}
                />
                {automation.execution.mode === "agent" ? (
                  <ConfigLine k="Prompt" v={automation.execution.prompt} />
                ) : null}
              </>
            )}
          </div>
        </section>

        <section className="space-y-2">
          <h2 className="text-sm font-semibold text-foreground">Run history</h2>
          {runsError ? (
            <p className="text-sm text-destructive">Failed to load runs.</p>
          ) : runsLoading ? (
            <div
              className="rounded-lg border border-border bg-card px-3.5"
              aria-busy
              aria-label="Loading runs"
            >
              {["w-20", "w-28", "w-24"].map((labelWidth) => (
                <div
                  key={labelWidth}
                  className="flex items-center gap-2 border-b border-border-seam py-2.5 last:border-0"
                >
                  <Skeleton className="size-4 shrink-0 rounded-full" />
                  <Skeleton className={cn("h-3.5", labelWidth)} />
                  <Skeleton className="h-3 w-28" />
                  <Skeleton className="ml-auto h-3 w-16" />
                </div>
              ))}
            </div>
          ) : runs.length === 0 ? (
            <EmptyStatePanel className="py-6">
              No runs yet.{" "}
              {automation.enabled
                ? automation.nextRunAt !== null
                  ? `Runs appear here after the next trigger, ${formatRunTimestamp(automation.nextRunAt)}.`
                  : "Runs appear here once the loop is scheduled."
                : "Resume the loop to schedule its first run."}
            </EmptyStatePanel>
          ) : (
            <div className="rounded-lg border border-border bg-card px-3.5">
              {runs.map((run) => (
                <RunRow
                  key={run.id}
                  run={run}
                  projectId={automation.projectId}
                />
              ))}
            </div>
          )}
        </section>
      </div>
    </PageShell>
  );
}

export function AutomationDetailView() {
  const params = useParams<{ projectId: string; automationId: string }>();
  const projectId = params.projectId ?? "";
  const automationId = params.automationId ?? "";
  const navigate = useNavigate();

  const detailQuery = useAutomationDetail(projectId, automationId);
  const runsQuery = useAutomationRuns(projectId, automationId);
  const pauseAutomation = usePauseAutomation();
  const resumeAutomation = useResumeAutomation();
  const deleteAutomation = useDeleteAutomation();
  const updateAutomation = useUpdateAutomation();
  const deleteDialog = useDialogState<true>();
  const { mutate: pauseMutate } = pauseAutomation;
  const { mutate: resumeMutate } = resumeAutomation;
  const { mutate: deleteMutate } = deleteAutomation;
  const { mutateAsync: updateMutateAsync } = updateAutomation;
  const { onClose: closeDeleteDialog, onOpen: openDeleteDialog } = deleteDialog;

  const handleSave = useCallback(
    async (patch: UpdateAutomationRequest) => {
      await updateMutateAsync({ projectId, automationId, patch });
    },
    [updateMutateAsync, projectId, automationId],
  );

  const handlePause = useCallback(() => {
    pauseMutate({ projectId, automationId });
  }, [pauseMutate, projectId, automationId]);
  const handleResume = useCallback(() => {
    resumeMutate({ projectId, automationId });
  }, [resumeMutate, projectId, automationId]);
  const confirmDelete = useCallback(() => {
    deleteMutate(
      { projectId, automationId },
      {
        onSuccess: () => {
          closeDeleteDialog();
          navigate(getAutomationsRoutePath(), { replace: true });
        },
      },
    );
  }, [deleteMutate, projectId, automationId, closeDeleteDialog, navigate]);

  const automation = detailQuery.data;
  const hasDetailError = detailQuery.isError && automation === undefined;
  const isDetailLoading =
    detailQuery.isFetching && automation === undefined && !hasDetailError;

  if (isDetailLoading) {
    return (
      <PageShell contentClassName="pt-4 md:pt-5">
        <div className="mx-auto w-full max-w-3xl">
          <p className="text-sm text-muted-foreground">Loading...</p>
        </div>
      </PageShell>
    );
  }

  if (hasDetailError || !automation) {
    return (
      <PageShell contentClassName="pt-4 md:pt-5">
        <div className="mx-auto w-full max-w-3xl">
          <p className="text-sm text-destructive">Failed to load loop.</p>
        </div>
      </PageShell>
    );
  }

  const runs = runsQuery.data?.runs ?? [];
  const hasRunsError = runsQuery.isError && runsQuery.data === undefined;
  const isRunsLoading =
    runsQuery.isFetching && runsQuery.data === undefined && !hasRunsError;
  const actionsPending =
    pauseAutomation.isPending ||
    resumeAutomation.isPending ||
    deleteAutomation.isPending;

  return (
    <>
      <AutomationDetailContent
        automation={automation}
        runs={runs}
        runsLoading={isRunsLoading}
        runsError={hasRunsError}
        onPause={handlePause}
        onResume={handleResume}
        onDelete={() => {
          openDeleteDialog(true);
        }}
        onSave={handleSave}
        savePending={updateAutomation.isPending}
        actionsPending={actionsPending}
      />
      <ConfirmDeleteDialog
        open={deleteDialog.isOpen}
        onOpenChange={deleteDialog.onOpenChange}
      >
        <ConfirmDeleteDialogContent
          title="Delete loop?"
          description={`"${automation.name}" and its run history will be permanently removed.`}
          confirmLabel="Delete"
          pending={deleteAutomation.isPending}
          onConfirm={confirmDelete}
          onCancel={closeDeleteDialog}
        />
      </ConfirmDeleteDialog>
    </>
  );
}

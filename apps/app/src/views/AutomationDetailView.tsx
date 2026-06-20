import { useCallback, useState } from "react";
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu.js";
import { EmptyStatePanel } from "@/components/ui/empty-state.js";
import { Icon } from "@/components/ui/icon.js";
import { Input } from "@/components/ui/input.js";
import { PageShell } from "@/components/ui/page-shell.js";
import { Switch } from "@/components/ui/switch.js";
import { useDialogState } from "@/hooks/useDialogState";
import {
  useAutomationDetail,
  useAutomationRuns,
  useDeleteAutomation,
  usePauseAutomation,
  useResumeAutomation,
  useRunAutomation,
  useUpdateAutomation,
} from "@/hooks/queries/automation-queries";
import { formatCronCadence } from "@/lib/format-schedule";
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

function describeExecution(automation: Automation): string {
  const { execution } = automation;
  if (execution.mode === "agent") {
    return `Agent · ${execution.providerId}/${execution.model} · ${execution.permissionMode}`;
  }
  const interpreter = execution.interpreter ?? "bash";
  const target = execution.scriptFile ?? "inline script";
  const timeoutSeconds = Math.round(execution.timeoutMs / 1000);
  return `Script · ${interpreter} ${target} · ${timeoutSeconds}s timeout`;
}

interface RunRowProps {
  run: AutomationRun;
  projectId: string;
}

function RunRow({ run, projectId }: RunRowProps) {
  const status = getRunStatusLabel(run);
  const duration = formatRunDuration(run);
  const silent = isSilentRun(run);
  const showOutput =
    run.runMode === "script" &&
    (run.output !== null || run.error !== null || silent);

  return (
    <div className="overflow-hidden rounded-md border border-border">
      <div className="flex items-center gap-2 px-3 py-2 text-sm">
        <span className={cn("font-medium", RUN_STATUS_TONE_CLASS[status.tone])}>
          {status.label}
        </span>
        <span className="text-xs text-muted-foreground">
          {formatRunTimestamp(run.startedAt)}
          {duration ? ` · ${duration}` : ""}
        </span>
        {run.runMode === "agent" && run.threadId ? (
          <Link
            to={getThreadRoutePath({ projectId, threadId: run.threadId })}
            className="ml-auto text-xs text-muted-foreground hover:text-foreground hover:underline"
          >
            View thread
          </Link>
        ) : run.runMode === "script" && run.exitCode !== null ? (
          <span className="ml-auto font-mono text-xs text-muted-foreground">
            exit {run.exitCode}
          </span>
        ) : null}
      </div>
      {run.skipReason ? (
        <p className="border-t border-border-seam px-3 py-2 text-xs text-muted-foreground">
          {run.skipReason}
        </p>
      ) : null}
      {showOutput ? (
        <pre
          className={cn(
            "whitespace-pre-wrap border-t border-border-seam bg-surface-recessed px-3 py-2 font-mono text-xs leading-relaxed",
            run.error ? "text-destructive" : "text-foreground",
            silent && "italic text-subtle-foreground",
          )}
        >
          {run.error ??
            (silent
              ? "no output — silent gate, nothing surfaced"
              : (run.output ?? ""))}
        </pre>
      ) : null}
    </div>
  );
}

function durationSeconds(run: AutomationRun): number | null {
  if (run.finishedAt === null) {
    return null;
  }
  const seconds = (run.finishedAt - run.startedAt) / 1000;
  return seconds < 0 ? null : seconds;
}

function HealthStat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: string;
}) {
  return (
    <div className="rounded-lg border border-border bg-card px-3 py-2">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div
        className={cn(
          "mt-0.5 text-sm font-semibold tabular-nums",
          tone ?? "text-foreground",
        )}
      >
        {value}
      </div>
    </div>
  );
}

function ConfigLine({ k, v }: { k: string; v: string }) {
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
  onRun: () => void;
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
  onRun,
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

  const finishedRuns = runs.filter(
    (run) => run.status === "succeeded" || run.status === "failed",
  );
  const succeededCount = finishedRuns.filter(
    (run) => run.status === "succeeded",
  ).length;
  const successRate =
    finishedRuns.length > 0
      ? `${Math.round((succeededCount / finishedRuns.length) * 100)}%`
      : "—";
  const durations = runs
    .map(durationSeconds)
    .filter((value): value is number => value !== null);
  const avgDuration =
    durations.length > 0
      ? `${Math.round(durations.reduce((a, b) => a + b, 0) / durations.length)}s`
      : "—";
  const lastRun = runs[0] ?? null;
  const lastRunStatus = lastRun ? getRunStatusLabel(lastRun) : null;
  const lastRunValue = lastRunStatus ? lastRunStatus.label : "Never run";
  const lastRunTone = lastRunStatus
    ? RUN_STATUS_TONE_CLASS[lastRunStatus.tone]
    : "text-muted-foreground";
  const nextRunValue = automation.enabled
    ? automation.nextRunAt !== null
      ? formatRunTimestamp(automation.nextRunAt)
      : "Not scheduled"
    : "Paused";

  return (
    <PageShell contentClassName="pt-4 md:pt-5">
      <div className="mx-auto w-full max-w-3xl space-y-6">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="truncate text-xl font-semibold tracking-tight text-foreground">
              {automation.name}
            </h1>
            <p className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
              <span
                aria-hidden="true"
                className={cn(
                  "size-1.5 rounded-full",
                  automation.enabled ? "bg-success" : "bg-muted-foreground/50",
                )}
              />
              {automation.enabled ? "Active" : "Paused"}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {/* Always a way to view the latest run's thread when one exists. */}
            {automation.lastRunThreadId ? (
              <Button asChild variant="outline" size="sm">
                <Link
                  to={getThreadRoutePath({
                    projectId: automation.projectId,
                    threadId: automation.lastRunThreadId,
                  })}
                  aria-label="View thread"
                  title="View the latest run's thread"
                >
                  <Icon name="MessageSquare" className="size-4" />
                  View thread
                </Link>
              </Button>
            ) : null}
            <Button
              type="button"
              variant="outline"
              size="sm"
              aria-label="Run now"
              title="Run now"
              disabled={actionsPending}
              onClick={onRun}
            >
              <Icon name="Zap" className="size-4" />
              Run now
            </Button>
            {automation.enabled ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                aria-label="Pause"
                title="Pause"
                disabled={actionsPending}
                onClick={onPause}
              >
                <Icon name="Pause" className="size-4" />
                Pause
              </Button>
            ) : (
              <Button
                type="button"
                variant="outline"
                size="sm"
                aria-label="Resume"
                title="Resume"
                disabled={actionsPending}
                onClick={onResume}
              >
                <Icon name="Play" className="size-4" />
                Resume
              </Button>
            )}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  aria-label="More loop actions"
                  title="More actions"
                  disabled={actionsPending}
                >
                  <Icon name="MoreHorizontal" className="size-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-40">
                <DropdownMenuItem onSelect={startEditing}>
                  <Icon name="Edit" className="size-4 text-muted-foreground" />
                  Edit
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  className="text-destructive focus:text-destructive"
                  onSelect={onDelete}
                >
                  <Icon name="Trash2" className="size-4" />
                  Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <HealthStat label="Success rate" value={successRate} />
          <HealthStat label="Last run" value={lastRunValue} tone={lastRunTone} />
          <HealthStat label="Next run" value={nextRunValue} />
          <HealthStat label="Avg duration" value={avgDuration} />
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
                <ConfigLine k="Execution" v={describeExecution(automation)} />
                <ConfigLine
                  k="Environment"
                  v={describeEnvironment(automation)}
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
            <p className="text-sm text-muted-foreground">Loading...</p>
          ) : runs.length === 0 ? (
            <EmptyStatePanel className="py-6">No runs yet.</EmptyStatePanel>
          ) : (
            <div className="space-y-2">
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
  const runAutomation = useRunAutomation();
  const deleteAutomation = useDeleteAutomation();
  const updateAutomation = useUpdateAutomation();
  const deleteDialog = useDialogState<true>();
  const { mutate: pauseMutate } = pauseAutomation;
  const { mutate: resumeMutate } = resumeAutomation;
  const { mutate: runMutate } = runAutomation;
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
  const handleRun = useCallback(() => {
    runMutate({ projectId, automationId });
  }, [runMutate, projectId, automationId]);
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
    runAutomation.isPending ||
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
        onRun={handleRun}
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

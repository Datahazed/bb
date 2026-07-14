import type { ReactNode } from "react";
import type {
  AutomationExecution,
  AutomationResponse,
  AutomationRunResponse,
} from "./src/rpc-types";
import { Button } from "@bb/shared-ui/button";
import { EmptyStatePanel } from "@bb/shared-ui/empty-state";
import { Icon, type IconName } from "@bb/shared-ui/icon";
import { Input } from "@bb/shared-ui/input";
import {
  ResourceActionButton,
  ResourceActivitySection,
  ResourceDefinitionSection,
  ResourceDetailBackButton,
  ResourceDetailList,
  ResourceDetailPage,
  ResourceDetailPanel,
  ResourceOverflowMenu,
  ResourceProperty,
  ResourcePropertyList,
} from "@bb/shared-ui/resource-list";
import { Switch } from "@bb/shared-ui/switch";
import { Textarea } from "@bb/shared-ui/textarea";
import { cn } from "@bb/shared-ui/lib/utils";
import {
  formatAutomationTrigger,
  formatScheduleRunTime,
  formatScheduleStatusLabel,
  isCompletedOneShotAutomation,
} from "./lib/format-schedule";

export interface AutomationRunsViewState {
  runs: readonly AutomationRunResponse[];
  nextCursor: string | null;
  loading: boolean;
  loadingMore: boolean;
  error: string | null;
  loadMore: () => void;
}

export interface AutomationDetailViewProps {
  automation: AutomationResponse;
  projectLabel: string;
  runsState: AutomationRunsViewState;
  editing: boolean;
  draftName: string;
  draftBody: string;
  actionPending: boolean;
  saving: boolean;
  onBack: () => void;
  onToggle: (enabled: boolean) => void;
  onEdit: () => void;
  onCancelEdit: () => void;
  onSave: () => void;
  onRunNow: () => void;
  onDelete: () => void;
  onDraftNameChange: (name: string) => void;
  onDraftBodyChange: (body: string) => void;
  onOpenThread: (threadId: string) => void;
  footer?: ReactNode;
}

export function automationIconName(automation: AutomationResponse): IconName {
  return automation.execution.mode === "script"
    ? "ComputerTerminal01"
    : "Calendar";
}

export function automationScheduleLabel(
  automation: AutomationResponse,
): string {
  return formatScheduleStatusLabel({
    enabled: automation.enabled,
    nextRunAt: automation.nextRunAt,
    trigger: automation.trigger,
    runCount: automation.runCount,
  });
}

function describeExecution(execution: AutomationExecution): string {
  if (execution.mode === "agent") {
    return `Agent · ${execution.providerId}/${execution.model} · ${execution.permissionMode}`;
  }
  const interpreter = execution.interpreter ?? "bash";
  const target = execution.scriptFile ?? "inline script";
  const timeoutSeconds = Math.round(execution.timeoutMs / 1000);
  return `Script · ${interpreter} ${target} · ${timeoutSeconds}s timeout`;
}

function automationEditBodyLabel(execution: AutomationExecution): string {
  if (execution.mode === "agent") return "Prompt";
  return execution.scriptFile !== undefined && execution.script === undefined
    ? "Script file"
    : "Script";
}

export function automationEditBodyValue(
  execution: AutomationExecution,
): string {
  if (execution.mode === "agent") return execution.prompt;
  return execution.script ?? execution.scriptFile ?? "";
}

export function withAutomationEditBody(
  execution: AutomationExecution,
  body: string,
): AutomationExecution {
  if (execution.mode === "agent") return { ...execution, prompt: body };
  const base = {
    mode: "script" as const,
    timeoutMs: execution.timeoutMs,
    ...(execution.interpreter !== undefined
      ? { interpreter: execution.interpreter }
      : {}),
    ...(execution.env !== undefined ? { env: execution.env } : {}),
  };
  return execution.scriptFile !== undefined && execution.script === undefined
    ? { ...base, scriptFile: body }
    : { ...base, script: body };
}

function automationEnvironmentLabel(execution: AutomationExecution): string {
  if (execution.mode !== "agent") return "Host";
  const environment = execution.environment;
  if (environment.type === "reuse") return "Existing environment";
  if (environment.type === "project-default") return "Project default";
  if (environment.workspace.type === "managed-worktree") return "Worktree";
  if (environment.workspace.type === "personal") return "Personal workspace";
  return environment.workspace.path ?? "Local workspace";
}

function formatRunDuration(run: AutomationRunResponse): string | null {
  if (run.finishedAt === null) return null;
  const seconds = (run.finishedAt - run.startedAt) / 1000;
  if (seconds < 0) return null;
  return `${seconds.toFixed(seconds < 10 ? 1 : 0)}s`;
}

function isSilentRun(run: AutomationRunResponse): boolean {
  return (
    run.status === "succeeded" &&
    run.runMode === "script" &&
    (run.output === null || run.output.trim().length === 0)
  );
}

function runStatusVisual(run: AutomationRunResponse): {
  label: string;
  icon: IconName;
  className: string;
} {
  switch (run.status) {
    case "running":
      return {
        label: "Running",
        icon: "Loading",
        className: "animate-spin text-muted-foreground",
      };
    case "failed":
      return {
        label: "Failed",
        icon: "CircleX",
        className: "text-destructive",
      };
    case "skipped":
      return {
        label: "Skipped",
        icon: "CircleDashed",
        className: "text-muted-foreground",
      };
    case "succeeded":
      return {
        label: "Succeeded",
        icon: "CircleCheck",
        className: "text-success",
      };
  }
}

function RunRow({
  run,
  onOpenThread,
}: {
  run: AutomationRunResponse;
  onOpenThread: (threadId: string) => void;
}) {
  const status = runStatusVisual(run);
  const duration = formatRunDuration(run);
  const silent = isSilentRun(run);
  const showOutput =
    run.runMode === "script" &&
    (run.output !== null || run.error !== null || silent);
  return (
    <div className="overflow-hidden rounded-sm">
      <div className="flex items-center gap-2 px-2 py-1.5 text-sm">
        <span
          role="img"
          aria-label={status.label}
          className="inline-flex shrink-0 items-center"
        >
          <Icon
            name={status.icon}
            className={cn("size-4", status.className)}
            aria-hidden
          />
        </span>
        <span className="font-medium">
          {formatScheduleRunTime(run.startedAt)}
        </span>
        {duration ? (
          <span className="text-xs text-muted-foreground">{duration}</span>
        ) : null}
        {run.runMode === "agent" && run.threadId ? (
          <button
            type="button"
            onClick={() => onOpenThread(run.threadId!)}
            className="ml-auto text-xs text-muted-foreground hover:text-foreground hover:underline"
          >
            View thread
          </button>
        ) : run.runMode === "script" && run.exitCode !== null ? (
          <span className="ml-auto font-mono text-xs text-muted-foreground">
            exit {run.exitCode}
          </span>
        ) : null}
      </div>
      {run.skipReason ? (
        <p className="mx-2 mb-2 rounded-md border border-border bg-surface-recessed px-3 py-2 text-xs text-muted-foreground">
          {run.skipReason}
        </p>
      ) : null}
      {showOutput ? (
        <pre
          className={cn(
            "mx-2 mb-2 whitespace-pre-wrap rounded-md border border-border bg-surface-recessed px-3 py-2 font-mono text-xs leading-relaxed",
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

export function AutomationDetailView({
  automation,
  projectLabel,
  runsState,
  editing,
  draftName,
  draftBody,
  actionPending,
  saving,
  onBack,
  onToggle,
  onEdit,
  onCancelEdit,
  onSave,
  onRunNow,
  onDelete,
  onDraftNameChange,
  onDraftBodyChange,
  onOpenThread,
  footer,
}: AutomationDetailViewProps) {
  const completedOneShot = isCompletedOneShotAutomation({
    enabled: automation.enabled,
    trigger: automation.trigger,
    runCount: automation.runCount,
  });
  const editableBodyLabel = automationEditBodyLabel(automation.execution);
  const canSave =
    draftName.trim().length > 0 &&
    draftBody.trim().length > 0 &&
    !saving &&
    !actionPending;
  const definitionActions = editing ? (
    <>
      <ResourceActionButton
        label="Cancel editing"
        icon="X"
        disabled={saving}
        onClick={onCancelEdit}
      />
      <ResourceActionButton
        label="Save automation"
        icon="Check"
        disabled={!canSave}
        onClick={onSave}
      />
    </>
  ) : undefined;

  return (
    <ResourceDetailPage
      back={
        <ResourceDetailBackButton
          label="Back to automations"
          onClick={onBack}
        />
      }
      leading={
        <Icon
          name={automationIconName(automation)}
          className="size-4 shrink-0 text-muted-foreground"
          aria-hidden
        />
      }
      title={editing ? draftName || automation.name : automation.name}
      titleMeta={projectLabel}
      lifecycleControl={
        <Switch
          size="sm"
          checked={automation.enabled}
          disabled={actionPending || saving || completedOneShot}
          aria-label={
            automation.enabled ? "Pause automation" : "Resume automation"
          }
          onCheckedChange={onToggle}
        />
      }
      overflowMenu={
        <ResourceOverflowMenu
          label={`${automation.name} actions`}
          disabled={actionPending || saving}
          items={[
            {
              label: "Edit",
              icon: "Edit",
              disabled: editing,
              onSelect: onEdit,
            },
            { kind: "separator" },
            { label: "Run now", icon: "Play", onSelect: onRunNow },
            { kind: "separator" },
            {
              label: "Delete",
              icon: "Trash2",
              tone: "destructive",
              onSelect: onDelete,
            },
          ]}
        />
      }
    >
      <ResourceDefinitionSection label="Configuration">
        <ResourcePropertyList>
          <ResourceProperty label="Schedule">
            {formatAutomationTrigger(automation.trigger)} ·{" "}
            {automationScheduleLabel(automation)}
          </ResourceProperty>
          <ResourceProperty label="Environment">
            {automationEnvironmentLabel(automation.execution)}
          </ResourceProperty>
          <ResourceProperty label="Execution">
            {describeExecution(automation.execution)}
          </ResourceProperty>
          <ResourceProperty label="Created by">
            <span className="capitalize">{automation.origin}</span>
          </ResourceProperty>
        </ResourcePropertyList>
      </ResourceDefinitionSection>

      <ResourceDefinitionSection
        label={editableBodyLabel}
        actions={definitionActions}
      >
        <div className="space-y-2">
          {editing ? (
            <label className="block space-y-1 text-xs font-medium text-muted-foreground">
              <span>Name</span>
              <Input
                value={draftName}
                onChange={(event) => onDraftNameChange(event.target.value)}
                aria-label="Automation name"
                className="h-8"
              />
            </label>
          ) : null}
          <ResourceDetailPanel className="p-3">
            {automation.execution.mode === "agent" ? (
              editing ? (
                <Textarea
                  value={draftBody}
                  onChange={(event) => onDraftBodyChange(event.target.value)}
                  aria-label="Automation prompt"
                  className="min-h-40 resize-y text-sm leading-relaxed"
                />
              ) : (
                <p className="whitespace-pre-wrap text-sm leading-relaxed">
                  {automation.execution.prompt}
                </p>
              )
            ) : automation.execution.script ? (
              editing ? (
                <Textarea
                  value={draftBody}
                  onChange={(event) => onDraftBodyChange(event.target.value)}
                  aria-label="Automation script"
                  className="min-h-40 resize-y font-mono text-xs leading-relaxed"
                />
              ) : (
                <pre className="whitespace-pre-wrap font-mono text-xs leading-relaxed">
                  {automation.execution.script}
                </pre>
              )
            ) : automation.execution.scriptFile ? (
              editing ? (
                <Input
                  value={draftBody}
                  onChange={(event) => onDraftBodyChange(event.target.value)}
                  aria-label="Automation script file"
                  className="h-8 font-mono text-xs"
                />
              ) : (
                <span className="font-mono text-xs">
                  {automation.execution.scriptFile}
                </span>
              )
            ) : null}
          </ResourceDetailPanel>
        </div>
      </ResourceDefinitionSection>

      <ResourceActivitySection label="Run history">
        {runsState.error !== null ? (
          <ResourceDetailPanel className="px-3 py-6 text-center text-sm text-destructive">
            Failed to load runs.
          </ResourceDetailPanel>
        ) : runsState.loading ? (
          <ResourceDetailPanel className="px-3 py-6 text-center text-sm text-muted-foreground">
            Loading…
          </ResourceDetailPanel>
        ) : runsState.runs.length === 0 ? (
          <EmptyStatePanel className="py-6">No runs yet.</EmptyStatePanel>
        ) : (
          <div className="space-y-2">
            <ResourceDetailList>
              {runsState.runs.map((run) => (
                <RunRow key={run.id} run={run} onOpenThread={onOpenThread} />
              ))}
            </ResourceDetailList>
            {runsState.nextCursor !== null ? (
              <div className="flex justify-center pt-1">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={runsState.loadingMore}
                  onClick={runsState.loadMore}
                >
                  {runsState.loadingMore ? "Loading…" : "Load more"}
                </Button>
              </div>
            ) : null}
          </div>
        )}
      </ResourceActivitySection>
      {footer}
    </ResourceDetailPage>
  );
}

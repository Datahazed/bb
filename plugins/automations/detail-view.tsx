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
  ResourceActivitySection,
  ResourceDefinitionSection,
  ResourceDetailBackButton,
  ResourceDetailList,
  ResourceDetailPage,
  ResourceDetailPanel,
  ResourceDetailStack,
  ResourceOverflowMenu,
  ResourcePromptEditor,
  ResourceProperty,
  ResourcePropertyList,
} from "@bb/shared-ui/resource-list";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@bb/shared-ui/select";
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
  draftExecution: AutomationExecution;
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
  onDraftExecutionChange: (execution: AutomationExecution) => void;
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

type ScriptExecution = Extract<AutomationExecution, { mode: "script" }>;
type ScriptInterpreter = NonNullable<ScriptExecution["interpreter"]>;

const SCRIPT_INTERPRETERS: readonly {
  value: ScriptInterpreter;
  label: string;
}[] = [
  { value: "bash", label: "Bash" },
  { value: "sh", label: "Shell (sh)" },
  { value: "node", label: "Node.js" },
  { value: "python3", label: "Python 3" },
];

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
  draftExecution,
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
  onDraftExecutionChange,
  onOpenThread,
  footer,
}: AutomationDetailViewProps) {
  const completedOneShot = isCompletedOneShotAutomation({
    enabled: automation.enabled,
    trigger: automation.trigger,
    runCount: automation.runCount,
  });
  const editableBodyLabel = automationEditBodyLabel(automation.execution);
  const draftBody = automationEditBodyValue(draftExecution);
  const canSave =
    draftName.trim().length > 0 &&
    draftBody.trim().length > 0 &&
    (draftExecution.mode !== "script" ||
      (draftExecution.timeoutMs > 0 && draftExecution.timeoutMs <= 900_000)) &&
    !saving &&
    !actionPending;

  if (editing) {
    return (
      <ResourceDetailPage
        back={
          <ResourceDetailBackButton
            label="Back to automation"
            onClick={onCancelEdit}
          />
        }
        leading={
          <Icon
            name="Edit"
            className="size-4 shrink-0 text-muted-foreground"
            aria-hidden
          />
        }
        title={`Edit ${automation.name}`}
        titleMeta={projectLabel}
        actions={
          <>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={saving}
              onClick={onCancelEdit}
            >
              Cancel
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={!canSave}
              aria-busy={saving}
              onClick={onSave}
            >
              {saving ? "Saving…" : "Save"}
            </Button>
          </>
        }
      >
        <ResourceDetailStack>
          <ResourceDefinitionSection label="Details" layout="inline">
            <label className="block space-y-1.5 text-xs font-medium text-muted-foreground">
              <span>Name</span>
              <Input
                value={draftName}
                onChange={(event) => onDraftNameChange(event.target.value)}
                aria-label="Automation name"
                className="h-8"
              />
            </label>
          </ResourceDefinitionSection>

          {draftExecution.mode === "agent" ? (
            <ResourceDefinitionSection label="Prompt" layout="inline">
              <ResourcePromptEditor
                value={draftExecution.prompt}
                ariaLabel="Automation prompt"
                placeholder="What should the agent do when this automation runs?"
                onChange={(prompt) =>
                  onDraftExecutionChange({ ...draftExecution, prompt })
                }
              />
            </ResourceDefinitionSection>
          ) : (
            <>
              <ResourceDefinitionSection label="Execution" layout="inline">
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="block space-y-1.5 text-xs font-medium text-muted-foreground">
                    <span>Interpreter</span>
                    <Select
                      value={draftExecution.interpreter ?? "bash"}
                      onValueChange={(value) => {
                        const interpreter = SCRIPT_INTERPRETERS.find(
                          (option) => option.value === value,
                        )?.value;
                        if (interpreter === undefined) return;
                        onDraftExecutionChange({
                          ...draftExecution,
                          interpreter,
                        });
                      }}
                    >
                      <SelectTrigger
                        className="h-8 text-xs"
                        aria-label="Script interpreter"
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {SCRIPT_INTERPRETERS.map((option) => (
                          <SelectItem key={option.value} value={option.value}>
                            {option.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </label>
                  <label className="block space-y-1.5 text-xs font-medium text-muted-foreground">
                    <span>Timeout</span>
                    <span className="relative block">
                      <Input
                        type="number"
                        min={1}
                        max={900}
                        value={Math.round(draftExecution.timeoutMs / 1000)}
                        onChange={(event) =>
                          onDraftExecutionChange({
                            ...draftExecution,
                            timeoutMs:
                              Number.parseInt(event.target.value, 10) * 1000 ||
                              0,
                          })
                        }
                        aria-label="Script timeout in seconds"
                        className="h-8 pr-16 text-xs"
                      />
                      <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-2xs text-muted-foreground">
                        seconds
                      </span>
                    </span>
                  </label>
                </div>
              </ResourceDefinitionSection>
              <ResourceDefinitionSection
                label={editableBodyLabel}
                layout="inline"
              >
                {draftExecution.scriptFile !== undefined &&
                draftExecution.script === undefined ? (
                  <Input
                    value={draftExecution.scriptFile}
                    readOnly
                    aria-readonly="true"
                    aria-label="Automation script file"
                    className="h-8 cursor-default bg-surface-recessed font-mono text-xs text-muted-foreground"
                  />
                ) : (
                  <Textarea
                    value={draftExecution.script ?? ""}
                    onChange={(event) =>
                      onDraftExecutionChange({
                        ...draftExecution,
                        script: event.target.value,
                      })
                    }
                    aria-label="Automation script"
                    className="min-h-64 resize-y font-mono text-xs leading-relaxed"
                  />
                )}
              </ResourceDefinitionSection>
            </>
          )}
        </ResourceDetailStack>
      </ResourceDetailPage>
    );
  }

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
      title={automation.name}
      titleMeta={projectLabel}
      lifecycleControl={
        <Switch
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
      <ResourceDetailStack>
        <ResourceDefinitionSection label="Configuration" layout="inline">
          <ResourcePropertyList
            surface="flat"
            className="divide-y divide-border"
          >
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

        <ResourceDefinitionSection label={editableBodyLabel} layout="inline">
          <ResourceDetailPanel surface="recessed" className="px-3 py-2">
            {automation.execution.mode === "agent" ? (
              <p className="whitespace-pre-wrap text-sm leading-relaxed">
                {automation.execution.prompt}
              </p>
            ) : automation.execution.script ? (
              <pre className="whitespace-pre-wrap font-mono text-xs leading-relaxed">
                {automation.execution.script}
              </pre>
            ) : automation.execution.scriptFile ? (
              <span className="font-mono text-xs">
                {automation.execution.scriptFile}
              </span>
            ) : null}
          </ResourceDetailPanel>
        </ResourceDefinitionSection>

        <ResourceActivitySection label="Run history" layout="inline">
          {runsState.error !== null ? (
            <ResourceDetailPanel
              surface="recessed"
              className="px-3 py-6 text-center text-sm text-destructive"
            >
              Failed to load runs.
            </ResourceDetailPanel>
          ) : runsState.loading ? (
            <ResourceDetailPanel
              surface="recessed"
              className="px-3 py-6 text-center text-sm text-muted-foreground"
            >
              Loading…
            </ResourceDetailPanel>
          ) : runsState.runs.length === 0 ? (
            <EmptyStatePanel className="py-6">No runs yet.</EmptyStatePanel>
          ) : (
            <div className="space-y-2">
              <ResourceDetailList
                surface="flat"
                className="divide-y divide-border p-0"
              >
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
      </ResourceDetailStack>
      {footer}
    </ResourceDetailPage>
  );
}

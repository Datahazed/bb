import {
  useCallback,
  useLayoutEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import {
  automationScriptInterpreterValues,
  type AutomationScriptInterpreter,
} from "@bb/domain";
import {
  AUTOMATION_SCRIPT_TIMEOUT_DEFAULT_MS,
  AUTOMATION_SCRIPT_TIMEOUT_MAX_MS,
  type Automation,
  type AutomationRun,
  type UpdateAutomationRequest,
} from "@bb/server-contract";
import { Button } from "@/components/ui/button.js";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu.js";
import {
  ConfirmDeleteDialog,
  ConfirmDeleteDialogContent,
} from "@/components/dialogs/ConfirmDeleteDialog.js";
import { ExecutionControls } from "@/components/promptbox/ExecutionControls";
import { PermissionModePicker } from "@/components/pickers/PermissionModePicker";
import { PromptBoxInternal } from "@/components/promptbox/PromptBoxInternal";
import type { PromptMentionLinkResolver } from "@/components/promptbox/editor/prompt-mention-link";
import {
  permissionDisplayForPromptMode,
  shouldDisablePermissionPickerForPromptMode,
} from "@/components/promptbox/effective-prompt-mode";
import { useComposerArea } from "@/components/promptbox/useComposerArea";
import { EmptyStatePanel } from "@/components/ui/empty-state.js";
import { Skeleton } from "@/components/ui/skeleton.js";
import { Icon, type IconName } from "@/components/ui/icon.js";
import { Input } from "@/components/ui/input.js";
import { PageShell } from "@/components/ui/page-shell.js";
import { Pill } from "@/components/ui/pill.js";
import { Switch } from "@/components/ui/switch.js";
import {
  SIDEBAR_SUCCESS_STATUS_DOT_CLASS,
  SIDEBAR_WORKING_STATUS_COLOR_CLASS,
} from "@/components/sidebar/sidebarRowClasses";
import { useDialogState } from "@/hooks/useDialogState";
import {
  useAutomationDetail,
  useAutomationRuns,
  useDeleteAutomation,
  usePauseAutomation,
  useResumeAutomation,
  useUpdateAutomation,
} from "@/hooks/queries/automation-queries";
import { getEnvironmentWorkspaceLabelIconName } from "@/lib/environment-workspace-display";
import {
  formatAutomationTrigger,
  formatCronCadence,
} from "@/lib/format-schedule";
import { getProviderIconInfo } from "@/lib/provider-icon";
import { REASONING_LABELS } from "@/lib/reasoning-labels";
import { getAutomationsRoutePath, getThreadRoutePath } from "@/lib/route-paths";
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
  if (seconds < 60) {
    return `${seconds.toFixed(seconds < 10 ? 1 : 0)}s`;
  }
  const minutes = Math.floor(seconds / 60);
  const remainder = Math.round(seconds % 60);
  return remainder === 0 ? `${minutes}m` : `${minutes}m ${remainder}s`;
}

/** A succeeded script run that produced no surfaced output reads as "silent". */
function isSilentRun(run: AutomationRun): boolean {
  return (
    run.status === "succeeded" &&
    run.runMode === "script" &&
    (run.output === null || run.output.trim().length === 0)
  );
}

/**
 * Run status glyph, reusing the sidebar thread-status vocabulary so a loop run
 * reads like a thread in the sidebar: a muted spinner while running, the sidebar
 * success dot when done, and a destructive CircleX on failure. No bespoke
 * run-status icons.
 */
function RunStatusGlyph({ status }: { status: AutomationRun["status"] }) {
  switch (status) {
    case "running":
      return (
        <Icon
          name="Loading"
          aria-label="Running"
          className={cn(
            "size-4 shrink-0 animate-spin",
            SIDEBAR_WORKING_STATUS_COLOR_CLASS,
          )}
        />
      );
    // `skipped` isn't emitted by the scheduler yet — the "nothing to do" outcome
    // is a silent success — so fold it into the success dot instead of giving it
    // its own glyph. Kept in the switch so the status type stays exhaustive.
    case "skipped":
    case "succeeded":
      return (
        <span
          role="img"
          aria-label="Succeeded"
          className="inline-flex size-4 shrink-0 items-center justify-center"
        >
          <span className={SIDEBAR_SUCCESS_STATUS_DOT_CLASS} aria-hidden />
        </span>
      );
    case "failed":
      return (
        <Icon
          name="CircleX"
          aria-label="Failed"
          className="size-4 shrink-0 text-destructive"
        />
      );
    default: {
      const _exhaustive: never = status;
      return _exhaustive;
    }
  }
}

/**
 * Environment shown with the same vocabulary + icon as the composer's
 * environment picker: "Local" on a laptop icon, worktrees on the git-folder
 * icon (via the shared `getEnvironmentWorkspaceLabelIconName`).
 */
function describeEnvironment(automation: Automation): {
  icon: IconName;
  label: string;
} {
  const { environment } = automation;
  if (environment.type === "reuse") {
    return {
      icon: getEnvironmentWorkspaceLabelIconName("managed-worktree"),
      label: "Existing worktree",
    };
  }
  switch (environment.workspace.type) {
    case "personal":
      return {
        icon: getEnvironmentWorkspaceLabelIconName("other"),
        label: "Local",
      };
    case "managed-worktree":
      return {
        icon: getEnvironmentWorkspaceLabelIconName("managed-worktree"),
        label: "Worktree",
      };
    case "unmanaged":
      return {
        icon: getEnvironmentWorkspaceLabelIconName("unmanaged-worktree"),
        label: environment.workspace.path ?? "Worktree",
      };
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
        {execution.reasoningLevel ? (
          <Pill variant="outline" className="text-muted-foreground">
            {REASONING_LABELS[execution.reasoningLevel]}
          </Pill>
        ) : null}
        <Pill variant="outline" className="text-muted-foreground">
          {PERMISSION_LABEL[execution.permissionMode] ??
            execution.permissionMode}
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
  const { icon, label } = describeEnvironment(automation);
  return (
    <span className="flex items-center gap-1.5">
      <Icon
        name={icon}
        className="size-3.5 shrink-0 text-muted-foreground"
        aria-hidden
      />
      {label}
    </span>
  );
}

interface RunRowProps {
  run: AutomationRun;
  projectId: string;
}

function RunRow({ run, projectId }: RunRowProps) {
  const duration = formatRunDuration(run);
  const silent = isSilentRun(run);
  // One subtle detail line, not a heavy output banner: the error, the silent
  // note, or the script's captured output.
  const detail =
    run.error ??
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
        {/* The glyph carries the status (no text label). */}
        <RunStatusGlyph status={run.status} />
        {/* When it ran is the row's anchor; duration trails as a muted aside. */}
        <span className="min-w-0 truncate">
          <span className="text-foreground">
            {formatRunTimestamp(run.startedAt)}
          </span>
          {duration ? (
            <span className="text-xs text-muted-foreground">
              {" · "}
              {duration}
            </span>
          ) : null}
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
                {run.runMode === "script"
                  ? "View spawned thread"
                  : "View thread"}
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
    <div className="flex items-baseline gap-3 border-b border-border-seam py-2.5 text-sm last:border-0">
      <span className="w-24 shrink-0 text-muted-foreground">{k}</span>
      <span className="min-w-0 break-words text-foreground">{v}</span>
    </div>
  );
}

/**
 * Auto-archive is a set-and-forget config option, so it reads as a checkbox in
 * the edit form rather than a live Switch. Native `<input>` with `appearance-none`
 * plus an overlaid Check keeps it monochrome and on-theme in both light and dark.
 */
function AutoArchiveField({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <label className="flex w-fit cursor-pointer items-center gap-2.5 text-sm text-foreground">
      <span className="relative flex size-4 shrink-0 items-center justify-center">
        <input
          type="checkbox"
          checked={checked}
          onChange={(event) => onChange(event.target.checked)}
          className="peer size-4 cursor-pointer appearance-none rounded-[4px] border border-input bg-transparent transition-colors checked:border-primary checked:bg-primary focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        />
        <Icon
          name="Check"
          className="pointer-events-none absolute size-3 text-primary-foreground opacity-0 peer-checked:opacity-100"
          aria-hidden
        />
      </span>
      Auto-archive the thread when it finishes
    </label>
  );
}

const DEFAULT_INTERPRETER: AutomationScriptInterpreter = "bash";
const AUTOMATION_SCRIPT_TIMEOUT_MAX_SECONDS = Math.floor(
  AUTOMATION_SCRIPT_TIMEOUT_MAX_MS / 1000,
);

function initialScript(automation: Automation): string {
  return automation.execution.mode === "script"
    ? (automation.execution.script ?? "")
    : "";
}

function initialInterpreter(
  automation: Automation,
): AutomationScriptInterpreter {
  return automation.execution.mode === "script"
    ? (automation.execution.interpreter ?? DEFAULT_INTERPRETER)
    : DEFAULT_INTERPRETER;
}

function initialTimeoutSeconds(automation: Automation): string {
  const ms =
    automation.execution.mode === "script"
      ? automation.execution.timeoutMs
      : AUTOMATION_SCRIPT_TIMEOUT_DEFAULT_MS;
  return String(Math.round(ms / 1000));
}

/**
 * Clamp the edited timeout (seconds) to a valid millisecond value, falling back
 * to the default when the field is blank or non-numeric.
 */
function resolveTimeoutMs(timeoutSeconds: string): number {
  const seconds = Number(timeoutSeconds);
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return AUTOMATION_SCRIPT_TIMEOUT_DEFAULT_MS;
  }
  const clamped = Math.min(
    Math.round(seconds),
    AUTOMATION_SCRIPT_TIMEOUT_MAX_SECONDS,
  );
  return clamped * 1000;
}

type AgentAutomationExecution = Extract<
  Automation["execution"],
  { mode: "agent" }
>;

interface AgentAutomationEditComposerProps {
  automation: Automation;
  execution: AgentAutomationExecution;
  editSessionKey: number;
  name: string;
  cron: string;
  timezone: string;
  autoArchive: boolean;
  onAutoArchiveChange: (value: boolean) => void;
  onSave: (patch: UpdateAutomationRequest) => Promise<void>;
  onCancel: () => void;
  onSaved: () => void;
  savePending: boolean;
}

function automationComposerEnvironmentId(
  automation: Automation,
): string | null {
  return automation.environment.type === "reuse"
    ? automation.environment.environmentId
    : null;
}

/**
 * Form-local composer for editing an agent loop. It reuses the prompt-box
 * editor internals plus execution controls, but owns a form save payload rather
 * than thread submission state.
 */
function AgentAutomationEditComposer({
  automation,
  execution,
  editSessionKey,
  name,
  cron,
  timezone,
  autoArchive,
  onAutoArchiveChange,
  onSave,
  onCancel,
  onSaved,
  savePending,
}: AgentAutomationEditComposerProps) {
  const environmentId = automationComposerEnvironmentId(automation);
  const resolveMentionLink = useCallback<PromptMentionLinkResolver>(
    () => null,
    [],
  );
  const composerArea = useComposerArea({
    creationOptions: {
      scope: "component-local",
      environmentId: environmentId ?? undefined,
      resetKey: editSessionKey,
      initialProviderId: execution.providerId,
      initialModel: execution.model,
      initialReasoningLevel: execution.reasoningLevel,
      initialPermissionMode: execution.permissionMode,
    },
    draftScope: {
      kind: "automation-edit",
      automationId: automation.id,
    },
    mentionsProjectId: automation.projectId,
    mentions: {
      environmentId,
    },
    commands: {
      projectId: automation.projectId,
      environmentId,
    },
    resolveMentionLink,
    attachments: { projectId: automation.projectId },
    execution: { providerSwitchable: true },
    permission: { kind: "editable" },
  });
  const {
    attachmentsConfig,
    composer,
    executionConfig,
    permissionConfig,
    promptActions,
    promptDraft,
    setAttachmentError,
    threadCreationOptions,
    typeaheadConfig,
  } = composerArea;

  const { setDraft } = promptDraft;
  useLayoutEffect(() => {
    setDraft({
      text: execution.prompt,
      mentions: [],
      attachments: [],
    });
    setAttachmentError(null);
  }, [editSessionKey, execution.prompt, setAttachmentError, setDraft]);

  const promptModeInput = useMemo(
    () => ({
      providerId: executionConfig.provider.selectedId,
      value: composer.message,
      mentionRanges: composer.mentionRanges,
    }),
    [
      composer.mentionRanges,
      composer.message,
      executionConfig.provider.selectedId,
    ],
  );
  const permissionDisplayOverride = useMemo(
    () => permissionDisplayForPromptMode(promptModeInput),
    [promptModeInput],
  );
  const permissionPickerDisabledByPlanMode =
    shouldDisablePermissionPickerForPromptMode(promptModeInput);

  const selectedProviderId =
    threadCreationOptions.selectedProviderId || execution.providerId;
  const selectedModel = threadCreationOptions.selectedModel || execution.model;
  const selectedReasoningLevel =
    threadCreationOptions.reasoningLevel || execution.reasoningLevel;
  const selectedPermissionMode =
    threadCreationOptions.permissionMode || execution.permissionMode;
  const canSave =
    !threadCreationOptions.isLoadingModels &&
    composer.message.trim().length > 0 &&
    selectedProviderId.length > 0 &&
    selectedModel.length > 0;

  const handleSave = useCallback(async () => {
    if (!canSave) {
      return;
    }
    const patch: UpdateAutomationRequest = {
      name,
      trigger: { triggerType: "schedule", cron, timezone },
      autoArchive,
      execution: {
        mode: "agent",
        prompt: composer.message,
        providerId: selectedProviderId,
        model: selectedModel,
        reasoningLevel: selectedReasoningLevel,
        permissionMode: selectedPermissionMode,
        ...(execution.targetThreadId
          ? { targetThreadId: execution.targetThreadId }
          : {}),
      },
    };

    try {
      await onSave(patch);
      promptDraft.clear();
      onSaved();
    } catch {
      // Mutation errors are surfaced by the global error handler; stay in edit
      // mode so the user can retry without losing their changes.
    }
  }, [
    autoArchive,
    canSave,
    composer.message,
    cron,
    execution.targetThreadId,
    name,
    onSave,
    onSaved,
    promptDraft,
    selectedModel,
    selectedReasoningLevel,
    selectedPermissionMode,
    selectedProviderId,
    timezone,
  ]);

  const handleCancel = useCallback(() => {
    promptDraft.clear();
    setAttachmentError(null);
    onCancel();
  }, [onCancel, promptDraft, setAttachmentError]);

  return (
    <>
      <div>
        <label className="mb-1 block text-xs font-medium text-muted-foreground">
          Prompt
        </label>
        <PromptBoxInternal
          value={composer.message}
          mentionRanges={composer.mentionRanges}
          onChange={composer.onChangeMessage}
          onSubmit={handleSave}
          placeholder="Ask anything. @ to mention files or folders"
          typeahead={typeaheadConfig}
          mentionMenuPlacement="bottom"
          attachments={attachmentsConfig}
          promptActions={promptActions}
          footerStart={<ExecutionControls {...executionConfig} />}
          submission={{
            isSubmitting: savePending,
            disabled: !canSave || savePending,
            title: savePending ? "Saving..." : "Save changes (Enter)",
          }}
          zenMode={{
            layout: "thread",
            storageKey: null,
            resetKey: editSessionKey,
          }}
        />
        <div className="mt-1 flex min-h-6 justify-end px-3.5">
          <PermissionModePicker
            value={permissionConfig.value}
            options={permissionConfig.options}
            onChange={permissionConfig.onChange}
            supported={permissionConfig.supported}
            disabled={savePending || permissionPickerDisabledByPlanMode}
            showChevronWhenDisabled={permissionPickerDisabledByPlanMode}
            displayOverride={permissionDisplayOverride}
            className="h-6"
          />
        </div>
      </div>
      <AutoArchiveField checked={autoArchive} onChange={onAutoArchiveChange} />
      <div className="flex justify-end gap-2 pt-1">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={savePending}
          onClick={handleCancel}
        >
          Cancel
        </Button>
        <Button
          type="button"
          size="sm"
          disabled={savePending || !canSave}
          onClick={handleSave}
        >
          Save changes
        </Button>
      </div>
    </>
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
  /** Start in edit mode (the full page opens here from the Edit action). */
  initialEditing?: boolean;
  /**
   * When set, the `⋯` Edit action calls this instead of flipping the inline
   * form — used by the read-only pane to send editing to the roomy full page.
   * Omit it (as the full page does) to edit in place.
   */
  onEdit?: () => void;
  /** Shows a "back to Loops" link above the title (full page only). */
  backHref?: string;
  /** Optional route state for the back link. Used only by edit-opened details. */
  backState?: { openAutomationId: string };
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
  initialEditing,
  onEdit,
  backHref,
  backState,
}: AutomationDetailContentProps) {
  const [editing, setEditing] = useState(initialEditing ?? false);
  const [editSessionKey, setEditSessionKey] = useState(0);
  const [name, setName] = useState(automation.name);
  const [cron, setCron] = useState(
    automation.trigger.triggerType === "schedule"
      ? automation.trigger.cron
      : "",
  );
  const [timezone, setTimezone] = useState(
    automation.trigger.triggerType === "schedule"
      ? automation.trigger.timezone
      : "",
  );
  const [script, setScript] = useState(initialScript(automation));
  const [interpreter, setInterpreter] = useState<AutomationScriptInterpreter>(
    initialInterpreter(automation),
  );
  const [timeoutSeconds, setTimeoutSeconds] = useState(
    initialTimeoutSeconds(automation),
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
    setScript(initialScript(automation));
    setInterpreter(initialInterpreter(automation));
    setTimeoutSeconds(initialTimeoutSeconds(automation));
    setAutoArchive(automation.autoArchive);
    setEditSessionKey((key) => key + 1);
    setEditing(true);
  }

  async function handleSave() {
    const patch: UpdateAutomationRequest = {
      name,
      trigger: { triggerType: "schedule", cron, timezone },
      autoArchive,
      // Inline-content path: send `script` (not `scriptFile`) so the server
      // rewrites the stored file. `env` is not edited here, so carry the
      // existing value through to avoid silently dropping it.
      ...(automation.execution.mode === "script"
        ? {
            execution: {
              mode: "script" as const,
              script,
              interpreter,
              timeoutMs: resolveTimeoutMs(timeoutSeconds),
              ...(automation.execution.env
                ? { env: automation.execution.env }
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
        {backHref ? (
          <Link
            to={backHref}
            state={backState}
            className="-mb-2 inline-flex w-fit items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            <Icon
              name="ChevronLeft"
              className="size-3.5 shrink-0"
              aria-hidden
            />
            Loops
          </Link>
        ) : null}
        <div className="min-w-0">
          <div className="flex items-center justify-between gap-3">
            <h1 className="min-w-0 truncate text-xl font-semibold tracking-tight text-foreground">
              {automation.name}
            </h1>
            {/* Active/paused is a direct toggle; the menu carries Edit + Delete. */}
            <div className="flex shrink-0 items-center gap-2">
              <Switch
                checked={automation.enabled}
                className="h-4 w-7 data-[state=checked]:bg-success [&>span]:size-3 [&>span[data-state=checked]]:translate-x-3"
                onCheckedChange={() =>
                  automation.enabled ? onPause() : onResume()
                }
                disabled={actionsPending}
                aria-label={
                  automation.enabled
                    ? `Pause ${automation.name}`
                    : `Resume ${automation.name}`
                }
              />
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-7 shrink-0 rounded-md p-0 text-muted-foreground data-[state=open]:bg-state-active data-[state=open]:text-foreground"
                    aria-label={`${automation.name} actions`}
                    disabled={actionsPending}
                  >
                    <Icon name="MoreHorizontal" className="size-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  align="end"
                  className="min-w-0"
                  mobileTitle={`${automation.name} actions`}
                >
                  <DropdownMenuItem
                    onSelect={() => (onEdit ? onEdit() : startEditing())}
                  >
                    <Icon
                      name="Edit"
                      className="size-4 text-muted-foreground"
                    />
                    Edit
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    className="text-destructive focus:text-destructive"
                    onSelect={() => onDelete()}
                  >
                    <Icon name="Trash2" className="size-4" />
                    Delete
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
          {/* Next-run status sits below the title. */}
          <div className="mt-1.5 flex items-center gap-1.5 text-xs text-muted-foreground">
            <Icon name="Clock" className="size-3.5 shrink-0" aria-hidden />
            {nextRunLabel}
          </div>
        </div>

        <section className="space-y-2.5">
          <h2 className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            Configuration
          </h2>
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
                  <AgentAutomationEditComposer
                    automation={automation}
                    execution={automation.execution}
                    editSessionKey={editSessionKey}
                    name={name}
                    cron={cron}
                    timezone={timezone}
                    autoArchive={autoArchive}
                    onAutoArchiveChange={setAutoArchive}
                    onSave={onSave}
                    onCancel={() => setEditing(false)}
                    onSaved={() => setEditing(false)}
                    savePending={savePending}
                  />
                ) : (
                  <>
                    <div>
                      <label className="mb-1 block text-xs font-medium text-muted-foreground">
                        Script
                      </label>
                      <textarea
                        value={script}
                        onChange={(event) => setScript(event.target.value)}
                        rows={10}
                        spellCheck={false}
                        aria-label="Script"
                        className="block w-full resize-y rounded-md border border-input bg-transparent px-3 py-2 font-mono text-xs leading-relaxed focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="mb-1 block text-xs font-medium text-muted-foreground">
                          Interpreter
                        </label>
                        <select
                          value={interpreter}
                          onChange={(event) =>
                            setInterpreter(
                              event.target.value as AutomationScriptInterpreter,
                            )
                          }
                          aria-label="Interpreter"
                          className="h-8 w-full rounded-md border border-input bg-transparent px-2 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                        >
                          {automationScriptInterpreterValues.map((value) => (
                            <option key={value} value={value}>
                              {value}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="mb-1 block text-xs font-medium text-muted-foreground">
                          Timeout (seconds)
                        </label>
                        <Input
                          type="number"
                          min={1}
                          max={AUTOMATION_SCRIPT_TIMEOUT_MAX_SECONDS}
                          value={timeoutSeconds}
                          onChange={(event) =>
                            setTimeoutSeconds(event.target.value)
                          }
                          className="h-8 font-mono text-sm"
                          aria-label="Timeout (seconds)"
                        />
                      </div>
                    </div>
                    <AutoArchiveField
                      checked={autoArchive}
                      onChange={setAutoArchive}
                    />
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
                        disabled={savePending || script.trim().length === 0}
                        onClick={handleSave}
                      >
                        Save changes
                      </Button>
                    </div>
                  </>
                )}
              </div>
            ) : (
              <>
                <ConfigLine
                  k="Schedule"
                  v={
                    automation.trigger.triggerType === "schedule"
                      ? `${formatCronCadence(automation.trigger.cron)} · ${automation.trigger.timezone}`
                      : formatAutomationTrigger(automation.trigger)
                  }
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

        <section className="space-y-2.5">
          <h2 className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            Run history
          </h2>
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
                  <Skeleton className={cn("h-4", labelWidth)} />
                  <Skeleton className="h-3 w-24" />
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
  const location = useLocation();
  // The Edit action navigates here with `{ edit: true }`; open straight into
  // the (roomy) inline form. Reloads drop the state and land on the read view.
  const editIntent =
    (location.state as { edit?: boolean } | null)?.edit === true;

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
        initialEditing={editIntent}
        backHref={getAutomationsRoutePath()}
        backState={editIntent ? { openAutomationId: automation.id } : undefined}
      />
      <ConfirmDeleteDialog
        open={deleteDialog.isOpen}
        onOpenChange={deleteDialog.onOpenChange}
      >
        <ConfirmDeleteDialogContent
          title="Delete loop?"
          description={`"${automation.name}" and its run history will be permanently removed. This can't be undone.`}
          confirmLabel="Delete"
          pending={deleteAutomation.isPending}
          onConfirm={confirmDelete}
          onCancel={closeDeleteDialog}
        />
      </ConfirmDeleteDialog>
    </>
  );
}

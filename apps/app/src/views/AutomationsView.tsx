import { Fragment, useCallback } from "react";
import { Link, useNavigate } from "react-router-dom";
import type {
  Automation,
  AutomationsOverviewResponse,
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
import { Icon, type IconName } from "@/components/ui/icon.js";
import { PageShell } from "@/components/ui/page-shell.js";
import { CREATE_LOOP_PROMPT } from "@/components/promptbox/PromptBoxActionsMenu";
import { useDialogState } from "@/hooks/useDialogState";
import {
  useAutomations,
  useDeleteAutomation,
  usePauseAutomation,
  useResumeAutomation,
  useRunAutomation,
} from "@/hooks/queries/automation-queries";
import {
  formatCronCadence,
  formatScheduleRunTime,
  formatScheduleStatusLabel,
} from "@/lib/format-schedule";
import {
  getAutomationDetailRoutePath,
  getRootComposeRoutePath,
} from "@/lib/route-paths";
import { cn } from "@/lib/utils";

interface AutomationOverviewEntry {
  automation: Automation;
  project: { id: string; name: string };
}

interface AutomationProjectGroup {
  projectId: string;
  projectName: string;
  entries: AutomationOverviewEntry[];
}

/** Per-row action callbacks, supplied by the container so the presentational
 * overview stays free of mutation hooks (and renderable in tests). */
export interface AutomationRowActions {
  onPause: (entry: AutomationOverviewEntry) => void;
  onResume: (entry: AutomationOverviewEntry) => void;
  onRun: (entry: AutomationOverviewEntry) => void;
  onDelete: (entry: AutomationOverviewEntry) => void;
}

interface AutomationRowProps {
  entry: AutomationOverviewEntry;
  actions: AutomationRowActions;
}

export interface AutomationsOverviewProps {
  entries: readonly AutomationOverviewEntry[];
  isLoading: boolean;
  hasInitialLoadError: boolean;
  actions: AutomationRowActions;
  onCreateAutomation: () => void;
}

/**
 * Group loops by the project they belong to, in the order projects first
 * appear. Within a project, enabled loops sort above paused ones. The overview
 * aggregates loops across every project, so the project is the row's context.
 */
function groupAutomationsByProject(
  entries: readonly AutomationOverviewEntry[],
): AutomationProjectGroup[] {
  const byId = new Map<string, AutomationProjectGroup>();
  const order: string[] = [];
  for (const entry of entries) {
    const id = entry.project.id;
    const existing = byId.get(id);
    if (existing) {
      existing.entries.push(entry);
      continue;
    }
    byId.set(id, {
      projectId: id,
      projectName: entry.project.name,
      entries: [entry],
    });
    order.push(id);
  }
  return order.map((id) => {
    const group = byId.get(id)!;
    return {
      ...group,
      entries: [...group.entries].sort(
        (a, b) =>
          Number(b.automation.enabled) - Number(a.automation.enabled),
      ),
    };
  });
}

export interface AutomationRowMenuItem {
  key: "pause" | "resume" | "run" | "delete";
  label: string;
  icon: IconName;
  destructive: boolean;
  /** True when selecting should keep the menu open (the confirm dialog opens). */
  preventClose: boolean;
  run: () => void;
}

/**
 * Pure description of a row's action-menu items, keyed off the automation's
 * enabled state. Exported so tests assert the item set (Pause vs Resume, Run,
 * Delete) without mounting the portaled Radix menu, which `renderToStaticMarkup`
 * cannot capture.
 */
export function buildAutomationRowMenuItems(
  entry: AutomationOverviewEntry,
  actions: AutomationRowActions,
): AutomationRowMenuItem[] {
  const { automation } = entry;
  return [
    automation.enabled
      ? {
          key: "pause",
          label: "Pause",
          icon: "Pause",
          destructive: false,
          preventClose: false,
          run: () => actions.onPause(entry),
        }
      : {
          key: "resume",
          label: "Resume",
          icon: "Play",
          destructive: false,
          preventClose: false,
          run: () => actions.onResume(entry),
        },
    {
      key: "run",
      label: "Run now",
      icon: "Zap",
      destructive: false,
      preventClose: false,
      run: () => actions.onRun(entry),
    },
    {
      key: "delete",
      label: "Delete",
      icon: "Trash2",
      destructive: true,
      preventClose: true,
      run: () => actions.onDelete(entry),
    },
  ];
}

function AutomationRowActionItems({ entry, actions }: AutomationRowProps) {
  const items = buildAutomationRowMenuItems(entry, actions);
  return (
    <>
      {items.map((item) => (
        <Fragment key={item.key}>
          {item.key === "delete" ? <DropdownMenuSeparator /> : null}
          <DropdownMenuItem
            className={
              item.destructive
                ? "text-destructive focus:text-destructive"
                : undefined
            }
            onSelect={(event) => {
              if (item.preventClose) {
                event.preventDefault();
              }
              item.run();
            }}
          >
            <Icon
              name={item.icon}
              className={cn("size-4", !item.destructive && "text-muted-foreground")}
            />
            {item.label}
          </DropdownMenuItem>
        </Fragment>
      ))}
    </>
  );
}

const RUN_STATUS_META: Record<
  NonNullable<Automation["lastRunStatus"]>,
  { icon: IconName; tone: string; label: string }
> = {
  running: { icon: "Clock", tone: "text-file-accent", label: "Running" },
  succeeded: { icon: "CircleCheck", tone: "text-success", label: "Ran" },
  failed: { icon: "CircleX", tone: "text-destructive", label: "Failed" },
  skipped: { icon: "CircleDashed", tone: "text-muted-foreground", label: "Skipped" },
};

function AutomationRow({ entry, actions }: AutomationRowProps) {
  const { automation } = entry;
  const cadence =
    automation.trigger.triggerType === "schedule"
      ? formatCronCadence(automation.trigger.cron)
      : "Custom trigger";
  const runMeta =
    automation.lastRunStatus !== null
      ? RUN_STATUS_META[automation.lastRunStatus]
      : null;
  // Single status signal: the leading icon reflects the LAST RUN. Paused state
  // is conveyed by the next-run label ("Paused"), not a second status dot.
  const lastRunText = runMeta
    ? automation.lastRunAt !== null
      ? `${runMeta.label} ${formatScheduleRunTime(automation.lastRunAt)}`
      : runMeta.label
    : "Never run";
  return (
    <div className="group flex items-start gap-3 rounded-md px-3 py-2 transition-colors hover:bg-state-hover">
      {runMeta ? (
        <Icon
          name={runMeta.icon}
          aria-hidden
          className={cn("mt-0.5 size-4 shrink-0", runMeta.tone)}
        />
      ) : (
        // Not run yet: fall back to the enabled-state dot — green when the loop
        // is enabled/scheduled, muted when paused.
        <span
          className="mt-0.5 flex size-4 shrink-0 items-center justify-center"
          aria-hidden
        >
          <span
            className={cn(
              "size-1.5 rounded-full",
              automation.enabled ? "bg-success" : "bg-muted-foreground/40",
            )}
          />
        </span>
      )}
      <div className="min-w-0 flex-1">
        <Link
          to={getAutomationDetailRoutePath({
            projectId: automation.projectId,
            automationId: automation.id,
          })}
          className="block truncate text-sm font-medium text-foreground hover:underline"
        >
          {automation.name}
        </Link>
        <div className="mt-0.5 truncate text-xs text-muted-foreground">
          {lastRunText}
        </div>
      </div>
      <div className="w-44 shrink-0 text-right">
        <div className="truncate text-xs text-muted-foreground/80">
          {formatScheduleStatusLabel({
            enabled: automation.enabled,
            nextRunAt: automation.nextRunAt,
          })}
        </div>
        <div
          className="mt-0.5 truncate text-xs text-muted-foreground/50"
          title={cadence}
        >
          {cadence}
        </div>
      </div>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-6 shrink-0 rounded-md p-0 text-muted-foreground data-[state=open]:bg-state-active data-[state=open]:text-foreground"
            aria-label={`${automation.name} actions`}
            title={`${automation.name} actions`}
          >
            <Icon name="MoreHorizontal" className="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          className="w-40"
          mobileTitle={`${automation.name} actions`}
        >
          <AutomationRowActionItems entry={entry} actions={actions} />
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

export function AutomationsOverview({
  entries,
  isLoading,
  hasInitialLoadError,
  actions,
  onCreateAutomation,
}: AutomationsOverviewProps) {
  const groups = groupAutomationsByProject(entries);
  const isEmpty =
    !isLoading && !hasInitialLoadError && entries.length === 0;

  return (
    <PageShell contentClassName="pt-4 md:pt-5">
      <div className="mx-auto w-full max-w-3xl space-y-6">
        <div className="flex items-start justify-between gap-4">
          <p className="max-w-prose text-sm text-muted-foreground">
            Recurring bb agent workflows. A loop runs a full agent thread on a
            schedule or trigger, then reports back like any other thread.
          </p>
          <Button
            type="button"
            variant="default"
            size="sm"
            className="shrink-0"
            onClick={onCreateAutomation}
          >
            <Icon name="Plus" className="size-4" />
            New loop
          </Button>
        </div>
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading...</p>
        ) : hasInitialLoadError ? (
          <p className="text-sm text-destructive">Failed to load loops.</p>
        ) : isEmpty ? (
          <EmptyStatePanel className="py-6">No loops yet.</EmptyStatePanel>
        ) : (
          <div className="space-y-6">
            {groups.map((group) => (
              <section key={group.projectId}>
                <p className="flex items-center gap-1.5 px-3 text-xs font-semibold text-muted-foreground">
                  <Icon
                    name="Folder"
                    className="size-3.5 text-muted-foreground/70"
                    aria-hidden
                  />
                  {group.projectName}
                </p>
                <div className="mt-1 space-y-0.5">
                  {group.entries.map((entry) => (
                    <AutomationRow
                      key={entry.automation.id}
                      entry={entry}
                      actions={actions}
                    />
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}
      </div>
    </PageShell>
  );
}

export function AutomationsView() {
  const automationsQuery = useAutomations();
  const navigate = useNavigate();
  const pauseAutomation = usePauseAutomation();
  const resumeAutomation = useResumeAutomation();
  const runAutomation = useRunAutomation();
  const deleteAutomation = useDeleteAutomation();
  const deleteDialog = useDialogState<AutomationOverviewEntry>();
  const { mutate: pauseMutate } = pauseAutomation;
  const { mutate: resumeMutate } = resumeAutomation;
  const { mutate: runMutate } = runAutomation;
  const { mutate: deleteMutate } = deleteAutomation;
  const { onClose: closeDeleteDialog, onOpen: openDeleteDialog } = deleteDialog;

  const data: AutomationsOverviewResponse | undefined = automationsQuery.data;
  const entries = data?.automations ?? [];
  const hasInitialLoadError =
    automationsQuery.isError && data === undefined;
  const isLoading =
    automationsQuery.isFetching && data === undefined && !hasInitialLoadError;

  const actions: AutomationRowActions = {
    onPause: useCallback(
      (entry: AutomationOverviewEntry) => {
        pauseMutate({
          projectId: entry.automation.projectId,
          automationId: entry.automation.id,
        });
      },
      [pauseMutate],
    ),
    onResume: useCallback(
      (entry: AutomationOverviewEntry) => {
        resumeMutate({
          projectId: entry.automation.projectId,
          automationId: entry.automation.id,
        });
      },
      [resumeMutate],
    ),
    onRun: useCallback(
      (entry: AutomationOverviewEntry) => {
        runMutate({
          projectId: entry.automation.projectId,
          automationId: entry.automation.id,
        });
      },
      [runMutate],
    ),
    onDelete: useCallback(
      (entry: AutomationOverviewEntry) => {
        openDeleteDialog(entry);
      },
      [openDeleteDialog],
    ),
  };

  const confirmDelete = useCallback(() => {
    const entry = deleteDialog.target;
    if (!entry) {
      return;
    }
    deleteMutate(
      {
        projectId: entry.automation.projectId,
        automationId: entry.automation.id,
      },
      { onSuccess: () => closeDeleteDialog() },
    );
  }, [closeDeleteDialog, deleteDialog.target, deleteMutate]);

  const handleCreateAutomation = useCallback(() => {
    navigate(getRootComposeRoutePath(), {
      state: { focusPrompt: true, initialPrompt: CREATE_LOOP_PROMPT },
    });
  }, [navigate]);

  return (
    <>
      <AutomationsOverview
        entries={entries}
        isLoading={isLoading}
        hasInitialLoadError={hasInitialLoadError}
        actions={actions}
        onCreateAutomation={handleCreateAutomation}
      />
      <ConfirmDeleteDialog
        open={deleteDialog.isOpen}
        onOpenChange={deleteDialog.onOpenChange}
      >
        <ConfirmDeleteDialogContent
          title="Delete loop?"
          description={
            deleteDialog.target
              ? `"${deleteDialog.target.automation.name}" and its run history will be permanently removed.`
              : ""
          }
          confirmLabel="Delete"
          pending={deleteAutomation.isPending}
          onConfirm={confirmDelete}
          onCancel={closeDeleteDialog}
        />
      </ConfirmDeleteDialog>
    </>
  );
}

import { Fragment, useCallback, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { PERSONAL_PROJECT_ID } from "@bb/domain";
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
import {
  CreateViaPromptExamples,
  CreateWithTemplatesButton,
} from "@/components/create-via-prompt-examples";
import { EmptyStatePanel } from "@/components/ui/empty-state.js";
import { Skeleton } from "@/components/ui/skeleton.js";
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
  /** Opens the composer to create a loop, optionally seeded with a full prompt. */
  onCreateAutomation: (prompt?: string) => void;
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
          run: () => actions.onPause(entry),
        }
      : {
          key: "resume",
          label: "Resume",
          icon: "Play",
          destructive: false,
          run: () => actions.onResume(entry),
        },
    {
      key: "run",
      label: "Run now",
      icon: "Zap",
      destructive: false,
      run: () => actions.onRun(entry),
    },
    {
      key: "delete",
      label: "Delete",
      icon: "Trash2",
      destructive: true,
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
            onSelect={() => {
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

function AutomationRow({ entry, actions }: AutomationRowProps) {
  const { automation } = entry;
  const cadence =
    automation.trigger.triggerType === "schedule"
      ? formatCronCadence(automation.trigger.cron)
      : "Custom trigger";
  // An overview row answers two questions, not the full run taxonomy (that
  // lives in the detail run history): is it on or paused, and is it healthy or
  // failing. Only a failed last run earns a loud signal; everything else is the
  // quiet enabled/paused dot.
  const failed = automation.lastRunStatus === "failed";
  const lastRunLabel =
    automation.lastRunAt !== null
      ? formatScheduleRunTime(automation.lastRunAt)
      : null;
  const lastRunText = failed
    ? lastRunLabel
      ? `Failed ${lastRunLabel}`
      : "Failed"
    : lastRunLabel
      ? `Last run ${lastRunLabel}`
      : "Never run";
  return (
    <div className="group flex items-start gap-3 rounded-md px-3 py-2 transition-colors hover:bg-state-hover">
      {failed ? (
        <Icon
          name="CircleX"
          aria-hidden
          className="mt-0.5 size-4 shrink-0 text-destructive"
        />
      ) : (
        // On or paused: a single quiet dot, green when enabled/scheduled, muted
        // when paused. No per-run-outcome icons.
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
        <div
          className={cn(
            "mt-0.5 truncate text-xs",
            failed ? "text-destructive" : "text-muted-foreground",
          )}
        >
          {lastRunText}
        </div>
      </div>
      <div className="w-44 shrink-0 text-right">
        <div className="truncate text-xs text-muted-foreground">
          {formatScheduleStatusLabel({
            enabled: automation.enabled,
            nextRunAt: automation.nextRunAt,
          })}
        </div>
        <div
          className="mt-0.5 truncate text-xs text-subtle-foreground"
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
  const [query, setQuery] = useState("");
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const normalizedQuery = query.trim().toLowerCase();
  const filtered =
    normalizedQuery === ""
      ? entries
      : entries.filter((entry) =>
          entry.automation.name.toLowerCase().includes(normalizedQuery),
        );
  const groups = groupAutomationsByProject(filtered);
  const isEmpty =
    !isLoading && !hasInitialLoadError && entries.length === 0;
  const toggleGroup = useCallback((projectId: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(projectId)) {
        next.delete(projectId);
      } else {
        next.add(projectId);
      }
      return next;
    });
  }, []);
  // Personal == projectless in bb: render those loops flat (no header), like the
  // sidebar does for personal threads. Only real projects get a folder header.
  const personalGroup =
    groups.find((group) => group.projectId === PERSONAL_PROJECT_ID) ?? null;
  const projectGroups = groups.filter(
    (group) => group.projectId !== PERSONAL_PROJECT_ID,
  );

  return (
    <PageShell contentClassName="pt-4 md:pt-5" maxWidthClassName="max-w-5xl">
      <div className="space-y-6">
        <div className="flex items-center gap-2">
          <div className="flex h-8 min-w-0 flex-1 items-center gap-1.5 rounded-md border border-input bg-transparent px-2 transition-shadow focus-within:ring-1 focus-within:ring-border">
            <Icon
              name="Search"
              className="size-3.5 shrink-0 text-muted-foreground"
              aria-hidden
            />
            <input
              aria-label="Search loops"
              placeholder="Search loops"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              autoComplete="off"
              className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            />
          </div>
          <CreateWithTemplatesButton
            kind="loop"
            label="New loop"
            onCreate={onCreateAutomation}
          />
        </div>
        {isLoading ? (
          <div className="space-y-0.5" aria-busy aria-label="Loading loops">
            {["w-44", "w-36", "w-52", "w-40", "w-48"].map((nameWidth) => (
              <div key={nameWidth} className="flex items-start gap-2 px-1 py-1.5">
                <Skeleton className="mt-0.5 size-4 shrink-0 rounded-full" />
                <div className="min-w-0 flex-1 space-y-1.5">
                  <Skeleton className={cn("h-3.5", nameWidth)} />
                  <Skeleton className="h-3 w-24" />
                </div>
                <div className="hidden w-44 space-y-1.5 sm:block">
                  <Skeleton className="ml-auto h-3 w-20" />
                  <Skeleton className="ml-auto h-3 w-14" />
                </div>
                <Skeleton className="size-6 shrink-0 rounded-md" />
              </div>
            ))}
          </div>
        ) : hasInitialLoadError ? (
          <p className="text-sm text-destructive">Failed to load loops.</p>
        ) : isEmpty ? (
          <CreateViaPromptExamples kind="loop" onCreate={onCreateAutomation} />
        ) : groups.length === 0 ? (
          <EmptyStatePanel className="py-6">
            {`No loops match "${query}"`}
          </EmptyStatePanel>
        ) : (
          <div className="space-y-4">
            {personalGroup ? (
              <div className="space-y-0.5">
                {personalGroup.entries.map((entry) => (
                  <AutomationRow
                    key={entry.automation.id}
                    entry={entry}
                    actions={actions}
                  />
                ))}
              </div>
            ) : null}
            {projectGroups.map((group) => {
              const isCollapsed = collapsed.has(group.projectId);
              return (
                <section key={group.projectId}>
                  <button
                    type="button"
                    onClick={() => toggleGroup(group.projectId)}
                    aria-expanded={!isCollapsed}
                    className="flex w-full items-center gap-1.5 rounded-md px-3 py-1 text-xs font-semibold text-muted-foreground hover:bg-state-hover"
                  >
                    <Icon
                      name="ChevronRight"
                      className={cn(
                        "size-3 shrink-0 text-muted-foreground transition-transform duration-150",
                        !isCollapsed && "rotate-90",
                      )}
                      aria-hidden
                    />
                    <Icon
                      name="Folder"
                      className="size-3.5 text-muted-foreground"
                      aria-hidden
                    />
                    {group.projectName}
                  </button>
                  {isCollapsed ? null : (
                    <div className="mt-1 space-y-0.5">
                      {group.entries.map((entry) => (
                        <AutomationRow
                          key={entry.automation.id}
                          entry={entry}
                          actions={actions}
                        />
                      ))}
                    </div>
                  )}
                </section>
              );
            })}
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

  const handleCreateAutomation = useCallback(
    (prompt?: string) => {
      navigate(getRootComposeRoutePath(), {
        state: {
          focusPrompt: true,
          initialPrompt: prompt ?? CREATE_LOOP_PROMPT,
          createDraftKind: "loop",
        },
      });
    },
    [navigate],
  );

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

import { useCallback, useState } from "react";
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
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip.js";
import {
  CreateViaPromptExamples,
  CreateWithTemplatesButton,
} from "@/components/create-via-prompt-examples";
import { EmptyStatePanel } from "@/components/ui/empty-state.js";
import { Skeleton } from "@/components/ui/skeleton.js";
import { Icon, type IconName } from "@/components/ui/icon.js";
import { CREATE_LOOP_PROMPT } from "@/lib/loop-prompt";
import { useDialogState } from "@/hooks/useDialogState";
import {
  useAutomations,
  useDeleteAutomation,
  useRunAutomation,
} from "@/hooks/queries/automation-queries";
import {
  formatAutomationTrigger,
  formatCronCadence,
} from "@/lib/format-schedule";
import {
  getAutomationDetailRoutePath,
  getRootComposeRoutePath,
} from "@/lib/route-paths";
import { cn } from "@/lib/utils";
import { AutomationDetailPane } from "./AutomationDetailPane.js";

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
  /** Open the detail pane for a loop (plain row-name click). */
  onOpen: (entry: AutomationOverviewEntry) => void;
  /** Open the detail pane straight into edit mode. */
  onEdit: (entry: AutomationOverviewEntry) => void;
  onRun: (entry: AutomationOverviewEntry) => void;
  onDelete: (entry: AutomationOverviewEntry) => void;
}

interface AutomationRowProps {
  entry: AutomationOverviewEntry;
  actions: AutomationRowActions;
  /** Highlight this row as the one open in the docked detail pane. */
  selected?: boolean;
}

export interface AutomationsOverviewProps {
  entries: readonly AutomationOverviewEntry[];
  isLoading: boolean;
  hasInitialLoadError: boolean;
  actions: AutomationRowActions;
  /** Opens the composer to create a loop, optionally seeded with a full prompt. */
  onCreateAutomation: (prompt?: string) => void;
  /** Refetch after a load failure — gives the error state a way out. */
  onRetry?: () => void;
  /** Id of the loop open in the docked pane, so its row shows as selected. */
  selectedId?: string | null;
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
        (a, b) => Number(b.automation.enabled) - Number(a.automation.enabled),
      ),
    };
  });
}

export interface AutomationRowAction {
  key: "run" | "edit" | "delete";
  /** Tooltip + accessible name. */
  label: string;
  icon: IconName;
  destructive: boolean;
  run: () => void;
}

/**
 * Pure description of a row's hover actions, rendered as direct icon buttons
 * (no overflow menu): Run, Edit, Delete. Pause/resume lives in the detail
 * pane. Exported so tests assert the action set + wiring without mounting.
 */
export function buildAutomationRowActions(
  entry: AutomationOverviewEntry,
  actions: AutomationRowActions,
): AutomationRowAction[] {
  return [
    {
      key: "run",
      label: "Run now",
      icon: "Play",
      destructive: false,
      run: () => actions.onRun(entry),
    },
    {
      key: "edit",
      label: "Edit",
      icon: "Edit",
      destructive: false,
      run: () => actions.onEdit(entry),
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

/** The hover action cluster: direct icon buttons with tooltips, no menu. */
function AutomationRowActionButtons({ entry, actions }: AutomationRowProps) {
  const rowActions = buildAutomationRowActions(entry, actions);
  return (
    <TooltipProvider delayDuration={300}>
      <div
        data-row-action
        className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100"
      >
        {rowActions.map((action) => (
          <Tooltip key={action.key}>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className={cn(
                  "size-6 shrink-0 rounded-md p-0 text-muted-foreground",
                  action.destructive
                    ? "hover:text-destructive"
                    : "hover:text-foreground",
                )}
                aria-label={`${action.label}: ${entry.automation.name}`}
                onClick={action.run}
              >
                <Icon name={action.icon} className="size-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{action.label}</TooltipContent>
          </Tooltip>
        ))}
      </div>
    </TooltipProvider>
  );
}

function AutomationRow({ entry, actions, selected }: AutomationRowProps) {
  const { automation } = entry;
  const cadence =
    automation.trigger.triggerType === "schedule"
      ? formatCronCadence(automation.trigger.cron)
      : formatAutomationTrigger(automation.trigger);
  // Two lines: name, then schedule. The left slot carries the last-run status —
  // a failed run shows a red ✕, a healthy/successful one is blank. Paused reads
  // as the dimmed row. Actions live on the right, revealed on hover.
  const failed = automation.lastRunStatus === "failed";
  return (
    <div
      onClick={(event) => {
        // The whole row opens the detail pane. Skip modified clicks (new tab via
        // the name link) and clicks on the name link / action buttons, which
        // handle their own behavior.
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
          return;
        }
        if ((event.target as HTMLElement).closest("a, [data-row-action]")) {
          return;
        }
        actions.onOpen(entry);
      }}
      className={cn(
        "group flex cursor-pointer items-center gap-3 rounded-md px-3 py-2 transition-colors hover:bg-state-hover",
        selected && "bg-state-active",
        !automation.enabled && "opacity-60",
      )}
    >
      {failed ? (
        <Icon
          name="CircleX"
          aria-label="Last run failed"
          className="size-4 shrink-0 text-destructive"
        />
      ) : (
        <span className="size-4 shrink-0" aria-hidden />
      )}
      <div className="min-w-0 flex-1">
        <Link
          to={getAutomationDetailRoutePath({
            projectId: automation.projectId,
            automationId: automation.id,
          })}
          onClick={(event) => {
            // Plain click opens the detail pane in place; modified clicks (open
            // in new tab/window) fall through to the deep-link route.
            if (
              event.metaKey ||
              event.ctrlKey ||
              event.shiftKey ||
              event.altKey
            ) {
              return;
            }
            event.preventDefault();
            actions.onOpen(entry);
          }}
          className="block truncate text-sm font-medium text-foreground hover:underline"
        >
          {automation.name}
        </Link>
        <div
          className="mt-0.5 truncate text-xs text-subtle-foreground"
          title={cadence}
        >
          {cadence}
        </div>
      </div>
      <AutomationRowActionButtons entry={entry} actions={actions} />
    </div>
  );
}

export function AutomationsOverview({
  entries,
  isLoading,
  hasInitialLoadError,
  actions,
  onCreateAutomation,
  onRetry,
  selectedId,
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
  const isEmpty = !isLoading && !hasInitialLoadError && entries.length === 0;
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
    <div className="h-full min-h-0 overflow-y-auto">
      <div className="mx-auto w-full max-w-5xl px-4 pb-4 pt-4 md:px-5 md:pt-5">
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
                <div
                  key={nameWidth}
                  className="flex items-start gap-2 px-1 py-1.5"
                >
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
            // Failure is direction, not a dead end: say what happened plainly and
            // offer the way out, kept calm rather than alarmist.
            <EmptyStatePanel role="alert" className="py-6">
              <div className="flex flex-col items-center gap-2">
                <span>Couldn't load loops.</span>
                {onRetry ? (
                  <Button variant="outline" size="sm" onClick={onRetry}>
                    Retry
                  </Button>
                ) : null}
              </div>
            </EmptyStatePanel>
          ) : isEmpty ? (
            <CreateViaPromptExamples
              kind="loop"
              onCreate={onCreateAutomation}
            />
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
                      selected={entry.automation.id === selectedId}
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
                            selected={entry.automation.id === selectedId}
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
      </div>
    </div>
  );
}

export function AutomationsView() {
  const automationsQuery = useAutomations();
  const navigate = useNavigate();
  const runAutomation = useRunAutomation();
  const deleteAutomation = useDeleteAutomation();
  const deleteDialog = useDialogState<AutomationOverviewEntry>();
  const { mutate: runMutate } = runAutomation;
  const { mutate: deleteMutate } = deleteAutomation;
  const { onClose: closeDeleteDialog, onOpen: openDeleteDialog } = deleteDialog;

  // Docked detail pane: selecting a row opens the detail inline beside the list.
  // The pane is mounted only while a loop is selected.
  const [detailEntry, setDetailEntry] =
    useState<AutomationOverviewEntry | null>(null);
  // Bumped on every open so the pane's detail content remounts fresh when
  // switching to another loop.
  const [detailSession, setDetailSession] = useState(0);
  const openDetail = useCallback((entry: AutomationOverviewEntry) => {
    setDetailEntry(entry);
    setDetailSession((session) => session + 1);
  }, []);
  const closeDetail = useCallback(() => setDetailEntry(null), []);
  // Editing is a full-page task: navigate to the detail route with an edit
  // intent so it opens straight into the roomy inline form.
  const openEditor = useCallback(
    (entry: AutomationOverviewEntry) => {
      navigate(
        getAutomationDetailRoutePath({
          projectId: entry.automation.projectId,
          automationId: entry.automation.id,
        }),
        { state: { edit: true } },
      );
    },
    [navigate],
  );

  const data: AutomationsOverviewResponse | undefined = automationsQuery.data;
  const entries = data?.automations ?? [];
  const hasInitialLoadError = automationsQuery.isError && data === undefined;
  const isLoading =
    automationsQuery.isFetching && data === undefined && !hasInitialLoadError;

  const actions: AutomationRowActions = {
    onOpen: useCallback(
      (entry: AutomationOverviewEntry) => openDetail(entry),
      [openDetail],
    ),
    onEdit: useCallback(
      (entry: AutomationOverviewEntry) => openEditor(entry),
      [openEditor],
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
    <div className="-mx-4 -mb-4 -mt-4 flex min-h-0 min-w-0 flex-1 overflow-hidden md:-mx-5 md:-mb-5 md:-mt-5">
      <div className="min-w-0 flex-1">
        <AutomationsOverview
          entries={entries}
          isLoading={isLoading}
          hasInitialLoadError={hasInitialLoadError}
          actions={actions}
          onCreateAutomation={handleCreateAutomation}
          onRetry={() => void automationsQuery.refetch()}
          selectedId={detailEntry?.automation.id ?? null}
        />
      </div>
      {detailEntry ? (
        <AutomationDetailPane
          automation={detailEntry.automation}
          sessionKey={detailSession}
          onEdit={() => openEditor(detailEntry)}
          onClose={closeDetail}
        />
      ) : null}
      <ConfirmDeleteDialog
        open={deleteDialog.isOpen}
        onOpenChange={deleteDialog.onOpenChange}
      >
        <ConfirmDeleteDialogContent
          title="Delete loop?"
          description={
            deleteDialog.target
              ? `"${deleteDialog.target.automation.name}" and its run history will be permanently removed. This can't be undone.`
              : ""
          }
          confirmLabel="Delete"
          pending={deleteAutomation.isPending}
          onConfirm={confirmDelete}
          onCancel={closeDeleteDialog}
        />
      </ConfirmDeleteDialog>
    </div>
  );
}

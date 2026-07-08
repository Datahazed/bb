// bb-plugin-automations — the frontend bundle.
//
// A single navPanel "Automations" that replaces the kernel's Automations
// views. The panel root lists every automation across projects (rpc
// automations.overview); the detail subPath (/:projectId/:automationId)
// shows one automation's full config plus its cursor-paginated run history.
// Realtime "automations" signals refetch in place. Creation/editing is
// deliberately absent — parity with the kernel, where automations are made
// via the CLI or by agents.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import {
  definePluginApp,
  useBbNavigate,
  useRealtime,
  useRpc,
  type PluginNavPanelProps,
} from "@bb/plugin-sdk/app";
import { toast } from "sonner";
import type {
  AutomationExecution,
  AutomationResponse,
  AutomationRunListResponse,
  AutomationRunResponse,
  AutomationsOverviewResponse,
} from "@/src/rpc-types";
import { Button } from "@bb/shared-ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@bb/shared-ui/dialog";
import { EmptyStatePanel } from "@bb/shared-ui/empty-state";
import { Icon, type IconName } from "@bb/shared-ui/icon";
import {
  ResourceActionButton,
  ResourceBrowseCard,
  ResourceCreateButton,
  ResourceDetailPage,
  ResourceMeta,
  ResourceOptionMenu,
  ResourceOverflowMenu,
  ResourceProperty,
  ResourcePropertyList,
  ResourceRow,
  ResourceSortMenu,
  ResourceSourceItem,
  ResourceSourceShelf,
  ResourceStatus,
  ResourceToolbar,
  type ResourceStatusTone,
} from "@bb/shared-ui/resource-list";
import { Switch } from "@bb/shared-ui/switch";
import { cn } from "@bb/shared-ui/lib/utils";
import {
  formatAutomationTrigger,
  formatScheduleRunTime,
  formatScheduleStatusLabel,
  isCompletedOneShotAutomation,
} from "@/lib/format-schedule";

const PANEL_PATH = "automations";
const PERSONAL_PROJECT_ID = "proj_personal";

// Prefill text for the "Create via chat" entry point — an agent turns this
// into a real automation. Inlined here so the plugin bundle stays
// self-contained.
const CREATE_AUTOMATION_PROMPT = "Create a new bb automation to ";
const AUTOMATION_CREATE_TEMPLATES = [
  {
    label: "CI failure triage",
    description:
      "runs every weekday morning, checks failed main-branch CI, and opens fixer threads only for new failures",
    prompt: `${CREATE_AUTOMATION_PROMPT}runs every weekday morning, checks failed main-branch CI, and opens fixer threads only for new failures.`,
  },
  {
    label: "Dependency drift",
    description:
      "checks weekly for stale dependencies and opens an update thread when risk is low",
    prompt: `${CREATE_AUTOMATION_PROMPT}checks weekly for stale dependencies and opens an update thread when risk is low.`,
  },
  {
    label: "Release readiness",
    description:
      "checks the release branch hourly, summarizes blocking checks, and alerts only when the status changes",
    prompt: `${CREATE_AUTOMATION_PROMPT}checks the release branch hourly, summarizes blocking checks, and alerts only when the status changes.`,
  },
] as const;

type OverviewEntry = AutomationsOverviewResponse["automations"][number];
type AutomationLocationFilter =
  | "all"
  | `project:${string}`
  | `folder:${string}`;
type AutomationSortMode = "location" | "alpha";
type AutomationSortDirection = "asc" | "desc";

// ---------------------------------------------------------------------------
// rpc boundary — the backend validates every response with zod, so the wire
// shape is trusted; narrow with a single cast at the call site.
// ---------------------------------------------------------------------------

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// ---------------------------------------------------------------------------
// Sub-routing: the panel owns /plugins/automations/automations/*. The root
// ("") is the overview; "<projectId>/<automationId>" is the detail view.
// ---------------------------------------------------------------------------

interface DetailRoute {
  projectId: string;
  automationId: string;
}

function parseSubPath(subPath: string): DetailRoute | null {
  const parts = subPath.split("/").filter((p) => p.length > 0);
  if (parts.length === 2) {
    return { projectId: parts[0], automationId: parts[1] };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Data hooks. Each refetches on the "automations" realtime channel; the
// payload carries { projectId, kind } — mirror the kernel cache-effects and
// refetch on the relevant kind.
// ---------------------------------------------------------------------------

interface AutomationSignal {
  projectId: string;
  kind: "automations-changed" | "automation-runs-changed";
}

function asSignal(payload: unknown): AutomationSignal | null {
  if (payload === null || typeof payload !== "object") return null;
  const record = payload as { projectId?: unknown; kind?: unknown };
  if (
    typeof record.projectId !== "string" ||
    (record.kind !== "automations-changed" &&
      record.kind !== "automation-runs-changed")
  ) {
    return null;
  }
  return { projectId: record.projectId, kind: record.kind };
}

function useOverview(): {
  entries: OverviewEntry[] | null;
  error: string | null;
} {
  const rpc = useRpc();
  const [state, setState] = useState<{
    entries: OverviewEntry[] | null;
    error: string | null;
  }>({ entries: null, error: null });
  const refetchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refetch = useCallback(() => {
    rpc.call("automations_overview").then(
      (result) => {
        const data = result as AutomationsOverviewResponse;
        setState({ entries: data.automations, error: null });
      },
      (error: unknown) => setState({ entries: null, error: errorText(error) }),
    );
  }, [rpc]);

  useEffect(() => {
    refetch();
  }, [refetch]);
  useEffect(
    () => () => {
      if (refetchTimerRef.current !== null) {
        clearTimeout(refetchTimerRef.current);
      }
    },
    [],
  );
  const scheduleRefetch = useCallback(() => {
    if (refetchTimerRef.current !== null) return;
    refetchTimerRef.current = setTimeout(() => {
      refetchTimerRef.current = null;
      refetch();
    }, 75);
  }, [refetch]);
  // Any create/update/pause/resume/run/delete or run-completion touches the
  // overview (rows show last-run status), so refetch on either kind.
  useRealtime("automations", (payload) => {
    if (asSignal(payload) !== null) scheduleRefetch();
  });
  return state;
}

function useAutomation(route: DetailRoute): {
  automation: AutomationResponse | null;
  error: string | null;
  missing: boolean;
} {
  const rpc = useRpc();
  const { projectId, automationId } = route;
  const [state, setState] = useState<{
    automation: AutomationResponse | null;
    error: string | null;
    missing: boolean;
  }>({ automation: null, error: null, missing: false });

  const refetch = useCallback(() => {
    rpc.call("automations_get", { projectId, automationId }).then(
      (result) => {
        const automation = result as AutomationResponse | null;
        setState({
          automation: automation ?? null,
          error: null,
          missing: automation === null,
        });
      },
      (error: unknown) =>
        setState({ automation: null, error: errorText(error), missing: false }),
    );
  }, [rpc, projectId, automationId]);

  useEffect(() => {
    setState({ automation: null, error: null, missing: false });
    refetch();
  }, [refetch]);
  useRealtime("automations", (payload) => {
    const signal = asSignal(payload);
    if (signal !== null && signal.projectId === projectId) refetch();
  });
  return state;
}

interface RunsState {
  runs: AutomationRunResponse[];
  nextCursor: string | null;
  loading: boolean;
  loadingMore: boolean;
  error: string | null;
}

function useRuns(route: DetailRoute): RunsState & { loadMore: () => void } {
  const rpc = useRpc();
  const { projectId, automationId } = route;
  const [state, setState] = useState<RunsState>({
    runs: [],
    nextCursor: null,
    loading: true,
    loadingMore: false,
    error: null,
  });
  // Guard concurrent loadMore + refetch races: only the latest first-page
  // load is allowed to replace the list.
  const requestRef = useRef(0);
  const loadMoreInFlightRef = useRef(false);

  const loadFirstPage = useCallback(() => {
    const requestId = ++requestRef.current;
    setState((prev) => ({ ...prev, loading: true, error: null }));
    rpc.call("automations_runs", { projectId, automationId }).then(
      (result) => {
        if (requestRef.current !== requestId) return;
        const page = result as AutomationRunListResponse;
        setState({
          runs: page.runs,
          nextCursor: page.nextCursor,
          loading: false,
          loadingMore: false,
          error: null,
        });
      },
      (error: unknown) => {
        if (requestRef.current !== requestId) return;
        setState({
          runs: [],
          nextCursor: null,
          loading: false,
          loadingMore: false,
          error: errorText(error),
        });
      },
    );
  }, [rpc, projectId, automationId]);

  const loadMore = useCallback(() => {
    if (
      state.nextCursor === null ||
      state.loadingMore ||
      loadMoreInFlightRef.current
    ) {
      return;
    }
    const cursor = state.nextCursor;
    const requestId = requestRef.current;
    loadMoreInFlightRef.current = true;
    setState((prev) => ({ ...prev, loadingMore: true }));
    rpc
      .call("automations_runs", { projectId, automationId, cursor })
      .then(
        (result) => {
          if (requestRef.current !== requestId) return;
          const page = result as AutomationRunListResponse;
          setState((current) => ({
            ...current,
            runs: [...current.runs, ...page.runs],
            nextCursor: page.nextCursor,
            loadingMore: false,
          }));
        },
        (error: unknown) => {
          if (requestRef.current !== requestId) return;
          toast.error(errorText(error));
          setState((current) => ({ ...current, loadingMore: false }));
        },
      )
      .finally(() => {
        loadMoreInFlightRef.current = false;
      });
  }, [rpc, projectId, automationId, state.nextCursor, state.loadingMore]);

  useEffect(() => {
    loadFirstPage();
  }, [loadFirstPage]);
  // A completed/started run (automation-runs-changed) for this project
  // refreshes the first page in place.
  useRealtime("automations", (payload) => {
    const signal = asSignal(payload);
    if (
      signal !== null &&
      signal.kind === "automation-runs-changed" &&
      signal.projectId === projectId
    ) {
      loadFirstPage();
    }
  });
  return { ...state, loadMore };
}

// ---------------------------------------------------------------------------
// Mutations — pause/resume/run/delete all take { projectId, automationId }.
// ---------------------------------------------------------------------------

function useMutations() {
  const rpc = useRpc();
  const call = useCallback(
    (method: string, route: DetailRoute) => rpc.call(method, route),
    [rpc],
  );
  return {
    pause: (route: DetailRoute) => call("automations_pause", route),
    resume: (route: DetailRoute) => call("automations_resume", route),
    run: (route: DetailRoute) => call("automations_run", route),
    delete: (route: DetailRoute) => call("automations_delete", route),
  };
}

function routeOf(automation: AutomationResponse): DetailRoute {
  return { projectId: automation.projectId, automationId: automation.id };
}

// ---------------------------------------------------------------------------
// Formatting helpers (run history) — ported from the kernel detail view.
// ---------------------------------------------------------------------------

function formatRunTimestamp(timestamp: number): string {
  return formatScheduleRunTime(timestamp);
}

function formatRunDuration(run: AutomationRunResponse): string | null {
  if (run.finishedAt === null) return null;
  const seconds = (run.finishedAt - run.startedAt) / 1000;
  if (seconds < 0) return null;
  return `${seconds.toFixed(seconds < 10 ? 1 : 0)}s`;
}

/** A succeeded script run that produced no surfaced output reads as "silent". */
function isSilentRun(run: AutomationRunResponse): boolean {
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

function getRunStatusLabel(run: AutomationRunResponse): RunStatusLabel {
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

function describeExecution(execution: AutomationExecution): string {
  if (execution.mode === "agent") {
    return `Agent · ${execution.providerId}/${execution.model} · ${execution.permissionMode}`;
  }
  const interpreter = execution.interpreter ?? "bash";
  const target = execution.scriptFile ?? "inline script";
  const timeoutSeconds = Math.round(execution.timeoutMs / 1000);
  return `Script · ${interpreter} ${target} · ${timeoutSeconds}s timeout`;
}

function describeEnvironment(execution: AutomationExecution): string | null {
  if (execution.mode !== "agent") return null;
  const environment = execution.environment;
  switch (environment.type) {
    case "reuse":
      return "Reuses an existing environment";
    case "project-default":
      return "Project default environment";
    case "host":
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
    default: {
      const _exhaustive: never = environment;
      return _exhaustive;
    }
  }
}

// ---------------------------------------------------------------------------
// Shared bits.
// ---------------------------------------------------------------------------

function automationIconName(automation: AutomationResponse): IconName {
  return automation.execution.mode === "script"
    ? "ComputerTerminal01"
    : "Calendar";
}

function automationStatus(automation: AutomationResponse): {
  label: string;
  tone: ResourceStatusTone;
} {
  if (
    isCompletedOneShotAutomation({
      enabled: automation.enabled,
      trigger: automation.trigger,
      runCount: automation.runCount,
    })
  ) {
    return { label: "Completed", tone: "muted" };
  }
  return automation.enabled
    ? { label: "Active", tone: "success" }
    : { label: "Paused", tone: "muted" };
}

function automationScheduleLabel(automation: AutomationResponse): string {
  return formatScheduleStatusLabel({
    enabled: automation.enabled,
    nextRunAt: automation.nextRunAt,
    trigger: automation.trigger,
    runCount: automation.runCount,
  });
}

function automationOriginLabel(automation: AutomationResponse): string {
  switch (automation.origin) {
    case "agent":
      return "Agent-created";
    case "app":
      return "App-created";
    case "human":
      return "Human-created";
    default: {
      const _exhaustive: never = automation.origin;
      return _exhaustive;
    }
  }
}

function automationProjectLabel(project: OverviewEntry["project"]): string {
  return project.id === PERSONAL_PROJECT_ID ? "Personal" : project.name;
}

function automationLocationLabel(entry: OverviewEntry): string {
  const projectLabel = automationProjectLabel(entry.project);
  return entry.folder === null
    ? projectLabel
    : `${projectLabel} / ${entry.folder.name}`;
}

function automationLocationFilterId(
  entry: OverviewEntry,
): AutomationLocationFilter {
  return entry.folder === null
    ? `project:${entry.project.id}`
    : `folder:${entry.project.id}/${entry.folder.id}`;
}

function applyAutomationSortDirection(
  result: number,
  direction: AutomationSortDirection,
): number {
  return direction === "asc" ? result : -result;
}

/**
 * Confirm-before-delete dialog, controlled by the caller. Uses the responsive
 * Dialog — a centered modal on desktop, a bottom drawer on compact viewports —
 * matching the kernel's ConfirmDeleteDialog pattern. Kept mounted until the
 * mutation resolves so the pending state stays visible.
 */
function DeleteAutomationDialog({
  open,
  onOpenChange,
  name,
  pending,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  name: string;
  pending: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        {open ? (
          <>
            <DialogHeader>
              <DialogTitle>Delete automation?</DialogTitle>
              <DialogDescription>
                &ldquo;{name}&rdquo; and its run history will be permanently
                removed.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                disabled={pending}
                onClick={onCancel}
              >
                Cancel
              </Button>
              <Button
                type="button"
                variant="destructive"
                disabled={pending}
                onClick={onConfirm}
              >
                Delete
              </Button>
            </DialogFooter>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// List view (panel root): the cross-project overview.
// ---------------------------------------------------------------------------

function OverviewRow({
  entry,
  onNavigate,
  onAction,
  onDelete,
}: {
  entry: OverviewEntry;
  onNavigate: (route: DetailRoute) => void;
  onAction: (method: "pause" | "resume" | "run", route: DetailRoute) => void;
  onDelete: (entry: OverviewEntry) => void;
}) {
  const { automation } = entry;
  const route = routeOf(automation);
  const completedOneShot = isCompletedOneShotAutomation({
    enabled: automation.enabled,
    trigger: automation.trigger,
    runCount: automation.runCount,
  });
  const status = automationStatus(automation);
  const description = `${formatAutomationTrigger(
    automation.trigger,
  )} · ${automationLocationLabel(entry)}`;

  return (
    <ResourceRow
      leading={
        <Icon
          name={automationIconName(automation)}
          className="size-4 shrink-0 text-muted-foreground"
          aria-hidden
        />
      }
      title={automation.name}
      description={description}
      status={
        <ResourceStatus tone={status.tone}>{status.label}</ResourceStatus>
      }
      muted={completedOneShot}
      onOpen={() => onNavigate(route)}
      actions={
        <>
          <ResourceActionButton
            label="Run now"
            icon="Play"
            disabled={completedOneShot}
            onClick={() => onAction("run", route)}
          />
          <ResourceActionButton
            label="Edit"
            icon="Edit"
            onClick={() => onNavigate(route)}
          />
          <ResourceActionButton
            label="Delete"
            icon="Trash2"
            tone="destructive"
            onClick={() => onDelete(entry)}
          />
        </>
      }
    />
  );
}

function AutomationTemplateCard({
  template,
  onCreate,
}: {
  template: (typeof AUTOMATION_CREATE_TEMPLATES)[number];
  onCreate: (prompt?: string) => void;
}) {
  return (
    <ResourceBrowseCard
      leading={
        <Icon
          name="TimeSchedule"
          className="size-5 text-muted-foreground"
          aria-hidden
        />
      }
      title={template.label}
      meta="Starter template"
      description={template.description}
      tags={["bb automation", "schedule", "template"]}
      action={
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-7 px-2 text-xs"
          onClick={() => onCreate(template.prompt)}
        >
          Use template
        </Button>
      }
      onOpen={() => onCreate(template.prompt)}
    />
  );
}

function AutomationBrowseShelf({
  onCreate,
  onBrowseAll,
}: {
  onCreate: (prompt?: string) => void;
  onBrowseAll: () => void;
}) {
  return (
    <ResourceSourceShelf
      label="Browse automations"
      count={AUTOMATION_CREATE_TEMPLATES.length}
      leading={
        <Icon
          name="TimeSchedule"
          className="size-3.5 shrink-0 text-muted-foreground"
          aria-hidden
        />
      }
      action={
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-6 gap-1 px-2"
          onClick={onBrowseAll}
        >
          Browse all
          <Icon name="ChevronRight" className="size-3.5" aria-hidden />
        </Button>
      }
    >
      {AUTOMATION_CREATE_TEMPLATES.map((template) => (
        <ResourceSourceItem key={template.label}>
          <AutomationTemplateCard template={template} onCreate={onCreate} />
        </ResourceSourceItem>
      ))}
    </ResourceSourceShelf>
  );
}

function AutomationBrowsePage({
  onCreate,
}: {
  onCreate: (prompt?: string) => void;
}) {
  const [query, setQuery] = useState("");
  const normalizedQuery = query.trim().toLowerCase();
  const visibleTemplates = AUTOMATION_CREATE_TEMPLATES.filter((template) =>
    [template.label, template.description]
      .join(" ")
      .toLowerCase()
      .includes(normalizedQuery),
  );

  return (
    <div className="mx-auto w-full max-w-3xl space-y-4">
      <ResourceToolbar
        searchValue={query}
        searchPlaceholder="Search automation templates"
        onSearchChange={setQuery}
        action={
          <ResourceCreateButton
            label="New automation"
            templates={AUTOMATION_CREATE_TEMPLATES}
            onCreate={onCreate}
          />
        }
      />
      {visibleTemplates.length === 0 ? (
        <EmptyStatePanel className="py-6">
          No automation templates match "{query}".
        </EmptyStatePanel>
      ) : (
        <div className="grid gap-2 sm:grid-cols-2">
          {visibleTemplates.map((template) => (
            <AutomationTemplateCard
              key={template.label}
              template={template}
              onCreate={onCreate}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function OverviewView({
  onOpenDetail,
  onBrowseAll,
}: {
  onOpenDetail: (route: DetailRoute) => void;
  onBrowseAll: () => void;
}) {
  const navigate = useBbNavigate();
  const { entries, error } = useOverview();
  const mutations = useMutations();
  const [query, setQuery] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<OverviewEntry | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [locationFilter, setLocationFilter] =
    useState<AutomationLocationFilter>("all");
  const [sortMode, setSortMode] = useState<AutomationSortMode>("alpha");
  const [sortDirection, setSortDirection] =
    useState<AutomationSortDirection>("asc");

  const runAction = useCallback(
    (method: "pause" | "resume" | "run", route: DetailRoute) => {
      const label =
        method === "run" ? "run" : method === "pause" ? "pause" : "resume";
      mutations[method](route).then(
        () => {
          if (method === "run") toast.success("Run started");
        },
        (rpcError: unknown) =>
          toast.error(`Failed to ${label} automation: ${errorText(rpcError)}`),
      );
    },
    [mutations],
  );

  const confirmDelete = useCallback(() => {
    if (deleteTarget === null) return;
    setDeleting(true);
    mutations
      .delete(routeOf(deleteTarget.automation))
      .then(
        () => {
          toast.success("Automation deleted");
          setDeleteTarget(null);
        },
        (rpcError: unknown) =>
          toast.error(`Failed to delete automation: ${errorText(rpcError)}`),
      )
      .finally(() => setDeleting(false));
  }, [deleteTarget, mutations]);

  const createViaChat = useCallback(
    (prompt?: string) => {
      navigate.toCompose({
        focusPrompt: true,
        initialPrompt: prompt ?? CREATE_AUTOMATION_PROMPT,
      });
    },
    [navigate],
  );

  const normalizedQuery = query.trim().toLowerCase();
  const locationCounts = useMemo(() => {
    const counts = new Map<AutomationLocationFilter, number>();
    for (const entry of entries ?? []) {
      const location = automationLocationFilterId(entry);
      counts.set(location, (counts.get(location) ?? 0) + 1);
    }
    return counts;
  }, [entries]);
  const locationBucketCount = locationCounts.size;
  const locationOptions = useMemo(() => {
    const options = new Map<AutomationLocationFilter, string>([
      ["all", "All locations"],
    ]);
    for (const entry of entries ?? []) {
      options.set(
        automationLocationFilterId(entry),
        automationLocationLabel(entry),
      );
    }
    return [...options].map(([id, label]) => ({ id, label }));
  }, [entries]);
  useEffect(() => {
    if (locationFilter === "all") return;
    if (!locationCounts.has(locationFilter)) {
      setLocationFilter("all");
    }
  }, [locationCounts, locationFilter]);
  useEffect(() => {
    if (sortMode === "location" && locationBucketCount <= 1) {
      setSortMode("alpha");
      setSortDirection("asc");
    }
  }, [locationBucketCount, sortMode]);
  const filteredEntries = useMemo(() => {
    if (entries === null) return [];
    return entries.filter((entry) => {
      const { automation, folder, project } = entry;
      if (
        locationFilter !== "all" &&
        automationLocationFilterId(entry) !== locationFilter
      ) {
        return false;
      }
      if (normalizedQuery.length === 0) return true;
      const status = automationStatus(automation).label;
      return [
        automation.name,
        project.name,
        folder?.name,
        status,
        automationScheduleLabel(automation),
        formatAutomationTrigger(automation.trigger),
      ].some((value) => value?.toLowerCase().includes(normalizedQuery));
    });
  }, [entries, locationFilter, normalizedQuery]);
  const visibleEntries = useMemo(() => {
    return [...filteredEntries].sort((left, right) => {
      const base =
        sortMode === "location"
          ? automationLocationLabel(left).localeCompare(
              automationLocationLabel(right),
            ) || left.automation.name.localeCompare(right.automation.name)
          : left.automation.name.localeCompare(right.automation.name);
      return applyAutomationSortDirection(base, sortDirection);
    });
  }, [filteredEntries, sortDirection, sortMode]);
  const handleSortChange = useCallback(
    (nextSort: string) => {
      if (nextSort !== "location" && nextSort !== "alpha") return;
      if (nextSort === "location" && locationBucketCount <= 1) return;
      if (nextSort === sortMode) {
        setSortDirection((current) => (current === "asc" ? "desc" : "asc"));
        return;
      }
      setSortMode(nextSort);
      setSortDirection("asc");
    },
    [locationBucketCount, sortMode],
  );

  let body: ReactNode;
  if (error !== null) {
    body = (
      <p className="text-sm text-destructive">Failed to load automations.</p>
    );
  } else if (entries === null) {
    body = <p className="text-sm text-muted-foreground">Loading...</p>;
  } else if (entries.length === 0) {
    body = (
      <EmptyStatePanel className="py-6">No automations yet.</EmptyStatePanel>
    );
  } else if (visibleEntries.length === 0) {
    body = (
      <EmptyStatePanel className="py-6">
        {normalizedQuery === ""
          ? "No automations match this location."
          : `No automations match "${query}"`}
      </EmptyStatePanel>
    );
  } else {
    body = (
      <div className="space-y-0.5">
        {visibleEntries.map((entry) => (
          <OverviewRow
            key={entry.automation.id}
            entry={entry}
            onNavigate={onOpenDetail}
            onAction={runAction}
            onDelete={setDeleteTarget}
          />
        ))}
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-3xl space-y-6">
      <ResourceToolbar
        searchValue={query}
        searchPlaceholder="Search automations"
        onSearchChange={setQuery}
        controls={
          <>
            <ResourceOptionMenu
              label="Location"
              icon="Folder"
              value={locationFilter}
              options={locationOptions}
              onChange={(value) =>
                setLocationFilter(value as AutomationLocationFilter)
              }
            />
            <ResourceSortMenu
              value={sortMode}
              direction={sortDirection}
              options={[
                {
                  id: "location",
                  label: "Project / folder",
                  disabled: locationBucketCount <= 1,
                },
                { id: "alpha", label: "Alphabetical" },
              ]}
              onChange={handleSortChange}
            />
          </>
        }
        action={
          <ResourceCreateButton
            label="New automation"
            templates={AUTOMATION_CREATE_TEMPLATES}
            onCreate={createViaChat}
          />
        }
      />
      <AutomationBrowseShelf
        onCreate={createViaChat}
        onBrowseAll={onBrowseAll}
      />
      {body}
      <DeleteAutomationDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
        name={deleteTarget?.automation.name ?? ""}
        pending={deleting}
        onConfirm={confirmDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Detail view: one automation's config, actions, and run history.
// ---------------------------------------------------------------------------

function RunRow({
  run,
  onOpenThread,
}: {
  run: AutomationRunResponse;
  onOpenThread: (threadId: string) => void;
}) {
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
        <p className="mx-3 mb-2 rounded-md border border-border bg-surface-recessed px-3 py-2 text-xs text-muted-foreground">
          {run.skipReason}
        </p>
      ) : null}
      {showOutput ? (
        <pre
          className={cn(
            "mx-3 mb-3 whitespace-pre-wrap rounded-md border border-border bg-surface-recessed px-3 py-2 font-mono text-xs leading-relaxed",
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

function DetailView({
  route,
  onBack,
}: {
  route: DetailRoute;
  onBack: () => void;
}) {
  const navigate = useBbNavigate();
  const { automation, error, missing } = useAutomation(route);
  const runsState = useRuns(route);
  const mutations = useMutations();
  const [actionPending, setActionPending] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const openThread = useCallback(
    (threadId: string) => navigate.toThread(threadId),
    [navigate],
  );

  const runAction = useCallback(
    (method: "pause" | "resume" | "run") => {
      setActionPending(true);
      mutations[method](route)
        .then(
          () => {
            if (method === "run") toast.success("Run started");
          },
          (rpcError: unknown) =>
            toast.error(
              `Failed to ${method} automation: ${errorText(rpcError)}`,
            ),
        )
        .finally(() => setActionPending(false));
    },
    [mutations, route],
  );

  const confirmDelete = useCallback(() => {
    setDeleting(true);
    mutations
      .delete(route)
      .then(
        () => {
          toast.success("Automation deleted");
          setDeleteOpen(false);
          onBack();
        },
        (rpcError: unknown) =>
          toast.error(`Failed to delete automation: ${errorText(rpcError)}`),
      )
      .finally(() => setDeleting(false));
  }, [mutations, route, onBack]);

  if (error !== null || missing) {
    return (
      <div className="mx-auto w-full max-w-3xl">
        <p className="text-sm text-destructive">
          {missing ? "Automation not found." : "Failed to load automation."}
        </p>
      </div>
    );
  }

  if (automation === null) {
    return (
      <div className="mx-auto w-full max-w-3xl">
        <p className="text-sm text-muted-foreground">Loading...</p>
      </div>
    );
  }

  const completedOneShot = isCompletedOneShotAutomation({
    enabled: automation.enabled,
    trigger: automation.trigger,
    runCount: automation.runCount,
  });
  const environmentLabel = describeEnvironment(automation.execution);
  const status = automationStatus(automation);

  return (
    <ResourceDetailPage
      leading={
        <Icon
          name={automationIconName(automation)}
          className="size-4 shrink-0 text-muted-foreground"
          aria-hidden
        />
      }
      title={automation.name}
      status={
        <ResourceStatus tone={status.tone}>{status.label}</ResourceStatus>
      }
      headerActions={
        <>
          <Switch
            checked={automation.enabled}
            disabled={actionPending || completedOneShot}
            aria-label={
              automation.enabled ? "Pause automation" : "Resume automation"
            }
            onCheckedChange={(checked) =>
              runAction(checked ? "resume" : "pause")
            }
          />
          <ResourceOverflowMenu
            label={`${automation.name} actions`}
            disabled={actionPending}
            items={[
              {
                label: "Run now",
                icon: "ArrowReloadHorizontal",
                onSelect: () => runAction("run"),
              },
              { kind: "separator" },
              {
                label: "Delete",
                icon: "Trash2",
                tone: "destructive",
                onSelect: () => setDeleteOpen(true),
              },
            ]}
          />
        </>
      }
      meta={
        <ResourceMeta
          items={[
            "Automation",
            automation.execution.mode === "script" ? "Script" : "Agent",
            automationScheduleLabel(automation),
          ]}
        />
      }
    >
      <section className="space-y-2">
        <p className="text-xs font-medium uppercase text-muted-foreground">
          Configuration
        </p>
        <ResourcePropertyList>
          <ResourceProperty label="Schedule">
            {formatAutomationTrigger(automation.trigger)}
          </ResourceProperty>
          <ResourceProperty label="Execution">
            {describeExecution(automation.execution)}
          </ResourceProperty>
          <ResourceProperty label="Origin">
            {automationOriginLabel(automation)}
          </ResourceProperty>
          {environmentLabel ? (
            <ResourceProperty label="Environment">
              {environmentLabel}
            </ResourceProperty>
          ) : null}
          {automation.execution.mode === "agent" ? (
            <ResourceProperty label="Prompt">
              <span className="whitespace-pre-wrap">
                {automation.execution.prompt}
              </span>
            </ResourceProperty>
          ) : automation.execution.script ? (
            <ResourceProperty label="Script">
              <pre className="whitespace-pre-wrap font-mono text-xs leading-relaxed">
                {automation.execution.script}
              </pre>
            </ResourceProperty>
          ) : automation.execution.scriptFile ? (
            <ResourceProperty label="Script file">
              {automation.execution.scriptFile}
            </ResourceProperty>
          ) : null}
        </ResourcePropertyList>
      </section>

      <section className="space-y-2">
        <p className="text-xs font-medium uppercase text-muted-foreground">
          Run history
        </p>
        {runsState.error !== null ? (
          <p className="text-sm text-destructive">Failed to load runs.</p>
        ) : runsState.loading ? (
          <p className="text-sm text-muted-foreground">Loading...</p>
        ) : runsState.runs.length === 0 ? (
          <EmptyStatePanel className="py-6">No runs yet.</EmptyStatePanel>
        ) : (
          <div className="space-y-2">
            {runsState.runs.map((run) => (
              <RunRow key={run.id} run={run} onOpenThread={openThread} />
            ))}
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
      </section>

      <DeleteAutomationDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        name={automation.name}
        pending={deleting}
        onConfirm={confirmDelete}
        onCancel={() => setDeleteOpen(false)}
      />
    </ResourceDetailPage>
  );
}

// ---------------------------------------------------------------------------
// Panel root — routes between overview and detail by subPath.
// ---------------------------------------------------------------------------

function AutomationsPanel({ subPath }: PluginNavPanelProps) {
  const navigate = useBbNavigate();
  const route = useMemo(() => parseSubPath(subPath), [subPath]);
  const createViaChat = useCallback(
    (prompt?: string) => {
      navigate.toCompose({
        focusPrompt: true,
        initialPrompt: prompt ?? CREATE_AUTOMATION_PROMPT,
      });
    },
    [navigate],
  );

  const openDetail = useCallback(
    (next: DetailRoute) => {
      navigate.toPluginPanel(PANEL_PATH, {
        subPath: `${next.projectId}/${next.automationId}`,
      });
    },
    [navigate],
  );
  const backToList = useCallback(() => {
    navigate.toPluginPanel(PANEL_PATH, { subPath: "" });
  }, [navigate]);
  const openBrowse = useCallback(() => {
    navigate.toPluginPanel(PANEL_PATH, { subPath: "browse" });
  }, [navigate]);

  if (subPath === "browse") {
    return <AutomationBrowsePage onCreate={createViaChat} />;
  }
  if (route !== null) {
    return <DetailView route={route} onBack={backToList} />;
  }
  return <OverviewView onOpenDetail={openDetail} onBrowseAll={openBrowse} />;
}

export default definePluginApp((app) => {
  app.slots.navPanel({
    id: "automations",
    title: "Automations",
    icon: "TimeSchedule",
    path: PANEL_PATH,
    component: AutomationsPanel,
  });
});

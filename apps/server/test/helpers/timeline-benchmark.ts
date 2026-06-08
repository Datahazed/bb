import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createConnection,
  createEnvironment,
  createProject,
  createThread,
  deriveStoredEventItemFields,
  insertEvents,
  listContextWindowUsageRows,
  listRecentStoredEventRows,
  migrate,
  noopNotifier,
  type StoredEventRow,
} from "@bb/db";
import {
  buildThreadTimelineFromEvents,
  compactThreadTimelineSummaryEvents,
  EMPTY_CLIENT_TURN_REQUEST_SETTLEMENT_CONTEXT,
  THREAD_TIMELINE_EXCLUDED_EVENT_TYPES,
  type ThreadEventWithMeta,
} from "@bb/thread-view";
import { replayFixtures } from "@bb/agent-fixtures";
import { buildThreadEvent } from "@bb/domain";
import {
  buildThreadTimeline,
  toThreadEventWithMeta,
} from "../../src/services/threads/timeline.js";

interface TimelineBenchmarkFixture {
  corpusId: string;
  providerId: string;
  taskId: string;
}

export interface TimelineBenchmarkScenario {
  id: string;
  eventCount: number;
  summaryEventCount: number;
  summaryBytes: number;
  fullBytes: number;
  buildSummary: () => ReturnType<typeof buildThreadTimeline>;
  buildAndSerializeSummary: () => string;
  loadSummaryStoredRows: () => StoredEventRow[];
  loadContextWindowUsageRows: () => StoredEventRow[];
  compactSummaryEvents: () => ThreadEventWithMeta[];
  decodeStoredEvents: () => ThreadEventWithMeta[];
  buildSummaryRowsOnly: () => ReturnType<typeof buildThreadTimeline>["rows"];
}

const FIXTURE_ROOT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../../packages/agent-fixtures/fixtures",
);

const TIMELINE_BENCHMARK_FIXTURES: TimelineBenchmarkFixture[] = [
  {
    corpusId: "excalidraw",
    providerId: "codex",
    taskId: "collab-startup-explanation",
  },
  {
    corpusId: "excalidraw",
    providerId: "codex",
    taskId: "magicframe-feature",
  },
  {
    corpusId: "excalidraw",
    providerId: "pi",
    taskId: "command-palette-map",
  },
];

let cachedScenarios: TimelineBenchmarkScenario[] | null = null;

function createTimelineBenchmarkScenario(
  fixture: TimelineBenchmarkFixture,
): TimelineBenchmarkScenario {
  const replay = replayFixtures({
    fixtureRoot: FIXTURE_ROOT,
    corpusId: fixture.corpusId,
    providerId: fixture.providerId,
    taskId: fixture.taskId,
  }).fixtures[0];

  if (!replay) {
    throw new Error(
      `Missing agent fixture ${fixture.corpusId}/${fixture.providerId}/${fixture.taskId}`,
    );
  }

  const db = createConnection(":memory:");
  migrate(db);

  const host = { id: "local" };
  const { project } = createProject(db, noopNotifier, {
    name: `Timeline Bench ${fixture.taskId}`,
    source: {
      type: "local_path",
      hostId: host.id,
      path: `/tmp/${fixture.taskId}`,
    },
  });
  const environment = createEnvironment(db, noopNotifier, {
    projectId: project.id,
    hostId: host.id,
    path: `/tmp/${fixture.taskId}`,
    status: "ready",
    managed: false,
    isGitRepo: true,
    isWorktree: false,
    workspaceProvisionType: "unmanaged",
    branchName: "main",
    defaultBranch: "main",
  });
  const thread = createThread(db, noopNotifier, {
    projectId: project.id,
    environmentId: environment.id,
    providerId: fixture.providerId,
    status: "idle",
    type: "standard",
    title: fixture.taskId,
    titleFallback: fixture.taskId,
    parentThreadId: null,
  });

  insertEvents(
    db,
    noopNotifier,
    replay.bundle.threadEventRows.map((row) => ({
      threadId: thread.id,
      environmentId: environment.id,
      scope: row.scope,
      providerThreadId:
        "providerThreadId" in row && typeof row.providerThreadId === "string"
          ? row.providerThreadId
          : null,
      sequence: row.seq,
      type: row.type,
      ...deriveStoredEventItemFields(buildThreadEvent(row)),
      data: JSON.stringify(row.data),
    })),
  );
  const storedEventRows = listRecentStoredEventRows(db, {
    threadId: thread.id,
    excludedTypes: THREAD_TIMELINE_EXCLUDED_EVENT_TYPES,
  });
  const decodeStoredEvents = () =>
    storedEventRows.map((row) => toThreadEventWithMeta(row));
  const compactSummaryEvents = () =>
    compactThreadTimelineSummaryEvents(decodeStoredEvents());
  const decodedSummaryEvents = compactSummaryEvents();
  const timelineViewMode =
    thread.type === "manager" ? "manager-conversation" : "standard";
  const buildSummary = () =>
    buildThreadTimeline(db, thread, {
      isDevelopment: true,
      page: {
        kind: "latest",
        segmentLimit: Number.MAX_SAFE_INTEGER,
      },
      timelineViewMode,
    });

  const buildAndSerializeSummary = () => JSON.stringify(buildSummary());
  const loadSummaryStoredRows = () =>
    listRecentStoredEventRows(db, {
      threadId: thread.id,
      excludedTypes: THREAD_TIMELINE_EXCLUDED_EVENT_TYPES,
    });
  const loadContextWindowUsageRows = () =>
    listContextWindowUsageRows(db, {
      threadId: thread.id,
    });
  const buildFullSummaryRowsOnly = () =>
    buildThreadTimelineFromEvents({
      acceptedClientRequestContext: EMPTY_CLIENT_TURN_REQUEST_SETTLEMENT_CONTEXT,
      contextWindowEvents: [],
      events: decodedSummaryEvents,
      options:
        timelineViewMode === "manager-conversation"
          ? {
              includeDebugRawEvents: false,
              includeProviderUnhandledOperations: false,
              isLatestPage: true,
              systemClientRequestVisibility: "hidden",
              threadStatus: thread.status,
              viewMode: timelineViewMode,
              workspaceRoot: null,
            }
          : {
              includeDebugRawEvents: false,
              includeNestedRows: true,
              includeProviderUnhandledOperations: false,
              isLatestPage: true,
              systemClientRequestVisibility: "hidden",
              threadStatus: thread.status,
              turnMessageDetail: "full",
              viewMode: timelineViewMode,
              workspaceRoot: null,
            },
    }).rows;
  const buildSummaryRowsOnly = () =>
    buildThreadTimelineFromEvents({
      acceptedClientRequestContext: EMPTY_CLIENT_TURN_REQUEST_SETTLEMENT_CONTEXT,
      contextWindowEvents: [],
      events: decodedSummaryEvents,
      options:
        timelineViewMode === "manager-conversation"
          ? {
              includeDebugRawEvents: false,
              includeProviderUnhandledOperations: false,
              isLatestPage: true,
              systemClientRequestVisibility: "hidden",
              threadStatus: thread.status,
              viewMode: timelineViewMode,
              workspaceRoot: null,
            }
          : {
              includeDebugRawEvents: false,
              includeNestedRows: false,
              includeProviderUnhandledOperations: false,
              isLatestPage: true,
              systemClientRequestVisibility: "hidden",
              threadStatus: thread.status,
              turnMessageDetail: "summary",
              viewMode: timelineViewMode,
              workspaceRoot: null,
            },
    }).rows;
  const summaryBytes = Buffer.byteLength(buildAndSerializeSummary(), "utf8");
  const fullBytes = Buffer.byteLength(
    JSON.stringify({
      ...buildSummary(),
      rows: buildFullSummaryRowsOnly(),
    }),
    "utf8",
  );

  return {
    id: `${fixture.corpusId}/${fixture.providerId}/${fixture.taskId}`,
    eventCount: replay.bundle.threadEventRows.length,
    summaryEventCount: decodedSummaryEvents.length,
    summaryBytes,
    fullBytes,
    buildSummary,
    buildAndSerializeSummary,
    loadSummaryStoredRows,
    loadContextWindowUsageRows,
    compactSummaryEvents,
    decodeStoredEvents,
    buildSummaryRowsOnly,
  };
}

export function getTimelineBenchmarkScenarios(): TimelineBenchmarkScenario[] {
  if (cachedScenarios) {
    return cachedScenarios;
  }

  cachedScenarios = TIMELINE_BENCHMARK_FIXTURES.map((fixture) =>
    createTimelineBenchmarkScenario(fixture),
  );
  return cachedScenarios;
}

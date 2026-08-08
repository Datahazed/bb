import {
  getPersonalProject,
  listProjectExecutionDefaultsByProjectIds,
  listProjectSourcesByProjectIds,
  listPublicProjects,
  listThreadSections,
  listThreadsWithPendingInteractionState,
  listThreadsWithPendingInteractionStateForProjects,
  type DbConnection,
} from "@bb/db";
import { threadListEntrySchema, type ThreadListEntry } from "@bb/domain";
import type {
  ProjectResponse,
  ProjectWithThreadsResponse,
  SidebarBootstrapResponse,
} from "@bb/server-contract";
import { resolveCreateThreadExecutionDefaults } from "../threads/thread-default-policy.js";
import { toThreadListEntryResponses } from "../threads/thread-runtime-display.js";
import type {
  DatabaseReadWorkerRequest,
  DatabaseReadWorkerResult,
} from "./database-read-worker-contract.js";

interface DatabaseReadOperationDeps {
  db: DbConnection;
}

type ProjectResponseRow = Omit<ProjectResponse, "sources">;

interface ThreadEntryResult {
  droppedEntryCount: number;
  entries: ThreadListEntry[];
}

interface ProjectsWithThreadsResult {
  droppedEntryCount: number;
  projects: ProjectWithThreadsResponse[];
}

function isThreadListEntry(value: unknown): value is ThreadListEntry {
  return threadListEntrySchema.safeParse(value).success;
}

function toProjectResponses(
  db: DbConnection,
  projects: ProjectResponseRow[],
): ProjectResponse[] {
  const sourcesByProjectId = new Map<string, ProjectResponse["sources"]>();
  for (const source of listProjectSourcesByProjectIds(
    db,
    projects.map((project) => project.id),
  )) {
    const sources = sourcesByProjectId.get(source.projectId);
    if (sources !== undefined) {
      sources.push(source);
    } else {
      sourcesByProjectId.set(source.projectId, [source]);
    }
  }
  return projects.map((project) => ({
    id: project.id,
    kind: project.kind,
    name: project.name,
    gitRemoteUrl: project.gitRemoteUrl,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
    sources: sourcesByProjectId.get(project.id) ?? [],
  }));
}

function toThreadEntries(
  deps: DatabaseReadOperationDeps,
  request: DatabaseReadWorkerRequest,
  threads: Parameters<typeof toThreadListEntryResponses>[1]["threads"],
): ThreadEntryResult {
  const daemonSessionIdByHostId = new Map(
    request.daemonSessions.map((session) => [
      session.hostId,
      session.sessionId,
    ]),
  );
  const rawEntries = toThreadListEntryResponses(
    {
      db: deps.db,
      hub: {
        getDaemonSessionIdForHost(hostId): string | null {
          return daemonSessionIdByHostId.get(hostId) ?? null;
        },
      },
    },
    { threads },
  );
  const entries = rawEntries.filter(isThreadListEntry);
  return {
    droppedEntryCount: rawEntries.length - entries.length,
    entries,
  };
}

function toProjectsWithThreads(
  deps: DatabaseReadOperationDeps,
  request: DatabaseReadWorkerRequest,
  projectRows: ProjectResponseRow[],
): ProjectsWithThreadsResult {
  const projects = toProjectResponses(deps.db, projectRows);
  const projectIds = projects.map((project) => project.id);
  const threadResult = toThreadEntries(
    deps,
    request,
    listThreadsWithPendingInteractionStateForProjects(deps.db, {
      archived: false,
      projectIds,
    }),
  );
  const threadsByProjectId = new Map<
    string,
    ProjectWithThreadsResponse["threads"]
  >();
  for (const thread of threadResult.entries) {
    const threads = threadsByProjectId.get(thread.projectId);
    if (threads !== undefined) {
      threads.push(thread);
    } else {
      threadsByProjectId.set(thread.projectId, [thread]);
    }
  }
  const defaultsByProjectId = listProjectExecutionDefaultsByProjectIds(
    deps.db,
    { projectIds },
  );
  return {
    droppedEntryCount: threadResult.droppedEntryCount,
    projects: projects.map((project) => ({
      ...project,
      threads: threadsByProjectId.get(project.id) ?? [],
      defaultExecutionOptions: resolveCreateThreadExecutionDefaults({
        storedDefaults: defaultsByProjectId.get(project.id) ?? null,
      }).executionDefaults,
    })),
  };
}

function requirePersonalProject(db: DbConnection): ProjectResponseRow {
  const project = getPersonalProject(db);
  if (project === null) {
    throw new Error("Personal project is not initialized");
  }
  return project;
}

export function executeDatabaseReadOperation(
  deps: DatabaseReadOperationDeps,
  request: DatabaseReadWorkerRequest,
): DatabaseReadWorkerResult {
  return deps.db.$client
    .transaction(() => {
      switch (request.operation) {
        case "listThreadEntries":
          return {
            ...toThreadEntries(
              deps,
              request,
              listThreadsWithPendingInteractionState(deps.db, request.options),
            ),
            operation: request.operation,
          };
        case "listThreadEntriesForProjects":
          return {
            ...toThreadEntries(
              deps,
              request,
              listThreadsWithPendingInteractionStateForProjects(
                deps.db,
                request.options,
              ),
            ),
            operation: request.operation,
          };
        case "listProjectsWithThreads": {
          const projectRows: ProjectResponseRow[] = listPublicProjects(deps.db);
          if (request.options.includePersonal) {
            projectRows.unshift(requirePersonalProject(deps.db));
          }
          const result = toProjectsWithThreads(deps, request, projectRows);
          return {
            ...result,
            operation: request.operation,
          };
        }
        case "sidebarBootstrap": {
          const result = toProjectsWithThreads(deps, request, [
            requirePersonalProject(deps.db),
            ...listPublicProjects(deps.db),
          ]);
          const [personalProject, ...projects] = result.projects;
          if (personalProject === undefined) {
            throw new Error("Personal project response was not built");
          }
          const response: SidebarBootstrapResponse = {
            sections: listThreadSections(deps.db),
            projects,
            personalProject,
          };
          return {
            droppedEntryCount: result.droppedEntryCount,
            operation: request.operation,
            response,
          };
        }
      }
    })
    .deferred();
}

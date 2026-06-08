import { and, asc, desc, eq, isNotNull, isNull } from "drizzle-orm";
import { PERSONAL_PROJECT_ID } from "@bb/domain";
import type { DbConnection, DbQueryConnection, DbTransaction } from "../connection.js";
import type { DbNotifier } from "../notifier.js";
import { projects, projectSources } from "../schema.js";
import { createProjectId, createProjectSourceId } from "../ids.js";
import { toProjectSource } from "./project-sources.js";
import { createOrderKeyAfter, createOrderKeyBetween } from "./order-keys.js";

export interface CreateProjectLocalPathSourceInput {
  type: "local_path";
  hostId: string;
  path: string;
}

export type CreateProjectSourceInput = CreateProjectLocalPathSourceInput;

export interface CreateProjectInput {
  name: string;
  source: CreateProjectSourceInput;
}

export type ProjectRow = typeof projects.$inferSelect;

export interface ReorderProjectArgs {
  db: DbConnection;
  nextProjectId: string | null;
  notifier: DbNotifier;
  previousProjectId: string | null;
  projectId: string;
}

interface ResolveProjectNeighborArgs {
  movedProjectId: string;
  neighborProjectId: string | null;
}

export interface ReorderProjectSuccess {
  kind: "reordered";
  projects: ProjectRow[];
}

export interface ReorderProjectUnchanged {
  kind: "unchanged";
  projects: ProjectRow[];
}

export interface ReorderProjectNotFound {
  kind: "not_found";
}

export interface ReorderProjectStaleNeighbor {
  kind: "stale_neighbor";
}

export interface ReorderProjectInvalidNeighborOrder {
  kind: "invalid_neighbor_order";
}

export type ReorderProjectResult =
  | ReorderProjectSuccess
  | ReorderProjectUnchanged
  | ReorderProjectNotFound
  | ReorderProjectStaleNeighbor
  | ReorderProjectInvalidNeighborOrder;

function publicProjectFilter() {
  return and(
    eq(projects.kind, "standard"),
    isNull(projects.deleteRequestedAt),
  );
}

function listOrderedPublicProjects(db: DbQueryConnection): ProjectRow[] {
  return db
    .select()
    .from(projects)
    .where(publicProjectFilter())
    .orderBy(asc(projects.sortKey), asc(projects.id))
    .all();
}

function getLastPublicProject(db: DbQueryConnection): ProjectRow | null {
  return (
    db
      .select()
      .from(projects)
      .where(publicProjectFilter())
      .orderBy(desc(projects.sortKey), desc(projects.id))
      .limit(1)
      .get() ?? null
  );
}

function getPublicProjectForMutation(
  db: DbQueryConnection,
  id: string,
): ProjectRow | null {
  return (
    db
      .select()
      .from(projects)
      .where(and(eq(projects.id, id), publicProjectFilter()))
      .get() ?? null
  );
}

function resolveProjectNeighbor(
  db: DbQueryConnection,
  args: ResolveProjectNeighborArgs,
): ProjectRow | null | false {
  if (args.neighborProjectId === null) {
    return null;
  }
  if (args.neighborProjectId === args.movedProjectId) {
    return false;
  }

  return getPublicProjectForMutation(db, args.neighborProjectId) ?? false;
}

export function createProject(
  db: DbConnection,
  notifier: DbNotifier,
  input: CreateProjectInput,
) {
  const now = Date.now();
  const projectId = createProjectId();
  const sourceId = createProjectSourceId();

  const { project, source } = db.transaction((tx) => {
    const lastProject = getLastPublicProject(tx);
    const sortKey = lastProject
      ? createOrderKeyAfter({ previousKey: lastProject.sortKey })
      : createOrderKeyBetween({ previousKey: null, nextKey: null });
    const p = tx
      .insert(projects)
      .values({
        id: projectId,
        name: input.name,
        sortKey,
        createdAt: now,
        updatedAt: now,
      })
      .returning()
      .get();
    const s = tx
      .insert(projectSources)
      .values({
        id: sourceId,
        projectId,
        type: input.source.type,
        hostId: input.source.hostId,
        path: input.source.path,
        isDefault: true,
        createdAt: now,
        updatedAt: now,
      })
      .returning()
      .get();
    return { project: p, source: s };
  });

  notifier.notifyProject(projectId, ["project-created"]);
  notifier.notifyProject(projectId, ["project-sources-changed"]);
  return { project, source: toProjectSource(source) };
}

export function getProject(db: DbConnection, id: string) {
  return db.select().from(projects).where(eq(projects.id, id)).get() ?? null;
}

export interface MarkProjectDeleteRequestedArgs {
  projectId: string;
  requestedAt?: number;
}

/** Stamps durable deletion intent (idempotent; the first stamp wins). */
export function markProjectDeleteRequested(
  db: DbConnection | DbTransaction,
  args: MarkProjectDeleteRequestedArgs,
): void {
  db.update(projects)
    .set({
      deleteRequestedAt: args.requestedAt ?? Date.now(),
      updatedAt: Date.now(),
    })
    .where(
      and(eq(projects.id, args.projectId), isNull(projects.deleteRequestedAt)),
    )
    .run();
}

export function listProjectIdsWithDeleteRequested(
  db: DbConnection,
): string[] {
  return db
    .select({ id: projects.id })
    .from(projects)
    .where(isNotNull(projects.deleteRequestedAt))
    .all()
    .map((row) => row.id);
}

export function getPersonalProject(db: DbConnection) {
  return (
    db
      .select()
      .from(projects)
      .where(and(eq(projects.id, PERSONAL_PROJECT_ID), eq(projects.kind, "personal")))
      .get() ?? null
  );
}

export function ensurePersonalProject(db: DbConnection) {
  const now = Date.now();
  db
    .insert(projects)
    .values({
      id: PERSONAL_PROJECT_ID,
      kind: "personal",
      name: "Personal",
      sortKey: "V",
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoNothing()
    .run();

  const project = getPersonalProject(db);
  if (!project) {
    throw new Error("Personal project row was not created");
  }
  return project;
}

export function listProjects(db: DbConnection) {
  return db
    .select()
    .from(projects)
    .orderBy(asc(projects.sortKey), asc(projects.id))
    .all();
}

export function listPublicProjects(db: DbConnection) {
  return listOrderedPublicProjects(db);
}

export interface UpdateProjectInput {
  name?: string;
}

export function updateProject(
  db: DbConnection,
  notifier: DbNotifier,
  id: string,
  input: UpdateProjectInput,
) {
  const now = Date.now();
  const updated = db
    .update(projects)
    .set({ ...input, updatedAt: now })
    .where(eq(projects.id, id))
    .returning()
    .get();
  if (updated) {
    notifier.notifyProject(id, ["project-updated"]);
  }
  return updated ?? null;
}

export function reorderProject({
  db,
  nextProjectId,
  notifier,
  previousProjectId,
  projectId,
}: ReorderProjectArgs): ReorderProjectResult {
  const result = db.transaction(
    (tx): ReorderProjectResult => {
      const movedProject = getPublicProjectForMutation(tx, projectId);
      if (!movedProject) {
        return { kind: "not_found" };
      }

      const previousProject = resolveProjectNeighbor(tx, {
        movedProjectId: projectId,
        neighborProjectId: previousProjectId,
      });
      const nextProject = resolveProjectNeighbor(tx, {
        movedProjectId: projectId,
        neighborProjectId: nextProjectId,
      });
      if (previousProject === false || nextProject === false) {
        return { kind: "stale_neighbor" };
      }
      if (
        previousProject !== null &&
        nextProject !== null &&
        previousProject.sortKey >= nextProject.sortKey
      ) {
        return { kind: "invalid_neighbor_order" };
      }

      const currentProjects = listOrderedPublicProjects(tx);
      const currentIndex = currentProjects.findIndex(
        (project) => project.id === projectId,
      );
      const currentPreviousProjectId =
        currentProjects[currentIndex - 1]?.id ?? null;
      const currentNextProjectId = currentProjects[currentIndex + 1]?.id ?? null;
      if (
        currentPreviousProjectId === previousProjectId &&
        currentNextProjectId === nextProjectId
      ) {
        return {
          kind: "unchanged",
          projects: currentProjects,
        };
      }

      const sortKey = createOrderKeyBetween({
        previousKey: previousProject?.sortKey ?? null,
        nextKey: nextProject?.sortKey ?? null,
      });
      const updated = tx
        .update(projects)
        .set({ sortKey, updatedAt: Date.now() })
        .where(eq(projects.id, projectId))
        .returning({ id: projects.id })
        .get();
      if (!updated) {
        return { kind: "stale_neighbor" };
      }

      return {
        kind: "reordered",
        projects: listOrderedPublicProjects(tx),
      };
    },
    { behavior: "immediate" },
  );

  if (result.kind === "reordered") {
    notifier.notifyProject(projectId, ["project-order-changed"]);
  }
  return result;
}

export function deleteProject(
  db: DbConnection,
  notifier: DbNotifier,
  id: string,
) {
  const existing = db.select().from(projects).where(eq(projects.id, id)).get();
  if (!existing) return false;
  db.delete(projects).where(eq(projects.id, id)).run();
  notifier.notifyProject(id, ["project-deleted"]);
  return true;
}

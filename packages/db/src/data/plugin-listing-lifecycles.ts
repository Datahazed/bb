import { and, eq, isNull, ne } from "drizzle-orm";
import { nanoid } from "nanoid";
import {
  PluginListingDraftConflictError,
  pluginListingLifecycleSchema,
  pluginListingNoticeSchema,
  transitionPluginListingClosedUnmerged,
  transitionPluginListingDraftSave,
  transitionPluginListingPublication,
  transitionPluginListingSubmission,
  type PluginListingDraftEntry,
  type PluginListingLifecycle,
  type PluginListingNotice,
} from "@bb/domain";
import type { DbConnection } from "../connection.js";
import { installedPlugins, pluginListingLifecycles } from "../schema.js";

export { PluginListingDraftConflictError };

export interface PluginListingLifecycleRow {
  pluginId: string;
  lifecycle: PluginListingLifecycle;
}

function parseStoredJson(json: string, description: string): unknown {
  try {
    return JSON.parse(json) as unknown;
  } catch (error) {
    throw new Error(`invalid persisted ${description} JSON`, { cause: error });
  }
}

function parseLifecycle(json: string): PluginListingLifecycle {
  const parsed = pluginListingLifecycleSchema.safeParse(
    parseStoredJson(json, "plugin listing lifecycle"),
  );
  if (!parsed.success) {
    throw new Error(
      `invalid persisted plugin listing lifecycle: ${parsed.error.message}`,
      { cause: parsed.error },
    );
  }
  return parsed.data;
}

function parseNotice(json: string): PluginListingNotice {
  const parsed = pluginListingNoticeSchema.safeParse(
    parseStoredJson(json, "plugin listing notice"),
  );
  if (!parsed.success) {
    throw new Error(
      `invalid persisted plugin listing notice: ${parsed.error.message}`,
      { cause: parsed.error },
    );
  }
  return parsed.data;
}

function currentNotice(
  db: DbConnection,
  pluginId: string,
): PluginListingNotice | null {
  const row = db
    .select({
      kind: pluginListingLifecycles.noticeKind,
      json: pluginListingLifecycles.noticeJson,
    })
    .from(pluginListingLifecycles)
    .where(eq(pluginListingLifecycles.pluginId, pluginId))
    .get();
  return row === undefined || row.kind === "none"
    ? null
    : parseNotice(row.json);
}

function write(
  db: DbConnection,
  pluginId: string,
  lifecycle: PluginListingLifecycle,
  notice: PluginListingNotice | null,
): void {
  const now = Date.now();
  db.insert(pluginListingLifecycles)
    .values({
      pluginId,
      status: lifecycle.status,
      lifecycleJson: JSON.stringify(lifecycle),
      noticeKind: notice?.kind ?? "none",
      noticeId: notice?.id ?? "",
      noticeJson: JSON.stringify(notice ?? { kind: "none" }),
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: pluginListingLifecycles.pluginId,
      set: {
        status: lifecycle.status,
        lifecycleJson: JSON.stringify(lifecycle),
        noticeKind: notice?.kind ?? "none",
        noticeId: notice?.id ?? "",
        noticeJson: JSON.stringify(notice ?? { kind: "none" }),
        updatedAt: now,
      },
    })
    .run();
}

export function ensurePathPluginListingLifecycles(db: DbConnection): void {
  const pathPluginIds = db
    .select({ id: installedPlugins.id })
    .from(installedPlugins)
    .leftJoin(
      pluginListingLifecycles,
      eq(pluginListingLifecycles.pluginId, installedPlugins.id),
    )
    .where(
      and(
        eq(installedPlugins.sourceKind, "path"),
        isNull(installedPlugins.removedAt),
        isNull(pluginListingLifecycles.pluginId),
      ),
    )
    .all();
  for (const { id } of pathPluginIds) {
    write(db, id, { status: "not-published" }, null);
  }
}

export function listPathPluginListingLifecycles(
  db: DbConnection,
): PluginListingLifecycleRow[] {
  return db
    .select({
      pluginId: pluginListingLifecycles.pluginId,
      lifecycleJson: pluginListingLifecycles.lifecycleJson,
    })
    .from(pluginListingLifecycles)
    .innerJoin(
      installedPlugins,
      eq(installedPlugins.id, pluginListingLifecycles.pluginId),
    )
    .where(
      and(
        eq(installedPlugins.sourceKind, "path"),
        isNull(installedPlugins.removedAt),
      ),
    )
    .all()
    .map((row) => ({
      pluginId: row.pluginId,
      lifecycle: parseLifecycle(row.lifecycleJson),
    }));
}

export function listInReviewPluginListingLifecycles(
  db: DbConnection,
): PluginListingLifecycleRow[] {
  return db
    .select({
      pluginId: pluginListingLifecycles.pluginId,
      lifecycleJson: pluginListingLifecycles.lifecycleJson,
    })
    .from(pluginListingLifecycles)
    .where(eq(pluginListingLifecycles.status, "in-review"))
    .all()
    .map((row) => ({
      pluginId: row.pluginId,
      lifecycle: parseLifecycle(row.lifecycleJson),
    }));
}

export function getPluginListingLifecycle(
  db: DbConnection,
  pluginId: string,
): PluginListingLifecycle | undefined {
  const row = db
    .select({ json: pluginListingLifecycles.lifecycleJson })
    .from(pluginListingLifecycles)
    .where(eq(pluginListingLifecycles.pluginId, pluginId))
    .get();
  return row === undefined ? undefined : parseLifecycle(row.json);
}

export function savePluginListingDraft(
  db: DbConnection,
  pluginId: string,
  entry: PluginListingDraftEntry,
): PluginListingLifecycle {
  const current = getPluginListingLifecycle(db, pluginId);
  const lifecycle = transitionPluginListingDraftSave({
    current,
    pluginId,
    entry,
  });
  write(db, pluginId, lifecycle, currentNotice(db, pluginId));
  return lifecycle;
}

export function recordPluginListingSubmission(
  db: DbConnection,
  pluginId: string,
  pullRequest: { url: string; openedAt: number },
): PluginListingLifecycle {
  const current = getPluginListingLifecycle(db, pluginId);
  const lifecycle = transitionPluginListingSubmission({
    current,
    pluginId,
    pullRequest,
  });
  write(db, pluginId, lifecycle, currentNotice(db, pluginId));
  return lifecycle;
}

export function publishPluginListing(
  db: DbConnection,
  pluginId: string,
  at: number,
): PluginListingLifecycle {
  const current = getPluginListingLifecycle(db, pluginId);
  const { lifecycle, notice } = transitionPluginListingPublication({
    current,
    pluginId,
    at,
    noticeId: `pln_${nanoid()}`,
  });
  write(db, pluginId, lifecycle, notice);
  return lifecycle;
}

export function returnPluginListingToDraft(
  db: DbConnection,
  pluginId: string,
  at: number,
): PluginListingLifecycle {
  const current = getPluginListingLifecycle(db, pluginId);
  const { lifecycle, notice } = transitionPluginListingClosedUnmerged({
    current,
    pluginId,
    at,
    noticeId: `pln_${nanoid()}`,
  });
  write(db, pluginId, lifecycle, notice);
  return lifecycle;
}

export function listPluginListingNotices(
  db: DbConnection,
): PluginListingNotice[] {
  return db
    .select({ json: pluginListingLifecycles.noticeJson })
    .from(pluginListingLifecycles)
    .where(ne(pluginListingLifecycles.noticeKind, "none"))
    .all()
    .map((row) => parseNotice(row.json));
}

export function consumePluginListingNotice(
  db: DbConnection,
  noticeId: string,
): boolean {
  return (
    db
      .update(pluginListingLifecycles)
      .set({
        noticeKind: "none",
        noticeId: "",
        noticeJson: '{"kind":"none"}',
        updatedAt: Date.now(),
      })
      .where(eq(pluginListingLifecycles.noticeId, noticeId))
      .run().changes > 0
  );
}

import { and, eq, isNull, ne } from "drizzle-orm";
import { nanoid } from "nanoid";
import {
  pluginListingLifecycleSchema,
  pluginListingNoticeSchema,
  type PluginListingDraftEntry,
  type PluginListingLifecycle,
  type PluginListingNotice,
} from "@bb/server-contract";
import type { DbConnection } from "../connection.js";
import { installedPlugins, pluginListingLifecycles } from "../schema.js";

export interface PluginListingLifecycleRow {
  pluginId: string;
  lifecycle: PluginListingLifecycle;
}

function parseLifecycle(json: string): PluginListingLifecycle {
  return pluginListingLifecycleSchema.parse(JSON.parse(json));
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
    : pluginListingNoticeSchema.parse(JSON.parse(row.json));
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
  const lifecycle = pluginListingLifecycleSchema.parse({
    status: "draft",
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
  if (current?.status !== "draft") {
    throw new Error(`plugin ${JSON.stringify(pluginId)} has no listing draft`);
  }
  const lifecycle = pluginListingLifecycleSchema.parse({
    status: "in-review",
    entry: current.entry,
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
  if (current?.status !== "in-review") {
    throw new Error(`plugin ${JSON.stringify(pluginId)} is not in review`);
  }
  const lifecycle = pluginListingLifecycleSchema.parse({
    status: "published",
    entryId: current.entry.id,
    publishedAt: at,
  });
  const notice = pluginListingNoticeSchema.parse({
    id: `pln_${nanoid()}`,
    kind: "published",
    pluginId,
    pluginName: current.entry.displayName,
    createdAt: at,
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
  if (current?.status !== "in-review") {
    throw new Error(`plugin ${JSON.stringify(pluginId)} is not in review`);
  }
  const lifecycle = pluginListingLifecycleSchema.parse({
    status: "draft",
    entry: current.entry,
  });
  const notice = pluginListingNoticeSchema.parse({
    id: `pln_${nanoid()}`,
    kind: "returned",
    pluginId,
    pluginName: current.entry.displayName,
    pullRequestUrl: current.pullRequest.url,
    createdAt: at,
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
    .map((row) => pluginListingNoticeSchema.parse(JSON.parse(row.json)));
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

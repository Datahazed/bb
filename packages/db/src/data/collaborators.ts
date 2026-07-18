import { eq } from "drizzle-orm";
import type { DbConnection } from "../connection.js";
import { collaborators } from "../schema.js";

export interface UpsertCollaboratorInput {
  handle: string;
  displayName: string;
  imageUrl: string | null;
}

export type CollaboratorRow = typeof collaborators.$inferSelect;

export function upsertCollaborator(
  db: DbConnection,
  input: UpsertCollaboratorInput,
  now: number,
): CollaboratorRow {
  return db
    .insert(collaborators)
    .values({
      handle: input.handle,
      displayName: input.displayName,
      imageUrl: input.imageUrl,
      firstSeenAt: now,
      lastSeenAt: now,
    })
    .onConflictDoUpdate({
      target: collaborators.handle,
      set: {
        displayName: input.displayName,
        imageUrl: input.imageUrl,
        lastSeenAt: now,
      },
    })
    .returning()
    .get();
}

export function getCollaborator(
  db: DbConnection,
  handle: string,
): CollaboratorRow | null {
  return (
    db
      .select()
      .from(collaborators)
      .where(eq(collaborators.handle, handle))
      .get() ?? null
  );
}

export function listCollaborators(db: DbConnection): CollaboratorRow[] {
  return db.select().from(collaborators).all();
}

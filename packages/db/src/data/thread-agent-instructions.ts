import type { DbConnection, DbQueryConnection } from "../connection.js";
import { threadAgentInstructions } from "../schema.js";
import { eq } from "drizzle-orm";

export interface FreezeThreadAgentInstructionsArgs {
  instructions: string;
  threadId: string;
}

export function getThreadAgentInstructions(
  db: DbQueryConnection,
  threadId: string,
): string | null {
  return (
    db
      .select({ instructions: threadAgentInstructions.instructions })
      .from(threadAgentInstructions)
      .where(eq(threadAgentInstructions.threadId, threadId))
      .get()?.instructions ?? null
  );
}

export function freezeThreadAgentInstructions(
  db: DbConnection,
  args: FreezeThreadAgentInstructionsArgs,
): string {
  if (args.instructions.length === 0) {
    throw new Error("Thread agent instructions must not be empty");
  }

  db.insert(threadAgentInstructions)
    .values({
      threadId: args.threadId,
      instructions: args.instructions,
      createdAt: Date.now(),
    })
    .onConflictDoNothing()
    .run();

  const instructions = getThreadAgentInstructions(db, args.threadId);
  if (instructions === null) {
    throw new Error(
      `Thread agent instructions were not stored for ${args.threadId}`,
    );
  }
  return instructions;
}

import { createHash } from "node:crypto";
import type { DbConnection, DbQueryConnection } from "../connection.js";
import {
  agentInstructionSnapshots,
  threadAgentInstructions,
} from "../schema.js";
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
      .select({ instructions: agentInstructionSnapshots.instructions })
      .from(threadAgentInstructions)
      .innerJoin(
        agentInstructionSnapshots,
        eq(
          threadAgentInstructions.contentHash,
          agentInstructionSnapshots.contentHash,
        ),
      )
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

  return db.transaction(
    (tx) => {
      const existing = getThreadAgentInstructions(tx, args.threadId);
      if (existing !== null) {
        return existing;
      }

      const contentHash = createHash("sha256")
        .update(args.instructions, "utf8")
        .digest("hex");
      const createdAt = Date.now();
      tx.insert(agentInstructionSnapshots)
        .values({
          contentHash,
          instructions: args.instructions,
          createdAt,
        })
        .onConflictDoNothing()
        .run();
      tx.insert(threadAgentInstructions)
        .values({
          threadId: args.threadId,
          contentHash,
          createdAt,
        })
        .onConflictDoNothing()
        .run();

      const instructions = getThreadAgentInstructions(tx, args.threadId);
      if (instructions === null) {
        throw new Error(
          `Thread agent instructions were not stored for ${args.threadId}`,
        );
      }
      return instructions;
    },
    { behavior: "immediate" },
  );
}

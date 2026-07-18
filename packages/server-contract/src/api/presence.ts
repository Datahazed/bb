import { presenceViewerSchema } from "@bb/domain";
import { z } from "zod";

/**
 * Complete current ephemeral viewer rosters, keyed by thread id.
 *
 * Unlike this HTTP snapshot, realtime `presence-summary` messages are partial
 * patches: merge each supplied thread entry into the local summary, and remove
 * an entry when its supplied handle array is empty.
 */
export const presenceSnapshotResponseSchema = z
  .object({
    threads: z.record(z.string(), z.array(presenceViewerSchema).readonly()),
  })
  .strict();

export type PresenceSnapshotResponse = z.infer<
  typeof presenceSnapshotResponseSchema
>;

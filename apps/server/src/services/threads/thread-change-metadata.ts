import { getThreadWithPendingInteractionState, type DbConnection } from "@bb/db";
import type { ThreadChangeKind, ThreadChangeMetadata } from "@bb/domain";
import type { ServerLogger } from "../../types.js";
import type {
  NotificationHub,
  ThreadChangeMetadataEnricher,
  ThreadChangeMetadataEnricherArgs,
} from "../../ws/hub.js";
import type { ProviderRegistryService } from "../providers/provider-registry.js";
import { toThreadListEntryResponses } from "./thread-runtime-display.js";

interface ThreadChangeMetadataEnricherDeps {
  db: DbConnection;
  hub: Pick<NotificationHub, "getDaemonSessionIdForHost">;
  logger: ServerLogger;
  providerRegistry: ProviderRegistryService;
}

/**
 * Change kinds that only mutate fields of the thread's own list row. A client
 * can apply the attached `listEntry` in place for these; the row's list
 * membership and grouping (project, parent, archived, deleted) is unchanged.
 */
const LIST_ENTRY_PATCHABLE_CHANGE_KINDS: ReadonlySet<ThreadChangeKind> =
  new Set<ThreadChangeKind>([
    "status-changed",
    "title-changed",
    "pin-state-changed",
    "environment-changed",
  ]);

export function shouldAttachThreadListEntry(
  args: Pick<ThreadChangeMetadataEnricherArgs, "changes" | "metadata">,
): boolean {
  if (args.metadata?.listEntry !== undefined) {
    return false;
  }
  return args.changes.some(
    (change) =>
      LIST_ENTRY_PATCHABLE_CHANGE_KINDS.has(change) ||
      (change === "events-appended" &&
        args.metadata?.backgroundActivityChanged === true),
  );
}

/**
 * Attaches the thread's current list-row projection to row-only changes so
 * clients patch cached sidebar/list rows instead of refetching the unbounded
 * sidebar bootstrap on every status flip. Installed once on the hub; notify
 * sites stay unchanged. Never throws: a failed enrichment sends the original
 * metadata and the client falls back to a refetch.
 */
export function createThreadChangeMetadataEnricher(
  deps: ThreadChangeMetadataEnricherDeps,
): ThreadChangeMetadataEnricher {
  return (args) => {
    if (!shouldAttachThreadListEntry(args)) {
      return args.metadata;
    }
    try {
      const thread = getThreadWithPendingInteractionState(
        deps.db,
        args.threadId,
      );
      if (!thread) {
        return args.metadata;
      }
      const listEntry = toThreadListEntryResponses(deps, {
        threads: [thread],
      })[0];
      if (!listEntry) {
        return args.metadata;
      }
      const metadata: ThreadChangeMetadata = {
        ...(args.metadata ?? {}),
        listEntry,
      };
      return metadata;
    } catch (error) {
      deps.logger.warn(
        { err: error, threadId: args.threadId },
        "Unable to attach thread list entry to change notification",
      );
      return args.metadata;
    }
  };
}

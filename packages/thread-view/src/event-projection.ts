import type { ActiveThinking } from "@bb/domain";
import type { AcceptedClientRequestContext } from "./accepted-client-request-context.js";
import type {
  BuildEventProjectionMessagesOptions,
  EventProjectionMessage,
  EventProjectionWorkflowMessage,
} from "./event-projection-message.js";

const eventProjectionTurnStatusValues = [
  "pending",
  "completed",
  "error",
  "interrupted",
] as const;
export type EventProjectionTurnStatus =
  (typeof eventProjectionTurnStatusValues)[number];

const eventProjectionTurnMessageDetailValues = ["summary", "full"] as const;
/**
 * Controls how eagerly completed turns include their message arrays.
 * Summary projections may still include messages when row ordering,
 * ungroupable messages, or post-terminal trailing messages need them.
 */
export type EventProjectionTurnMessageDetail =
  (typeof eventProjectionTurnMessageDetailValues)[number];

interface EventProjectionState {
  /**
   * Root-projection-only ephemeral state that should not be modeled as a
   * timeline row. Nested child projections always expose `activeThinking` as
   * null because only the thread-level timeline owns live thinking state.
   */
  activeThinking: ActiveThinking | null;
  /**
   * Root-projection-only running workflows, most recently started first,
   * selected before completed turns are summarized. A thread can run several
   * workflows concurrently. Empty for nested child projections.
   */
  activeWorkflows: EventProjectionWorkflowMessage[];
  /**
   * Root-projection-only running non-workflow background tasks, most recently
   * started first, for the background-activity prompt-box card. Independent of
   * `activeWorkflows`. Empty for nested child projections.
   */
  activeBackgroundCommands: EventProjectionWorkflowMessage[];
}

export interface BuildEventProjectionOptions extends BuildEventProjectionMessagesOptions {
  acceptedClientRequestContext?: AcceptedClientRequestContext;
  contextOnlyToolCallIds?: ReadonlySet<string>;
  /**
   * Whether the current event window owns a completed turn's terminal edge.
   * Sequence-window projections backfill turn lifecycle rows so a partial turn
   * can settle, but a context-only completion must not select a false terminal
   * response from that slice.
   */
  turnWindowCoverageById?: ReadonlyMap<
    string,
    EventProjectionTurnWindowCoverage
  >;
  turnMessageDetail: EventProjectionTurnMessageDetail;
}

export interface EventProjectionTurnWindowCoverage {
  ownsCompletion: boolean;
}

export type EventProjectionEntry =
  | EventProjectionMessageEntry
  | EventProjectionTurnEntry;

interface EventProjectionMessageEntry {
  kind: "projected-message";
  message: EventProjectionMessage;
}

interface EventProjectionTurnEntry {
  kind: "turn";
  turn: EventProjectionTurn;
}

export interface EventProjectionTurn {
  turnId: string;
  threadId: string;
  sourceSeqStart: number;
  sourceSeqEnd: number;
  startedAt: number;
  createdAt: number;
  completedAt: number | null;
  status: EventProjectionTurnStatus;
  summaryCount: number;
  /**
   * Present only when a sequence window does not own the completion edge.
   */
  windowCoverage?: EventProjectionTurnWindowCoverage;
  externalUserBoundarySeqs?: number[];
  terminalMessage?: EventProjectionMessage;
  messages?: EventProjectionMessage[];
}

export interface EventProjection {
  entries: EventProjectionEntry[];
  /** Projection-owned live state derived during the same event pass as entries. */
  state: EventProjectionState;
}

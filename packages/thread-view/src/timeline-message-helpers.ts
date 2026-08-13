import type { EventProjectionMessage } from "./event-projection-types.js";

/**
 * Grouping policy for one timeline build. The server resolves it once from the
 * app settings and passes the same value to every projection entry point, so
 * the timeline, the turn details, the conversation outline, and the CLI always
 * agree about which rows a finished turn has.
 */
export interface TimelineGroupingOptions {
  /**
   * Keep every assistant message of a finished turn outside the collapsed work
   * summary. When false, only the last assistant message stays outside it.
   */
  showAllAssistantMessages: boolean;
}

export function isTimelineTerminalMessage(
  message: EventProjectionMessage,
): boolean {
  return message.kind === "assistant-text" || message.kind === "error";
}

export function isTimelineSummaryGroupableSteerMessage(
  message: EventProjectionMessage,
): boolean {
  return (
    message.kind === "user" &&
    message.turnRequest.kind === "steer" &&
    (message.initiator === "agent" || message.initiator === "system")
  );
}

export function isTimelineUngroupableMessage(
  message: EventProjectionMessage,
  grouping: TimelineGroupingOptions,
): boolean {
  if (message.kind === "user") {
    return !isTimelineSummaryGroupableSteerMessage(message);
  }
  if (message.kind === "assistant-text") {
    // A turn shaped text -> tool_use -> text keeps only the last text as the
    // terminal message. Every earlier text hides inside the collapsed
    // "Worked for ..." summary unless the preference keeps it out. Legacy
    // system prose is bb's own message and stays out of the summary either way.
    return (
      grouping.showAllAssistantMessages || message.isLegacyUserMessage === true
    );
  }
  return message.kind === "debug/raw-event";
}

export function isTimelineSummaryCountedMessage(
  message: EventProjectionMessage,
  grouping: TimelineGroupingOptions,
): boolean {
  return !isTimelineUngroupableMessage(message, grouping);
}

export function isSingletonContextManagementOperation(
  messages: readonly EventProjectionMessage[],
): boolean {
  const onlyMessage = messages.length === 1 ? messages[0] : undefined;
  return (
    onlyMessage?.kind === "operation" &&
    (onlyMessage.opType === "compaction" ||
      onlyMessage.opType === "context-clear")
  );
}

export function findLastTerminalTimelineMessage(
  messages: readonly EventProjectionMessage[],
): EventProjectionMessage | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message && isTimelineTerminalMessage(message)) {
      return message;
    }
  }
  return undefined;
}

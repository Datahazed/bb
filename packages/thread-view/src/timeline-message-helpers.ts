import type { EventProjectionMessage } from "./event-projection-types.js";

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
): boolean {
  if (message.kind === "user") {
    return !isTimelineSummaryGroupableSteerMessage(message);
  }
  if (message.kind === "assistant-text") {
    return message.isLegacyUserMessage === true;
  }
  return message.kind === "debug/raw-event";
}

export function isTimelineSummaryCountedMessage(
  message: EventProjectionMessage,
): boolean {
  return !isTimelineUngroupableMessage(message);
}

/**
 * Whether a message's work is finished — nothing about it can still change
 * except through later events that would extend its source range. Only settled
 * messages are eligible for the partial-turn collapse: running commands,
 * waiting approvals, unanswered questions, and live background tasks must stay
 * visible while their turn is active.
 */
export function isSettledTimelineMessage(
  message: EventProjectionMessage,
): boolean {
  switch (message.kind) {
    case "command":
    case "tool-call":
    case "file-edit":
    case "web-search":
    case "web-fetch":
    case "image-view":
    case "delegation":
      return message.status !== "pending";
    case "workflow":
      return message.status !== "pending";
    case "permission-grant-lifecycle":
      return (
        message.lifecycle === "granted" ||
        message.lifecycle === "denied" ||
        message.lifecycle === "interrupted"
      );
    case "user-question-lifecycle":
      return (
        message.lifecycle === "answered" ||
        message.lifecycle === "interrupted"
      );
    case "assistant-text":
      return message.status !== "streaming";
    case "operation":
      return message.status !== "pending";
    case "user":
    case "error":
    case "debug/raw-event":
      return true;
  }
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

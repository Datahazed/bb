import { type PromptInput, type ThreadQueuedMessage } from "@bb/domain";
import { fileNameFromPath } from "@bb/thread-view";
import { promptInputToDraft, type PromptDraftState } from "@/lib/prompt-draft";

const QUEUED_MESSAGE_PREVIEW_MAX_CHARS = 140;

interface FormatQueuedMessagePreviewOptions {
  truncate?: boolean;
}

function visibleQueuedMessageInput(
  input: readonly PromptInput[],
): PromptInput[] {
  return input.filter((chunk) => chunk.visibility !== "agent-only");
}

function getAttachmentNameFromPath(path: string): string {
  const trimmedPath = path.trim();
  if (trimmedPath.length === 0) return "Attachment";
  return fileNameFromPath(trimmedPath);
}

export function countQueuedMessageAttachments(
  input: readonly PromptInput[],
): number {
  let count = 0;
  for (const chunk of visibleQueuedMessageInput(input)) {
    if (chunk.type === "localImage" || chunk.type === "localFile") {
      count += 1;
    }
  }
  return count;
}

export function getQueuedMessageVisibleText(
  input: readonly PromptInput[],
): string {
  return visibleQueuedMessageInput(input)
    .filter(
      (chunk): chunk is Extract<PromptInput, { type: "text" }> =>
        chunk.type === "text",
    )
    .map((chunk) => chunk.text.trim())
    .filter((chunk) => chunk.length > 0)
    .join("\n\n");
}

export function formatQueuedMessagePreview(
  input: readonly PromptInput[],
  options: FormatQueuedMessagePreviewOptions = {},
): string {
  const visibleInput = visibleQueuedMessageInput(input);
  const text = getQueuedMessageVisibleText(visibleInput);
  const trimmedText = text.replace(/\s+/g, " ").trim();
  if (trimmedText.length > 0) {
    if (
      options.truncate === false ||
      trimmedText.length <= QUEUED_MESSAGE_PREVIEW_MAX_CHARS
    ) {
      return trimmedText;
    }
    return `${trimmedText.slice(0, QUEUED_MESSAGE_PREVIEW_MAX_CHARS - 1)}...`;
  }

  const attachmentCount = countQueuedMessageAttachments(visibleInput);
  if (attachmentCount === 1) {
    const firstAttachment = visibleInput.find(
      (chunk) => chunk.type === "localImage" || chunk.type === "localFile",
    );
    if (firstAttachment) {
      if (firstAttachment.type === "localFile" && firstAttachment.name) {
        return `Attachment only (${firstAttachment.name})`;
      }
      return `Attachment only (${getAttachmentNameFromPath(
        firstAttachment.path,
      )})`;
    }
    return "Attachment only (1 file)";
  }
  if (attachmentCount > 1) {
    return `Attachment only (${attachmentCount} files)`;
  }

  return "(empty message)";
}

/**
 * The leading run of queued messages that the server can group into one turn.
 * A group carries a single execution envelope, so the run stops at the first
 * message whose model, reasoning level, permission mode, or service tier
 * differs from the head. The server applies one more rule the client cannot
 * see — it also refuses to group messages from different sender threads — so a
 * boundary request built from this run can still fail; surface that error.
 */
export function collectSendAllQueuedMessageGroupIds(
  queuedMessages: readonly ThreadQueuedMessage[],
): string[] {
  const headQueuedMessage = queuedMessages[0];
  if (!headQueuedMessage) return [];

  const ids: string[] = [];
  for (const queuedMessage of queuedMessages) {
    if (
      queuedMessage.model !== headQueuedMessage.model ||
      queuedMessage.reasoningLevel !== headQueuedMessage.reasoningLevel ||
      queuedMessage.permissionMode !== headQueuedMessage.permissionMode ||
      queuedMessage.serviceTier !== headQueuedMessage.serviceTier
    ) {
      break;
    }
    ids.push(queuedMessage.id);
  }
  return ids;
}

export function queuedInputToDraft(
  input: readonly PromptInput[],
): PromptDraftState {
  return promptInputToDraft(visibleQueuedMessageInput(input));
}

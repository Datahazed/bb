import { useCallback, useMemo, useRef, useState } from "react";
import type { PromptInput, ThreadQueuedMessage } from "@bb/domain";
import type {
  QueuedMessageGroupBoundaryRequest,
  QueuedMessageProcessingAction,
} from "@/components/promptbox/banner/QueuedMessagesList";
import {
  useDeleteThreadQueuedMessage,
  useReorderThreadQueuedMessage,
  useSendThreadQueuedMessage,
  useSetThreadQueuedMessageGroupBoundary,
  useUpdateThreadQueuedMessage,
} from "@/hooks/mutations/thread-runtime-mutations";
import { getMutationErrorMessage } from "@/lib/mutation-errors";
import type { QueuedMessageReorderRequest } from "@/lib/queued-message-reorder";
import { appToast } from "@/components/ui/app-toast";
import { BbHttpError } from "@/lib/sdk";
import {
  collectLeadQueuedMessageGroupIds,
  collectSendAllQueuedMessageGroupIds,
} from "@/views/thread-detail/threadQueuedMessages";
import type { InlineQueuedMessageEditState } from "./useInlineQueuedMessageEditing";

export type QueuedMessageSendGuard = "current-head" | "exists" | "none";

interface SendQueuedMessageByIdArgs {
  guard: QueuedMessageSendGuard;
  messageId: string;
}

interface UseQueuedMessageActionsArgs {
  /** The thread owning the queue. Null disables every action. */
  threadId: string | null;
  queuedMessages: readonly ThreadQueuedMessage[];
  /**
   * How long a steered ("send now") message keeps its "Sending..." label:
   * `until-left-queue` holds it until the message leaves the queue (the steer
   * surfaced in the timeline) so the row never flashes back to normal;
   * `clear-on-settle` clears when the send request settles.
   */
  sendProcessingPersistence: "clear-on-settle" | "until-left-queue";
  /** Extra guard evaluated before a send-now besides thread existence. */
  canSendNow?: () => boolean;
  onSendSuccess?: () => void;
  onSaveSuccess?: () => void;
  inlineEditingQueuedMessage: InlineQueuedMessageEditState | null;
  dismissInlineQueuedMessageEditor: () => void;
  /** The inline edit draft's current prompt input (for saving the edit). */
  activeComposerDraftInput: PromptInput[];
}

export interface UseQueuedMessageActionsResult {
  /** The processing state QueuedMessagesList should display. */
  processingQueuedMessage: {
    action: QueuedMessageProcessingAction;
    id: string;
  } | null;
  queuedMessageActionPending: boolean;
  isUpdateQueuedMessagePending: boolean;
  /** Resolves to whether the send request succeeded. */
  sendQueuedMessageById: (args: SendQueuedMessageByIdArgs) => Promise<boolean>;
  handleSendQueuedImmediately: (queuedMessageId: string) => void;
  handleSendAllQueuedMessages: () => void;
  handleSaveInlineQueuedMessage: () => Promise<void>;
  handleDeleteQueuedMessage: (queuedMessageId: string) => void;
  handleReorderQueuedMessage: (request: QueuedMessageReorderRequest) => void;
  handleSetQueuedMessageGroupBoundary: (
    request: QueuedMessageGroupBoundaryRequest,
  ) => void;
}

/**
 * The queued-message row actions shared by every thread-chat composer: send
 * now, inline-edit save, delete, reorder, and group boundaries, with a single
 * per-message processing state driving the row spinners.
 */
export function useQueuedMessageActions({
  threadId,
  queuedMessages,
  sendProcessingPersistence,
  canSendNow,
  onSendSuccess,
  onSaveSuccess,
  inlineEditingQueuedMessage,
  dismissInlineQueuedMessageEditor,
  activeComposerDraftInput,
}: UseQueuedMessageActionsArgs): UseQueuedMessageActionsResult {
  const updateQueuedMessage = useUpdateThreadQueuedMessage();
  const sendQueuedMessage = useSendThreadQueuedMessage();
  const deleteQueuedMessage = useDeleteThreadQueuedMessage();
  const reorderQueuedMessage = useReorderThreadQueuedMessage();
  const setQueuedMessageGroupBoundary =
    useSetThreadQueuedMessageGroupBoundary();
  const [processingQueuedMessage, setProcessingQueuedMessage] = useState<{
    action: QueuedMessageProcessingAction;
    id: string;
  } | null>(null);
  const queuedMessagesRef = useRef<readonly ThreadQueuedMessage[]>([]);
  queuedMessagesRef.current = queuedMessages;

  const displayedProcessingQueuedMessage = useMemo(
    () =>
      sendProcessingPersistence === "until-left-queue"
        ? processingQueuedMessage &&
          queuedMessages.some(
            (message) => message.id === processingQueuedMessage.id,
          )
          ? processingQueuedMessage
          : null
        : processingQueuedMessage,
    [processingQueuedMessage, queuedMessages, sendProcessingPersistence],
  );

  const sendQueuedMessageById = useCallback(
    async ({ guard, messageId }: SendQueuedMessageByIdArgs) => {
      if (threadId === null || (canSendNow !== undefined && !canSendNow())) {
        return false;
      }
      if (
        guard !== "none" &&
        !queuedMessagesRef.current.some((message) => message.id === messageId)
      ) {
        return false;
      }
      if (
        guard === "current-head" &&
        queuedMessagesRef.current[0]?.id !== messageId
      ) {
        return false;
      }

      setProcessingQueuedMessage({ id: messageId, action: "send" });
      try {
        await sendQueuedMessage.mutateAsync({
          id: threadId,
          mode: "auto",
          queuedMessageId: messageId,
        });
        onSendSuccess?.();
        if (sendProcessingPersistence === "clear-on-settle") {
          setProcessingQueuedMessage((current) =>
            current?.id === messageId ? null : current,
          );
        }
        // With `until-left-queue`, the displayed processing state clears via
        // derivation once the message leaves the queue.
        return true;
      } catch (error) {
        appToast.error(
          getMutationErrorMessage({
            error,
            fallbackMessage: "Failed to send queued message",
            lifecycleOperation: "send_queued_message",
          }),
        );
        setProcessingQueuedMessage((current) =>
          current?.id === messageId ? null : current,
        );
        return false;
      }
    },
    [
      canSendNow,
      onSendSuccess,
      sendProcessingPersistence,
      sendQueuedMessage,
      threadId,
    ],
  );

  const handleSendQueuedImmediately = useCallback(
    (queuedMessageId: string) => {
      void sendQueuedMessageById({ guard: "none", messageId: queuedMessageId });
    },
    [sendQueuedMessageById],
  );

  /**
   * Sends the whole queue as one turn. A thread runs one turn at a time and
   * every send re-claims the queue, so this never loops the per-message send:
   * it widens the lead group to the last compatible message and then steers the
   * head, which claims the entire group in one call.
   */
  const handleSendAllQueuedMessages = useCallback(() => {
    void (async () => {
      if (threadId === null || (canSendNow !== undefined && !canSendNow())) {
        return;
      }
      // Sending removes the queued rows and closes the inline editor with them,
      // so an open edit must be resolved before the queue can go.
      if (inlineEditingQueuedMessage) return;

      const queuedMessages = queuedMessagesRef.current;
      const headQueuedMessage = queuedMessages[0];
      const groupIds = collectSendAllQueuedMessageGroupIds(queuedMessages);
      const lastGroupedQueuedMessageId = groupIds.at(-1);
      if (
        !headQueuedMessage ||
        lastGroupedQueuedMessageId === undefined ||
        groupIds.length < 2
      ) {
        return;
      }
      const originalGroupIds = collectLeadQueuedMessageGroupIds(queuedMessages);
      const originalBoundaryQueuedMessageId = originalGroupIds.at(-1);

      setProcessingQueuedMessage({ id: headQueuedMessage.id, action: "send" });
      try {
        await setQueuedMessageGroupBoundary.mutateAsync({
          id: threadId,
          expectedGroupedPrefixQueuedMessageIds: groupIds,
          groupBoundaryQueuedMessageId: lastGroupedQueuedMessageId,
        });
      } catch (error) {
        setProcessingQueuedMessage((current) =>
          current?.id === headQueuedMessage.id ? null : current,
        );
        appToast.error(
          getMutationErrorMessage({
            error,
            fallbackMessage: "Failed to group queued messages",
            lifecycleOperation: "set_queued_message_group_boundary",
          }),
        );
        return;
      }

      const sent = await sendQueuedMessageById({
        guard: "current-head",
        messageId: headQueuedMessage.id,
      });
      if (!sent) {
        // The widened group only existed to carry this send. Put the previous
        // boundary back so a failed send cannot silently change what the next
        // turn picks up, and say so plainly when the undo cannot land.
        if (originalBoundaryQueuedMessageId === undefined) return;
        try {
          await setQueuedMessageGroupBoundary.mutateAsync({
            id: threadId,
            expectedGroupedPrefixQueuedMessageIds: originalGroupIds,
            groupBoundaryQueuedMessageId: originalBoundaryQueuedMessageId,
          });
        } catch {
          appToast.warning("The queued messages stayed grouped", {
            description: `The send failed after the group changed. The first ${groupIds.length} queued messages will now go together on the next turn.`,
          });
        }
        return;
      }

      const remainingCount = queuedMessages.length - groupIds.length;
      if (remainingCount > 0) {
        appToast.message(
          `Sent ${groupIds.length} of ${queuedMessages.length} queued messages`,
          {
            description: `The queue cannot group past a change in execution options, so ${remainingCount} ${
              remainingCount === 1 ? "message stayed" : "messages stayed"
            } queued.`,
          },
        );
      }
    })();
  }, [
    canSendNow,
    inlineEditingQueuedMessage,
    sendQueuedMessageById,
    setQueuedMessageGroupBoundary,
    threadId,
  ]);

  const handleSaveInlineQueuedMessage = useCallback(async () => {
    if (
      threadId === null ||
      !inlineEditingQueuedMessage ||
      activeComposerDraftInput.length === 0 ||
      updateQueuedMessage.isPending
    ) {
      return;
    }
    if (
      inlineEditingQueuedMessage.ownerThreadId !== threadId ||
      !queuedMessagesRef.current.some(
        (message) => message.id === inlineEditingQueuedMessage.queuedMessageId,
      )
    ) {
      dismissInlineQueuedMessageEditor();
      return;
    }
    const { expectedUpdatedAt, ownerThreadId, queuedMessageId } =
      inlineEditingQueuedMessage;
    setProcessingQueuedMessage({ id: queuedMessageId, action: "edit" });
    try {
      await updateQueuedMessage.mutateAsync({
        expectedUpdatedAt,
        id: ownerThreadId,
        input: activeComposerDraftInput,
        queuedMessageId,
      });
      onSaveSuccess?.();
      dismissInlineQueuedMessageEditor();
    } catch (error) {
      if (error instanceof BbHttpError && error.status === 404) {
        dismissInlineQueuedMessageEditor();
      }
      appToast.error(
        getMutationErrorMessage({
          error,
          fallbackMessage: "Failed to update queued message",
          lifecycleOperation: "update_queued_message",
        }),
      );
    } finally {
      setProcessingQueuedMessage((current) =>
        current?.id === queuedMessageId ? null : current,
      );
    }
  }, [
    activeComposerDraftInput,
    dismissInlineQueuedMessageEditor,
    inlineEditingQueuedMessage,
    onSaveSuccess,
    threadId,
    updateQueuedMessage,
  ]);

  const handleDeleteQueuedMessage = useCallback(
    (queuedMessageId: string) => {
      if (threadId === null) {
        return;
      }
      setProcessingQueuedMessage({ id: queuedMessageId, action: "delete" });
      void deleteQueuedMessage
        .mutateAsync({
          id: threadId,
          queuedMessageId,
        })
        .catch((error) => {
          appToast.error(
            getMutationErrorMessage({
              error,
              fallbackMessage: "Failed to delete queued message",
              lifecycleOperation: "queue_message",
            }),
          );
        })
        .finally(() => {
          setProcessingQueuedMessage((current) =>
            current?.id === queuedMessageId ? null : current,
          );
        });
    },
    [deleteQueuedMessage, threadId],
  );

  const handleReorderQueuedMessage = useCallback(
    (request: QueuedMessageReorderRequest) => {
      if (threadId === null) {
        return;
      }
      void reorderQueuedMessage
        .mutateAsync({
          ...request,
          id: threadId,
        })
        .catch((error) => {
          appToast.error(
            getMutationErrorMessage({
              error,
              fallbackMessage: "Failed to reorder queued message",
              lifecycleOperation: "reorder_queued_message",
            }),
          );
        });
    },
    [reorderQueuedMessage, threadId],
  );

  const handleSetQueuedMessageGroupBoundary = useCallback(
    (request: QueuedMessageGroupBoundaryRequest) => {
      if (threadId === null) {
        return;
      }
      void setQueuedMessageGroupBoundary
        .mutateAsync({
          id: threadId,
          ...request,
        })
        .catch((error) => {
          appToast.error(
            getMutationErrorMessage({
              error,
              fallbackMessage: "Failed to group queued messages",
              lifecycleOperation: "set_queued_message_group_boundary",
            }),
          );
        });
    },
    [setQueuedMessageGroupBoundary, threadId],
  );

  const queuedMessageActionPending =
    deleteQueuedMessage.isPending ||
    reorderQueuedMessage.isPending ||
    setQueuedMessageGroupBoundary.isPending ||
    sendQueuedMessage.isPending ||
    updateQueuedMessage.isPending;

  return {
    processingQueuedMessage: displayedProcessingQueuedMessage,
    queuedMessageActionPending,
    isUpdateQueuedMessagePending: updateQueuedMessage.isPending,
    sendQueuedMessageById,
    handleSendQueuedImmediately,
    handleSendAllQueuedMessages,
    handleSaveInlineQueuedMessage,
    handleDeleteQueuedMessage,
    handleReorderQueuedMessage,
    handleSetQueuedMessageGroupBoundary,
  };
}

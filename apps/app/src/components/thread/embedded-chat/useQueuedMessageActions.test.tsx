// @vitest-environment jsdom

import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ThreadQueuedMessage } from "@bb/domain";
import type { InlineQueuedMessageEditState } from "./useInlineQueuedMessageEditing";
import { useQueuedMessageActions } from "./useQueuedMessageActions";

const mocks = vi.hoisted(() => ({
  deleteQueuedMessage: vi.fn(),
  reorderQueuedMessage: vi.fn(),
  sendQueuedMessage: vi.fn(),
  setGroupBoundary: vi.fn(),
  updateQueuedMessage: vi.fn(),
  toastError: vi.fn(),
  toastMessage: vi.fn(),
  toastWarning: vi.fn(),
}));

vi.mock("@/hooks/mutations/thread-runtime-mutations", () => ({
  useDeleteThreadQueuedMessage: () => ({
    isPending: false,
    mutateAsync: mocks.deleteQueuedMessage,
  }),
  useReorderThreadQueuedMessage: () => ({
    isPending: false,
    mutateAsync: mocks.reorderQueuedMessage,
  }),
  useSendThreadQueuedMessage: () => ({
    isPending: false,
    mutateAsync: mocks.sendQueuedMessage,
  }),
  useSetThreadQueuedMessageGroupBoundary: () => ({
    isPending: false,
    mutateAsync: mocks.setGroupBoundary,
  }),
  useUpdateThreadQueuedMessage: () => ({
    isPending: false,
    mutateAsync: mocks.updateQueuedMessage,
  }),
}));

vi.mock("@/components/ui/app-toast", () => ({
  appToast: {
    error: mocks.toastError,
    message: mocks.toastMessage,
    warning: mocks.toastWarning,
  },
}));

function makeQueuedMessage(
  id: string,
  overrides: Partial<ThreadQueuedMessage> = {},
): ThreadQueuedMessage {
  return {
    id,
    content: [{ type: "text", text: id, mentions: [] }],
    model: "gpt-5.5",
    reasoningLevel: "medium",
    permissionMode: "auto",
    serviceTier: "default",
    groupWithNext: false,
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  };
}

function renderActions(
  queuedMessages: readonly ThreadQueuedMessage[],
  inlineEditingQueuedMessage: InlineQueuedMessageEditState | null = null,
) {
  return renderHook(() =>
    useQueuedMessageActions({
      threadId: "thr_1",
      queuedMessages,
      sendProcessingPersistence: "clear-on-settle",
      inlineEditingQueuedMessage,
      dismissInlineQueuedMessageEditor: () => {},
      activeComposerDraftInput: [],
    }),
  );
}

describe("useQueuedMessageActions send all", () => {
  beforeEach(() => {
    for (const mock of Object.values(mocks)) mock.mockReset();
    mocks.setGroupBoundary.mockResolvedValue([]);
    mocks.sendQueuedMessage.mockResolvedValue({ ok: true });
  });

  it("widens the group to the last message, then sends the head once", async () => {
    const { result } = renderActions([
      makeQueuedMessage("q_one"),
      makeQueuedMessage("q_two"),
      makeQueuedMessage("q_three"),
    ]);

    await act(async () => {
      result.current.handleSendAllQueuedMessages();
    });

    expect(mocks.setGroupBoundary).toHaveBeenCalledWith({
      id: "thr_1",
      expectedGroupedPrefixQueuedMessageIds: ["q_one", "q_two", "q_three"],
      groupBoundaryQueuedMessageId: "q_three",
    });
    // A thread runs one turn at a time: the single head send claims the group.
    expect(mocks.sendQueuedMessage).toHaveBeenCalledTimes(1);
    expect(mocks.sendQueuedMessage).toHaveBeenCalledWith({
      id: "thr_1",
      mode: "auto",
      queuedMessageId: "q_one",
    });
    expect(mocks.toastMessage).not.toHaveBeenCalled();
  });

  it("sends the compatible run and reports the messages left behind", async () => {
    const { result } = renderActions([
      makeQueuedMessage("q_one"),
      makeQueuedMessage("q_two"),
      makeQueuedMessage("q_three", { reasoningLevel: "high" }),
      makeQueuedMessage("q_four", { reasoningLevel: "high" }),
    ]);

    await act(async () => {
      result.current.handleSendAllQueuedMessages();
    });

    expect(mocks.setGroupBoundary).toHaveBeenCalledWith({
      id: "thr_1",
      expectedGroupedPrefixQueuedMessageIds: ["q_one", "q_two"],
      groupBoundaryQueuedMessageId: "q_two",
    });
    expect(mocks.sendQueuedMessage).toHaveBeenCalledTimes(1);
    expect(mocks.toastMessage).toHaveBeenCalledWith(
      "Sent 2 of 4 queued messages",
      expect.objectContaining({
        description: expect.stringContaining("2 messages stayed queued"),
      }),
    );
  });

  it("does not send when the group boundary is rejected", async () => {
    mocks.setGroupBoundary.mockRejectedValue(new Error("boom"));
    const { result } = renderActions([
      makeQueuedMessage("q_one"),
      makeQueuedMessage("q_two"),
    ]);

    await act(async () => {
      result.current.handleSendAllQueuedMessages();
    });

    expect(mocks.sendQueuedMessage).not.toHaveBeenCalled();
    expect(mocks.toastError).toHaveBeenCalledTimes(1);
    expect(result.current.processingQueuedMessage).toBeNull();
  });

  it("skips the remainder toast and undoes the group when the send fails", async () => {
    mocks.sendQueuedMessage.mockRejectedValue(new Error("boom"));
    const { result } = renderActions([
      // The first two already travel together, so that is the boundary to
      // restore after the failed send.
      makeQueuedMessage("q_one", { groupWithNext: true }),
      makeQueuedMessage("q_two"),
      makeQueuedMessage("q_three"),
    ]);

    await act(async () => {
      result.current.handleSendAllQueuedMessages();
    });

    expect(mocks.toastError).toHaveBeenCalledTimes(1);
    expect(mocks.toastMessage).not.toHaveBeenCalled();
    expect(mocks.setGroupBoundary).toHaveBeenCalledTimes(2);
    expect(mocks.setGroupBoundary).toHaveBeenLastCalledWith({
      id: "thr_1",
      expectedGroupedPrefixQueuedMessageIds: ["q_one", "q_two"],
      groupBoundaryQueuedMessageId: "q_two",
    });
    expect(mocks.toastWarning).not.toHaveBeenCalled();
  });

  it("reports the leftover group when the undo also fails", async () => {
    mocks.sendQueuedMessage.mockRejectedValue(new Error("boom"));
    mocks.setGroupBoundary
      .mockResolvedValueOnce([])
      .mockRejectedValueOnce(new Error("undo failed"));
    const { result } = renderActions([
      makeQueuedMessage("q_one"),
      makeQueuedMessage("q_two"),
    ]);

    await act(async () => {
      result.current.handleSendAllQueuedMessages();
    });

    expect(mocks.toastWarning).toHaveBeenCalledWith(
      "The queued messages stayed grouped",
      expect.objectContaining({
        description: expect.stringContaining("go together on the next turn"),
      }),
    );
  });

  it("refuses to send while a queued message has an open edit", async () => {
    const inlineEdit: InlineQueuedMessageEditState = {
      draft: { attachments: [], mentions: [], text: "unsaved text" },
      editSessionId: 1,
      expectedUpdatedAt: 1,
      model: "gpt-5.5",
      ownerThreadId: "thr_1",
      permissionMode: "auto",
      queuedMessageId: "q_one",
      queuedMessageIndex: 0,
      reasoningLevel: "medium",
      serviceTier: "default",
    };
    const { result } = renderActions(
      [makeQueuedMessage("q_one"), makeQueuedMessage("q_two")],
      inlineEdit,
    );

    await act(async () => {
      result.current.handleSendAllQueuedMessages();
    });

    // Nothing may run: the send would delete the row the editor is bound to.
    expect(mocks.setGroupBoundary).not.toHaveBeenCalled();
    expect(mocks.sendQueuedMessage).not.toHaveBeenCalled();
  });
});

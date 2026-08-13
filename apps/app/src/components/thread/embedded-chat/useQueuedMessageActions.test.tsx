// @vitest-environment jsdom

import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ThreadQueuedMessage } from "@bb/domain";
import { useQueuedMessageActions } from "./useQueuedMessageActions";

const mocks = vi.hoisted(() => ({
  deleteQueuedMessage: vi.fn(),
  reorderQueuedMessage: vi.fn(),
  sendQueuedMessage: vi.fn(),
  setGroupBoundary: vi.fn(),
  updateQueuedMessage: vi.fn(),
  toastError: vi.fn(),
  toastMessage: vi.fn(),
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
  appToast: { error: mocks.toastError, message: mocks.toastMessage },
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

function renderActions(queuedMessages: readonly ThreadQueuedMessage[]) {
  return renderHook(() =>
    useQueuedMessageActions({
      threadId: "thr_1",
      queuedMessages,
      sendProcessingPersistence: "clear-on-settle",
      inlineEditingQueuedMessage: null,
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
        description: expect.stringContaining("2 messages use"),
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

  it("skips the remainder toast when the send itself fails", async () => {
    mocks.sendQueuedMessage.mockRejectedValue(new Error("boom"));
    const { result } = renderActions([
      makeQueuedMessage("q_one"),
      makeQueuedMessage("q_two"),
      makeQueuedMessage("q_three", { model: "claude-opus-5" }),
    ]);

    await act(async () => {
      result.current.handleSendAllQueuedMessages();
    });

    expect(mocks.setGroupBoundary).toHaveBeenCalledTimes(1);
    expect(mocks.toastError).toHaveBeenCalledTimes(1);
    expect(mocks.toastMessage).not.toHaveBeenCalled();
  });
});

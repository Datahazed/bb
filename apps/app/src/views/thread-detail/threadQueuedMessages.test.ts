import { describe, expect, it } from "vitest";
import type { PromptInput, ThreadQueuedMessage } from "@bb/domain";
import {
  collectSendAllQueuedMessageGroupIds,
  formatQueuedMessagePreview,
  queuedInputToDraft,
} from "./threadQueuedMessages";

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

describe("threadQueuedMessages", () => {
  it("formats queued-message previews from text or attachment-only inputs", () => {
    const input: PromptInput[] = [
      { type: "text", text: "  First line  ", mentions: [] },
      { type: "text", text: "Second line", mentions: [] },
    ];

    expect(formatQueuedMessagePreview(input)).toBe("First line Second line");
    expect(
      formatQueuedMessagePreview([
        {
          type: "localFile",
          path: "/tmp/notes.md",
          name: "notes.md",
          sizeBytes: 10,
        },
      ]),
    ).toBe("Attachment only (notes.md)");
    expect(
      formatQueuedMessagePreview([
        {
          type: "localImage",
          path: "  ",
        },
      ]),
    ).toBe("Attachment only (Attachment)");
  });

  it("omits agent-only side-chat reply references from queued previews", () => {
    expect(
      formatQueuedMessagePreview([
        {
          type: "text",
          text: "Replying to this earlier message in the conversation:\n\nEarlier agent reply",
          mentions: [],
          visibility: "agent-only",
        },
        { type: "text", text: "What should I do next?", mentions: [] },
      ]),
    ).toBe("What should I do next?");
  });

  it("restores editable drafts from queued messages", () => {
    const draft = queuedInputToDraft([
      { type: "text", text: "Follow up", mentions: [] },
      {
        type: "localImage",
        path: "/tmp/image.png",
      },
    ]);
    const attachmentOnlyDraft = queuedInputToDraft([
      {
        type: "localImage",
        path: "  ",
      },
    ]);

    expect(draft).toEqual({
      text: "Follow up",
      mentions: [],
      attachments: [
        {
          type: "localImage",
          path: "/tmp/image.png",
          name: "image.png",
          sizeBytes: 0,
        },
      ],
    });
    expect(attachmentOnlyDraft.attachments[0]?.name).toBe("Attachment");
  });

  it("omits agent-only queued-message content when restoring a draft", () => {
    const draft = queuedInputToDraft([
      {
        type: "text",
        text: "Replying to this earlier message in the conversation:\n\nEarlier agent reply",
        mentions: [],
        visibility: "agent-only",
      },
      {
        type: "localFile",
        path: "/tmp/hidden.md",
        name: "hidden.md",
        visibility: "agent-only",
      },
      { type: "text", text: "What should I do next?", mentions: [] },
      {
        type: "localFile",
        path: "/tmp/visible.md",
        name: "visible.md",
        sizeBytes: 12,
      },
    ]);

    expect(draft).toEqual({
      text: "What should I do next?",
      mentions: [],
      attachments: [
        {
          type: "localFile",
          path: "/tmp/visible.md",
          name: "visible.md",
          sizeBytes: 12,
        },
      ],
    });
  });

  it("stops the send-all group at the first mismatched execution option", () => {
    expect(collectSendAllQueuedMessageGroupIds([])).toEqual([]);
    expect(
      collectSendAllQueuedMessageGroupIds([
        makeQueuedMessage("q_one"),
        makeQueuedMessage("q_two"),
        makeQueuedMessage("q_three"),
      ]),
    ).toEqual(["q_one", "q_two", "q_three"]);
    expect(
      collectSendAllQueuedMessageGroupIds([
        makeQueuedMessage("q_one"),
        makeQueuedMessage("q_two"),
        makeQueuedMessage("q_three", { model: "claude-opus-5" }),
        // A later match must not rejoin the group once the run is broken.
        makeQueuedMessage("q_four"),
      ]),
    ).toEqual(["q_one", "q_two"]);
    expect(
      collectSendAllQueuedMessageGroupIds([
        makeQueuedMessage("q_one"),
        makeQueuedMessage("q_two", { reasoningLevel: "high" }),
      ]),
    ).toEqual(["q_one"]);
    expect(
      collectSendAllQueuedMessageGroupIds([
        makeQueuedMessage("q_one"),
        makeQueuedMessage("q_two", { permissionMode: "full" }),
      ]),
    ).toEqual(["q_one"]);
    expect(
      collectSendAllQueuedMessageGroupIds([
        makeQueuedMessage("q_one"),
        makeQueuedMessage("q_two", { serviceTier: "fast" }),
      ]),
    ).toEqual(["q_one"]);
  });
});

import { describe, expect, it } from "vitest";
import {
  presenceSummaryMessageSchema,
  presenceSnapshotResponseSchema,
  threadPresenceMessageLenientSchema,
  threadPresenceMessageSchema,
} from "../src/index.js";

describe("presence contracts", () => {
  it("validates strict snapshots and realtime messages", () => {
    const viewer = {
      handle: "sawyer",
      displayName: "Sawyer",
      imageUrl: null,
      typing: false,
    };
    expect(
      presenceSnapshotResponseSchema.parse({
        threads: { "thread-1": [viewer] },
      }),
    ).toEqual({ threads: { "thread-1": [viewer] } });
    expect(
      threadPresenceMessageSchema.parse({
        type: "thread-presence",
        threadId: "thread-1",
        viewers: [viewer],
      }),
    ).toMatchObject({ type: "thread-presence", threadId: "thread-1" });
    expect(
      presenceSummaryMessageSchema.parse({
        type: "presence-summary",
        threads: { "thread-1": ["sawyer"] },
      }),
    ).toEqual({
      type: "presence-summary",
      threads: { "thread-1": ["sawyer"] },
    });
  });

  it("rejects unknown strict fields while lenient inbound parsing strips them", () => {
    const message = {
      type: "thread-presence",
      threadId: "thread-1",
      viewers: [
        {
          handle: "sawyer",
          displayName: "Sawyer",
          imageUrl: null,
          typing: false,
          futureViewerField: true,
        },
      ],
      futureMessageField: true,
    };
    expect(threadPresenceMessageSchema.safeParse(message).success).toBe(false);
    expect(threadPresenceMessageLenientSchema.parse(message)).toEqual({
      type: "thread-presence",
      threadId: "thread-1",
      viewers: [
        {
          handle: "sawyer",
          displayName: "Sawyer",
          imageUrl: null,
          typing: false,
        },
      ],
    });
  });
});

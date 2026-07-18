import { describe, expect, it } from "vitest";
import { conversationRow } from "@/test/fixtures/thread-timeline-rows";
import { timelineHasMultipleMessageAuthors } from "./ThreadTimelineRows";

function userRow(seq: number, actorHandle: string | null) {
  return {
    ...conversationRow({
      id: `row_${seq}`,
      seq,
      role: "user",
      text: `message ${seq}`,
    }),
    actorHandle,
  };
}

describe("timelineHasMultipleMessageAuthors", () => {
  it("stays single-author for null-handle (legacy/local) rows", () => {
    expect(
      timelineHasMultipleMessageAuthors([userRow(1, null), userRow(2, null)]),
    ).toBe(false);
  });

  it("stays single-author when every attributed row shares one handle", () => {
    expect(
      timelineHasMultipleMessageAuthors([
        userRow(1, "alice"),
        userRow(2, "alice"),
        userRow(3, null),
      ]),
    ).toBe(false);
  });

  it("flips on the second distinct handle", () => {
    expect(
      timelineHasMultipleMessageAuthors([
        userRow(1, "alice"),
        userRow(2, null),
        userRow(3, "bob"),
      ]),
    ).toBe(true);
  });
});

import { describe, expect, it } from "vitest";
import { annotateSpeakerInput } from "./thread.js";

describe("thread speaker annotation", () => {
  it("prefixes the first text input with the speaker handle", () => {
    expect(
      annotateSpeakerInput(
        [
          { type: "text", text: "hello", mentions: [] },
          { type: "text", text: "world", mentions: [] },
        ],
        { displayName: "Alice", handle: "alice" },
      ),
    ).toEqual([
      { type: "text", text: "[from @alice] hello", mentions: [] },
      { type: "text", text: "world", mentions: [] },
    ]);
  });

  it("adds a text input when the prompt starts with an attachment", () => {
    const attachment = {
      type: "localImage" as const,
      path: "/tmp/image.png",
    };
    expect(
      annotateSpeakerInput([attachment], {
        displayName: "Alice",
        handle: "alice",
      }),
    ).toEqual([
      { type: "text", text: "[from @alice] ", mentions: [] },
      attachment,
    ]);
  });
});

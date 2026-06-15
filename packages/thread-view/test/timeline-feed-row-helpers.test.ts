import { describe, expect, it } from "vitest";
import {
  buildExpandableBodyFeedPreview,
  timelineFeedDetailPartsForText,
} from "../src/timeline-feed-row-helpers.js";

describe("buildExpandableBodyFeedPreview", () => {
  it("marks omitted completed non-empty bodies incomplete so detail can load", () => {
    const text = "@@ -1 +1 @@\n-before\n+after";
    const preview = buildExpandableBodyFeedPreview(text, "completed", undefined);

    expect(preview).toEqual({
      complete: false,
      fullLength: text.length,
      text: "",
    });
    expect(timelineFeedDetailPartsForText("file-diff", preview)).toEqual([
      "file-diff",
    ]);
  });

  it("marks omitted completed empty bodies complete", () => {
    const preview = buildExpandableBodyFeedPreview(
      "",
      "completed",
      undefined,
    );

    expect(preview).toEqual({
      complete: true,
      fullLength: 0,
      text: "",
    });
    expect(timelineFeedDetailPartsForText("output", preview)).toEqual([]);
  });
});

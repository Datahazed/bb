import { describe, expect, it } from "vitest";
import type { TimelineFeedDetailRef } from "@bb/server-contract";
import { fileChangeRow } from "@/test/fixtures/thread-timeline-rows";
import { timelineRowRenderSignature } from "./timelineRowSignatures";

const FILE_DIFF_DETAIL_REF: TimelineFeedDetailRef = {
  rowKey: "wf_1_file_change",
  source: {
    start: 1,
    end: 1,
  },
  parts: ["file-diff"],
};

describe("timelineRowRenderSignature", () => {
  it("changes when a file-change row gains lazy diff detail metadata", () => {
    const baseRow = fileChangeRow({
      diff: "",
      sourceSeqEnd: 1,
      sourceSeqStart: 1,
    });
    const detailRow = {
      ...baseRow,
      feedDetail: FILE_DIFF_DETAIL_REF,
    };

    expect(timelineRowRenderSignature(detailRow)).not.toBe(
      timelineRowRenderSignature(baseRow),
    );
  });
});

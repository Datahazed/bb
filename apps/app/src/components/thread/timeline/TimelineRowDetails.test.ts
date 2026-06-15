import { describe, expect, it } from "vitest";
import type { TimelineFeedDetailRef } from "@bb/server-contract";
import { fileChangeRow } from "@/test/fixtures/thread-timeline-rows";
import { shouldShowTimelineFileDiffLoading } from "./TimelineRowDetails";

type FileChangeLoadingRow = Parameters<
  typeof shouldShowTimelineFileDiffLoading
>[0]["row"];

const FILE_DIFF_DETAIL_REF: TimelineFeedDetailRef = {
  rowKey: "wf_1_file_change",
  source: {
    start: 1,
    end: 1,
  },
  parts: ["file-diff"],
};

function fileChangeLoadingRow(diff: string | null): FileChangeLoadingRow {
  return {
    ...fileChangeRow({
      diff,
      sourceSeqEnd: 1,
      sourceSeqStart: 1,
      status: "completed",
    }),
    feedDetail: FILE_DIFF_DETAIL_REF,
  };
}

describe("shouldShowTimelineFileDiffLoading", () => {
  it("treats an empty omitted diff preview as pending while detail loads", () => {
    expect(
      shouldShowTimelineFileDiffLoading({
        detailError: false,
        detailLoaded: false,
        row: fileChangeLoadingRow(""),
      }),
    ).toBe(true);
  });

  it("keeps showing a non-empty preview while detail loads", () => {
    expect(
      shouldShowTimelineFileDiffLoading({
        detailError: false,
        detailLoaded: false,
        row: fileChangeLoadingRow("@@ -1 +1 @@\n-before\n+after"),
      }),
    ).toBe(false);
  });

  it("stops loading once detail has resolved or failed", () => {
    const row = fileChangeLoadingRow("");

    expect(
      shouldShowTimelineFileDiffLoading({
        detailError: false,
        detailLoaded: true,
        row,
      }),
    ).toBe(false);
    expect(
      shouldShowTimelineFileDiffLoading({
        detailError: true,
        detailLoaded: false,
        row,
      }),
    ).toBe(false);
  });
});

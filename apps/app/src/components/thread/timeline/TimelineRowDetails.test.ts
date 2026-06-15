import { describe, expect, it } from "vitest";
import type { TimelineFeedDetailRef } from "@bb/server-contract";
import { commandRow, fileChangeRow } from "@/test/fixtures/thread-timeline-rows";
import {
  shouldShowTimelineFileDiffLoading,
  shouldShowTimelineWorkOutputLoading,
} from "./TimelineRowDetails";

type FileChangeLoadingRow = Parameters<
  typeof shouldShowTimelineFileDiffLoading
>[0]["row"];
type WorkOutputLoadingRow = Parameters<
  typeof shouldShowTimelineWorkOutputLoading
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

function omittedOutputRow(output: string): WorkOutputLoadingRow {
  return {
    ...commandRow({
      command: "pnpm test",
      output,
    }),
    outputDetail: {
      fullLength: 10_000,
      previewLength: output.length,
    },
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

describe("shouldShowTimelineWorkOutputLoading", () => {
  it("treats an empty omitted output preview as pending while detail loads", () => {
    expect(
      shouldShowTimelineWorkOutputLoading({
        detailError: false,
        detailLoaded: false,
        row: omittedOutputRow(""),
      }),
    ).toBe(true);
  });

  it("keeps showing a non-empty output preview while detail loads", () => {
    expect(
      shouldShowTimelineWorkOutputLoading({
        detailError: false,
        detailLoaded: false,
        row: omittedOutputRow("partial output"),
      }),
    ).toBe(false);
  });

  it("stops loading once output detail has resolved or failed", () => {
    const row = omittedOutputRow("");

    expect(
      shouldShowTimelineWorkOutputLoading({
        detailError: false,
        detailLoaded: true,
        row,
      }),
    ).toBe(false);
    expect(
      shouldShowTimelineWorkOutputLoading({
        detailError: true,
        detailLoaded: false,
        row,
      }),
    ).toBe(false);
  });

  it("does not load for complete empty output", () => {
    expect(
      shouldShowTimelineWorkOutputLoading({
        detailError: false,
        detailLoaded: false,
        row: commandRow({ command: "true", output: "" }),
      }),
    ).toBe(false);
  });
});

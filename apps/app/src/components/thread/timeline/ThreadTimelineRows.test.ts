import { describe, expect, it } from "vitest";
import type { TimelineFeedDetailRef, TimelineRow } from "@bb/server-contract";
import {
  commandRow,
  delegationRow,
} from "@/test/fixtures/thread-timeline-rows";
import { shouldShowDelegationDetailsLoading } from "./ThreadTimelineRows";

type DelegationLoadingRow = Parameters<
  typeof shouldShowDelegationDetailsLoading
>[0]["row"];

const DELEGATION_DETAIL_REF: TimelineFeedDetailRef = {
  rowKey: "wd_1_delegation",
  source: {
    start: 1,
    end: 1,
  },
  parts: ["children", "output"],
};

function omittedDelegationDetailsRow(
  args: {
    childRows?: TimelineRow[];
    output?: string;
  } = {},
): DelegationLoadingRow {
  return {
    ...delegationRow({
      childRows: args.childRows ?? [],
      output: args.output ?? "",
      sourceSeqEnd: 1,
      sourceSeqStart: 1,
      status: "completed",
    }),
    feedDetail: DELEGATION_DETAIL_REF,
  };
}

describe("shouldShowDelegationDetailsLoading", () => {
  it("treats an empty omitted delegation body as pending while detail loads", () => {
    expect(
      shouldShowDelegationDetailsLoading({
        detailError: false,
        detailLoaded: false,
        row: omittedDelegationDetailsRow(),
      }),
    ).toBe(true);
  });

  it("keeps showing existing children or output while detail loads", () => {
    expect(
      shouldShowDelegationDetailsLoading({
        detailError: false,
        detailLoaded: false,
        row: omittedDelegationDetailsRow({
          childRows: [commandRow({ command: "pwd" })],
        }),
      }),
    ).toBe(false);
    expect(
      shouldShowDelegationDetailsLoading({
        detailError: false,
        detailLoaded: false,
        row: omittedDelegationDetailsRow({ output: "partial answer" }),
      }),
    ).toBe(false);
  });

  it("stops loading once delegation detail has resolved or failed", () => {
    const row = omittedDelegationDetailsRow();

    expect(
      shouldShowDelegationDetailsLoading({
        detailError: false,
        detailLoaded: true,
        row,
      }),
    ).toBe(false);
    expect(
      shouldShowDelegationDetailsLoading({
        detailError: true,
        detailLoaded: false,
        row,
      }),
    ).toBe(false);
  });
});

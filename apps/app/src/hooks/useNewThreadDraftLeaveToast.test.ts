import { describe, expect, it } from "vitest";
import type { PromptDraftState } from "@bb/client-core";
import { shouldAnnounceNewThreadDraftLeave } from "./useNewThreadDraftLeaveToast";

const EMPTY_DRAFT: PromptDraftState = {
  attachments: [],
  mentions: [],
  text: "",
};

describe("new-thread draft leave toast", () => {
  it("announces a page-composer draft only when its built-in row is hidden", () => {
    const draft = { ...EMPTY_DRAFT, text: "Keep this work" };
    expect(
      shouldAnnounceNewThreadDraftLeave({
        draft,
        draftRowsVisible: false,
        isSplitPane: false,
      }),
    ).toBe(true);
    expect(
      shouldAnnounceNewThreadDraftLeave({
        draft,
        draftRowsVisible: true,
        isSplitPane: false,
      }),
    ).toBe(false);
  });

  it("does not announce empty or split-pane drafts in Phase 2", () => {
    expect(
      shouldAnnounceNewThreadDraftLeave({
        draft: EMPTY_DRAFT,
        draftRowsVisible: false,
        isSplitPane: false,
      }),
    ).toBe(false);
    expect(
      shouldAnnounceNewThreadDraftLeave({
        draft: { ...EMPTY_DRAFT, text: "Split work" },
        draftRowsVisible: false,
        isSplitPane: true,
      }),
    ).toBe(false);
  });
});

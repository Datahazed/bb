// @vitest-environment jsdom

import { act, renderHook } from "@testing-library/react";
import { createElement, StrictMode, type PropsWithChildren } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PromptDraftState } from "@bb/client-core";
import {
  shouldAnnounceNewThreadDraftLeave,
  useNewThreadDraftLeaveToast,
} from "./useNewThreadDraftLeaveToast";

const mockToastMessage = vi.hoisted(() => vi.fn());

vi.mock("@/components/ui/app-toast", () => ({
  appToast: { message: mockToastMessage },
}));

const EMPTY_DRAFT: PromptDraftState = {
  attachments: [],
  mentions: [],
  text: "",
};

function StrictModeWrapper({ children }: PropsWithChildren) {
  return createElement(StrictMode, null, children);
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("new-thread draft leave toast", () => {
  it("announces exactly once on real unmount with no action payload", async () => {
    const draft = { ...EMPTY_DRAFT, text: "Keep this work" };
    const hook = renderHook(
      () =>
        useNewThreadDraftLeaveToast({
          getCurrentDraft: () => draft,
          isSplitPane: false,
        }),
      { wrapper: StrictModeWrapper },
    );

    await act(async () => {
      hook.unmount();
      await Promise.resolve();
    });

    expect(mockToastMessage).toHaveBeenCalledTimes(1);
    expect(mockToastMessage).toHaveBeenCalledWith("Saved to Drafts");
  });

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

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
      }),
    ).toBe(true);
    expect(
      shouldAnnounceNewThreadDraftLeave({
        draft,
        draftRowsVisible: true,
      }),
    ).toBe(false);
  });

  it("does not announce empty drafts", () => {
    expect(
      shouldAnnounceNewThreadDraftLeave({
        draft: EMPTY_DRAFT,
        draftRowsVisible: false,
      }),
    ).toBe(false);
  });

  it("announces split-pane drafts when their built-in row is hidden", () => {
    expect(
      shouldAnnounceNewThreadDraftLeave({
        draft: { ...EMPTY_DRAFT, text: "Split work" },
        draftRowsVisible: false,
      }),
    ).toBe(true);
  });

  it("coalesces composers removed by the same leave event into one toast", async () => {
    const leftDraft = { ...EMPTY_DRAFT, text: "Left work" };
    const rightDraft = { ...EMPTY_DRAFT, text: "Right work" };
    const left = renderHook(
      () =>
        useNewThreadDraftLeaveToast({
          getCurrentDraft: () => leftDraft,
        }),
      { wrapper: StrictModeWrapper },
    );
    const right = renderHook(
      () =>
        useNewThreadDraftLeaveToast({
          getCurrentDraft: () => rightDraft,
        }),
      { wrapper: StrictModeWrapper },
    );

    await act(async () => {
      left.unmount();
      right.unmount();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mockToastMessage).toHaveBeenCalledTimes(1);
    expect(mockToastMessage).toHaveBeenCalledWith("Saved to Drafts");
  });
});

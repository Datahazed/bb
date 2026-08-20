// @vitest-environment jsdom

import { act, cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DelayedLoadingFallback,
  LOADING_FALLBACK_REVEAL_DELAY_MS,
} from "./delayed-loading-fallback";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("DelayedLoadingFallback", () => {
  it("reveals its fallback only after the loading delay", () => {
    vi.useFakeTimers();
    const view = render(
      <DelayedLoadingFallback>
        <div data-testid="fallback">Loading</div>
      </DelayedLoadingFallback>,
    );

    expect(view.queryByTestId("fallback")).toBeNull();

    act(() => {
      vi.advanceTimersByTime(LOADING_FALLBACK_REVEAL_DELAY_MS - 1);
    });
    expect(view.queryByTestId("fallback")).toBeNull();

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(view.getByTestId("fallback")).not.toBeNull();
  });
});

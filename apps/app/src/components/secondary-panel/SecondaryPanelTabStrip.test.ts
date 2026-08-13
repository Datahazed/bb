// @vitest-environment jsdom

import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, vi } from "vitest";
import { describe, expect, it } from "vitest";
import {
  SecondaryPanelTabStrip,
  SECONDARY_PANEL_TAB_STRIP_FADE_TONE,
} from "./SecondaryPanelTabStrip";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("secondary panel tab-strip edge fades", () => {
  it("uses the themed edge fade", () => {
    expect(SECONDARY_PANEL_TAB_STRIP_FADE_TONE).toBe("sidebar");
  });

  it("observes the intrinsic tab row so async title changes refresh overflow", () => {
    const observed: Element[] = [];
    let resizeCallback: ResizeObserverCallback | undefined;
    let animationFrameCallback: FrameRequestCallback | undefined;
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      animationFrameCallback = callback;
      return 1;
    });
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(callback: ResizeObserverCallback) {
          resizeCallback = callback;
        }
        observe(element: Element) {
          observed.push(element);
        }
        disconnect() {}
      },
    );

    const { container } = render(
      createElement(SecondaryPanelTabStrip, {
        fileTabs: [
          {
            id: "browser",
            filename: "Browser",
            isActive: true,
            isPinned: false,
            leadingVisual: null,
            statusLabel: null,
            onSelect: vi.fn(),
            onClose: vi.fn(),
          },
        ],
        onReorderTab: vi.fn(),
        usesDesktopChrome: false,
      }),
    );

    const viewport = container.querySelector(".no-scrollbar");
    const content = container.querySelector(
      "[data-secondary-panel-tab-content]",
    );
    const strip = container.querySelector(
      '[data-testid="secondary-panel-tab-strip"]',
    );
    expect(content).not.toBeNull();
    expect(strip).not.toBeNull();
    expect(observed).toContain(strip);
    expect(observed).toContain(viewport);
    expect(observed).toContain(content);
    expect(resizeCallback).toBeDefined();
    expect(container.querySelectorAll("[data-overflow-fade]")).toHaveLength(2);
    expect(
      container
        .querySelector("[data-overflow-fade='left']")
        ?.classList.contains("w-6"),
    ).toBe(true);
    const overflowButton = container.querySelector<HTMLButtonElement>(
      "[data-secondary-panel-tab-overflow-control]",
    );
    expect(overflowButton).not.toBeNull();
    expect(overflowButton?.classList.contains("w-0")).toBe(true);

    const rightFade = container.querySelector("[data-overflow-fade='right']");
    expect(rightFade?.classList.contains("opacity-0")).toBe(true);
    Object.defineProperties(viewport!, {
      clientWidth: { configurable: true, value: 120 },
      scrollWidth: { configurable: true, value: 480 },
      scrollLeft: { configurable: true, value: 0, writable: true },
    });
    Object.defineProperty(strip!, "clientWidth", {
      configurable: true,
      value: 120,
    });
    Object.defineProperty(content!, "scrollWidth", {
      configurable: true,
      value: 480,
    });
    act(() => {
      resizeCallback?.([], {} as ResizeObserver);
    });
    expect(rightFade?.classList.contains("opacity-100")).toBe(true);

    const scrollRegion = container.querySelector(
      "[data-secondary-panel-tab-scroll-region]",
    );
    expect(strip?.children[0]).toBe(overflowButton);
    expect(strip?.children[1]).toBe(scrollRegion);
    expect(strip?.children).toHaveLength(2);
    expect(overflowButton?.classList.contains("absolute")).toBe(false);
    expect(overflowButton?.classList.contains("w-5")).toBe(true);
    expect(overflowButton?.classList.contains("opacity-100")).toBe(true);
    expect(overflowButton?.tabIndex).toBe(0);
    expect(overflowButton?.getAttribute("aria-label")).toBe(
      "Scroll tabs right",
    );
    expect(overflowButton?.classList.contains("bg-sidebar")).toBe(true);
    expect(
      overflowButton?.classList.contains("hover:bg-surface-raised-solid"),
    ).toBe(true);
    expect(overflowButton?.classList.contains("hover:bg-state-hover")).toBe(
      false,
    );

    const scrollBy = vi.fn();
    Object.defineProperty(viewport!, "scrollBy", {
      configurable: true,
      value: scrollBy,
    });
    fireEvent.click(overflowButton!);
    expect(scrollBy).toHaveBeenCalledWith({ left: 140, behavior: "smooth" });

    overflowButton?.focus();
    expect(document.activeElement).toBe(overflowButton);
    viewport!.scrollLeft = 140;
    fireEvent.scroll(viewport!);
    act(() => animationFrameCallback?.(0));
    expect(overflowButton?.getAttribute("aria-hidden")).toBe("false");
    expect(overflowButton?.getAttribute("aria-label")).toBe(
      "Scroll tabs right",
    );
    fireEvent.click(overflowButton!);
    expect(scrollBy).toHaveBeenLastCalledWith({
      left: 140,
      behavior: "smooth",
    });

    viewport!.scrollLeft = 360;
    fireEvent.scroll(viewport!);
    act(() => animationFrameCallback?.(0));
    expect(overflowButton?.getAttribute("aria-label")).toBe("Scroll tabs left");
    expect(document.activeElement).toBe(overflowButton);
    fireEvent.click(overflowButton!);
    expect(scrollBy).toHaveBeenLastCalledWith({
      left: -140,
      behavior: "smooth",
    });

    viewport!.scrollLeft = 220;
    fireEvent.scroll(viewport!);
    act(() => animationFrameCallback?.(0));
    expect(overflowButton?.getAttribute("aria-label")).toBe("Scroll tabs left");
    fireEvent.click(overflowButton!);
    expect(scrollBy).toHaveBeenLastCalledWith({
      left: -140,
      behavior: "smooth",
    });

    Object.defineProperty(content!, "scrollWidth", {
      configurable: true,
      value: 100,
    });
    act(() => {
      resizeCallback?.([], {} as ResizeObserver);
    });
    expect(overflowButton?.classList.contains("w-0")).toBe(true);
    expect(overflowButton?.getAttribute("aria-hidden")).toBe("true");
    expect(document.activeElement).toBe(
      container.querySelector('button[aria-pressed="true"]'),
    );
  });
});

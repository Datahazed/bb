// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PromptMentionPreviewTooltip } from "./PromptMentionPreviewTooltip";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function renderPreview(
  content?: string,
  options: { onOuterWheel?: () => void } = {},
) {
  render(
    <div onWheel={options.onOuterWheel}>
      <PromptMentionPreviewTooltip content={content}>
        <span title={content ? undefined : "Plugin: Browser context"}>
          Browser context
        </span>
      </PromptMentionPreviewTooltip>
    </div>,
  );
  return screen.getByText("Browser context");
}

describe("PromptMentionPreviewTooltip", () => {
  it("preserves the existing pill when preview content is absent", () => {
    const trigger = renderPreview();

    expect(trigger.getAttribute("title")).toBe("Plugin: Browser context");
    expect(trigger.getAttribute("tabindex")).toBeNull();
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("shows the complete preview from pointer hover and keyboard focus", async () => {
    const trigger = renderPreview(
      "Target: button.invite\nComment: Keep prominent",
    );

    fireEvent.pointerMove(trigger);
    const pointerTooltip = await screen.findByRole("tooltip");
    expect(pointerTooltip.textContent).toContain(
      "Target: button.invite\nComment: Keep prominent",
    );
    const visibleTooltip = document.querySelector<HTMLElement>(
      '[data-mention-preview-tooltip="true"]',
    );
    expect(visibleTooltip?.className).toContain("bg-popover");
    expect(visibleTooltip?.className).toContain("text-popover-foreground");
    expect(
      document.querySelector('[data-mention-preview-fade="above"]'),
    ).toBeNull();
    expect(
      document.querySelector('[data-mention-preview-fade="below"]'),
    ).toBeNull();

    cleanup();
    const focusTrigger = renderPreview(
      "Target: button.invite\nComment: Keep prominent",
    );
    fireEvent.focus(focusTrigger);
    expect((await screen.findByRole("tooltip")).textContent).toContain(
      "Target: button.invite\nComment: Keep prominent",
    );
    expect(focusTrigger.getAttribute("aria-describedby")).not.toBeNull();
  });

  it("constrains overflowing content, updates boundary fades, and contains scrolling", async () => {
    const animationFrame = vi
      .spyOn(window, "requestAnimationFrame")
      .mockImplementation((callback) => {
        callback(0);
        return 1;
      });
    const outerWheel = vi.fn();
    const trigger = renderPreview(
      Array.from({ length: 30 }, (_, index) => `Target ${index + 1}`).join(
        "\n",
      ),
      { onOuterWheel: outerWheel },
    );
    fireEvent.focus(trigger);
    await screen.findByRole("tooltip");

    const scroll = document.querySelector<HTMLElement>(
      '[data-mention-preview-scroll="true"]',
    );
    expect(scroll).not.toBeNull();
    Object.defineProperties(scroll!, {
      clientHeight: { configurable: true, value: 160 },
      scrollHeight: { configurable: true, value: 520 },
      scrollTop: { configurable: true, value: 0, writable: true },
    });

    fireEvent.scroll(scroll!);
    await waitFor(() =>
      expect(
        document.querySelector('[data-mention-preview-fade="below"]'),
      ).not.toBeNull(),
    );
    expect(
      document.querySelector('[data-mention-preview-fade="below"]')?.className,
    ).toContain("from-popover");
    expect(
      document.querySelector('[data-mention-preview-fade="above"]'),
    ).toBeNull();

    fireEvent.wheel(scroll!, { deltaY: 80 });
    expect(outerWheel).not.toHaveBeenCalled();

    fireEvent.keyDown(trigger, { key: "PageDown" });
    expect(scroll!.scrollTop).toBe(128);
    await waitFor(() =>
      expect(
        document.querySelector('[data-mention-preview-fade="above"]'),
      ).not.toBeNull(),
    );

    fireEvent.keyDown(trigger, { key: "End" });
    expect(scroll!.scrollTop).toBe(360);
    await waitFor(() =>
      expect(
        document.querySelector('[data-mention-preview-fade="below"]'),
      ).toBeNull(),
    );
    animationFrame.mockRestore();
  });
});

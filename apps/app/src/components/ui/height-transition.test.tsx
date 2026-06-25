// @vitest-environment jsdom

import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AutoHeightContainer } from "./height-transition";

class ResizeObserverMock implements ResizeObserver {
  static instances: ResizeObserverMock[] = [];
  private readonly callback: ResizeObserverCallback;
  private readonly targets = new Set<Element>();

  constructor(callback: ResizeObserverCallback) {
    this.callback = callback;
    ResizeObserverMock.instances.push(this);
  }

  observe(target: Element) {
    this.targets.add(target);
  }

  unobserve(target: Element) {
    this.targets.delete(target);
  }

  disconnect() {
    this.targets.clear();
  }

  trigger() {
    const entries = Array.from(this.targets).map(
      (target) =>
        ({
          target,
          contentRect: new DOMRect(
            0,
            0,
            target instanceof HTMLElement ? target.offsetWidth : 0,
            target instanceof HTMLElement ? target.offsetHeight : 0,
          ),
        }) as ResizeObserverEntry,
    );
    this.callback(entries, this);
  }
}

function measuredBox(height: number, label: string) {
  return <div data-measured-height={height}>{label}</div>;
}

describe("AutoHeightContainer", () => {
  beforeEach(() => {
    ResizeObserverMock.instances = [];
    vi.stubGlobal("ResizeObserver", ResizeObserverMock);
    vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(320);
    vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockImplementation(
      function getOffsetHeight(this: HTMLElement) {
        const measuredHeight = this.dataset.measuredHeight;
        if (measuredHeight !== undefined) {
          return Number(measuredHeight);
        }

        return Array.from(this.children).reduce(
          (total, child) =>
            total + (child instanceof HTMLElement ? child.offsetHeight : 0),
          0,
        );
      },
    );
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("reserves footer layout immediately while animating only the row clip", () => {
    const view = render(
      <AutoHeightContainer footer={measuredBox(20, "Working")}>
        {measuredBox(100, "Rows")}
      </AutoHeightContainer>,
    );

    const wrapper = view.container.firstElementChild;
    expect(wrapper).toBeInstanceOf(HTMLElement);
    const rowsClip = wrapper?.firstElementChild;
    expect(rowsClip).toBeInstanceOf(HTMLElement);
    const footer = wrapper?.lastElementChild;
    expect(footer).toBeInstanceOf(HTMLElement);

    expect((wrapper as HTMLElement).style.height).toBe("120px");
    expect((rowsClip as HTMLElement).style.height).toBe("100px");
    expect((rowsClip as HTMLElement).style.bottom).toBe("20px");
    expect((rowsClip as HTMLElement).style.transition).toContain("height");
    expect((footer as HTMLElement).style.bottom).toBe("0px");

    view.rerender(
      <AutoHeightContainer footer={measuredBox(20, "Working")}>
        {measuredBox(160, "Rows")}
      </AutoHeightContainer>,
    );
    ResizeObserverMock.instances[0]?.trigger();

    expect((wrapper as HTMLElement).style.height).toBe("180px");
    expect((rowsClip as HTMLElement).style.height).toBe("160px");
    expect((rowsClip as HTMLElement).style.bottom).toBe("20px");
  });
});

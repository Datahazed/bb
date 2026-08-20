// @vitest-environment jsdom

import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const sidebarMocks = vi.hoisted(() => ({
  scrollElementRef: { current: null as HTMLDivElement | null },
}));

vi.mock("@/components/ui/sidebar.js", () => ({
  useSidebarContentElementRef: () => sidebarMocks.scrollElementRef,
}));

import { SidebarWindowedItems } from "./SidebarWindowedItems";

let observerCallback: IntersectionObserverCallback | null = null;
let observerInstance: IntersectionObserver | null = null;

function setClientHeight(element: HTMLElement, value: number): void {
  Object.defineProperty(element, "clientHeight", {
    configurable: true,
    value,
  });
}

function items(
  itemKeys: readonly string[] = ["first", "second", "third"],
  alwaysMountedKeys?: ReadonlySet<string>,
) {
  return (
    <SidebarWindowedItems
      itemKeys={itemKeys}
      estimateRows={() => 1}
      alwaysMountedKeys={alwaysMountedKeys}
      getNavigationEntries={(index) => [
        { projectId: "proj_test", threadId: `thr_${index}` },
      ]}
      renderItem={(index) => (
        <span data-testid={`real-item-${index}`}>Real item {index}</span>
      )}
    />
  );
}

function renderItems(alwaysMountedKeys?: ReadonlySet<string>) {
  return render(items(undefined, alwaysMountedKeys));
}

function emitIntersection(target: Element, isIntersecting: boolean): void {
  if (observerCallback === null || observerInstance === null) {
    throw new Error("Expected SidebarWindowedItems to create an observer.");
  }
  const rect = target.getBoundingClientRect();
  const entry: IntersectionObserverEntry = {
    boundingClientRect: rect,
    intersectionRatio: isIntersecting ? 1 : 0,
    intersectionRect: isIntersecting ? rect : new DOMRect(),
    isIntersecting,
    rootBounds: new DOMRect(0, 0, 300, 500),
    target,
    time: performance.now(),
  };
  observerCallback([entry], observerInstance);
}

beforeEach(() => {
  observerCallback = null;
  observerInstance = null;

  const scrollElement = document.createElement("div");
  setClientHeight(scrollElement, 500);
  sidebarMocks.scrollElementRef.current = scrollElement;

  vi.stubGlobal(
    "IntersectionObserver",
    class implements IntersectionObserver {
      readonly root = scrollElement;
      readonly rootMargin = "240px 0px";
      readonly scrollMargin = "0px";
      readonly thresholds = [0];

      constructor(callback: IntersectionObserverCallback) {
        observerCallback = callback;
        observerInstance = this;
      }

      observe() {}
      unobserve() {}
      disconnect() {}
      takeRecords(): IntersectionObserverEntry[] {
        return [];
      }
    },
  );

  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
    function (this: HTMLElement) {
      if (this === scrollElement) {
        return new DOMRect(0, 0, 300, 500);
      }
      if (this.hasAttribute("data-sidebar-windowed-item")) {
        return new DOMRect(0, 1_000, 300, 30);
      }
      return new DOMRect();
    },
  );
});

afterEach(() => {
  cleanup();
  document.body.replaceChildren();
  sidebarMocks.scrollElementRef.current = null;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("SidebarWindowedItems", () => {
  it("windows a short list when every item is outside the viewport margin", () => {
    renderItems();

    expect(screen.queryByTestId("real-item-0")).toBeNull();
    expect(
      document.querySelectorAll("[data-sidebar-windowed-item]"),
    ).toHaveLength(3);
    expect(
      document.querySelectorAll("[data-sidebar-windowed-nav]"),
    ).toHaveLength(3);
  });

  it("keeps placeholders while a newly mounted scrollport ref attaches", () => {
    sidebarMocks.scrollElementRef.current = null;

    renderItems();

    expect(screen.queryByTestId("real-item-0")).toBeNull();
    expect(
      document.querySelectorAll("[data-sidebar-windowed-item]:empty"),
    ).toHaveLength(3);
  });

  it("keeps placeholders for a connected scrollport with transient zero-height geometry", () => {
    const scrollElement = sidebarMocks.scrollElementRef.current;
    if (scrollElement === null) {
      throw new Error("Expected a scroll element.");
    }
    document.body.append(scrollElement);
    setClientHeight(scrollElement, 0);

    renderItems();

    expect(screen.queryByTestId("real-item-0")).toBeNull();
    expect(observerInstance?.root).toBe(scrollElement);
  });

  it("renders every item for a detached zero-height preview", () => {
    const scrollElement = sidebarMocks.scrollElementRef.current;
    if (scrollElement === null) {
      throw new Error("Expected a scroll element.");
    }
    setClientHeight(scrollElement, 0);

    renderItems();

    expect(screen.getByTestId("real-item-0")).toBeTruthy();
    expect(screen.getByTestId("real-item-1")).toBeTruthy();
    expect(screen.getByTestId("real-item-2")).toBeTruthy();
  });

  it("does not promote vertically overlapping rows inside a closed compact drawer", () => {
    const scrollElement = sidebarMocks.scrollElementRef.current;
    if (scrollElement === null) {
      throw new Error("Expected a scroll element.");
    }
    const panel = document.createElement("aside");
    panel.dataset.sidebar = "panel";
    panel.dataset.state = "closed";
    panel.append(scrollElement);
    document.body.append(panel);
    vi.mocked(HTMLElement.prototype.getBoundingClientRect).mockImplementation(
      function (this: HTMLElement) {
        if (this === scrollElement) {
          return new DOMRect(0, 0, 300, 500);
        }
        if (this.hasAttribute("data-sidebar-windowed-item")) {
          return new DOMRect(0, 100, 300, 30);
        }
        return new DOMRect();
      },
    );

    renderItems(new Set(["second"]));

    expect(screen.queryByTestId("real-item-0")).toBeNull();
    expect(screen.getByTestId("real-item-1")).toBeTruthy();
    expect(screen.queryByTestId("real-item-2")).toBeNull();
  });

  it("retains realized rows without promoting new rows after the drawer closes", () => {
    const scrollElement = sidebarMocks.scrollElementRef.current;
    if (scrollElement === null) {
      throw new Error("Expected a scroll element.");
    }
    const panel = document.createElement("aside");
    panel.dataset.sidebar = "panel";
    panel.dataset.state = "open";
    panel.append(scrollElement);
    document.body.append(panel);
    vi.mocked(HTMLElement.prototype.getBoundingClientRect).mockImplementation(
      function (this: HTMLElement) {
        if (this === scrollElement) {
          return new DOMRect(0, 0, 300, 500);
        }
        if (this.hasAttribute("data-sidebar-windowed-item")) {
          return new DOMRect(0, 100, 300, 30);
        }
        return new DOMRect();
      },
    );

    const view = renderItems();
    expect(screen.getByTestId("real-item-0")).toBeTruthy();
    expect(screen.getByTestId("real-item-2")).toBeTruthy();

    panel.dataset.state = "closed";
    view.rerender(items(["first", "second", "third", "fourth"]));

    expect(screen.getByTestId("real-item-0")).toBeTruthy();
    expect(screen.getByTestId("real-item-2")).toBeTruthy();
    expect(screen.queryByTestId("real-item-3")).toBeNull();
  });

  it("realizes visible content after a closed drawer reopens", async () => {
    const scrollElement = sidebarMocks.scrollElementRef.current;
    if (scrollElement === null) {
      throw new Error("Expected a scroll element.");
    }
    const panel = document.createElement("aside");
    panel.dataset.sidebar = "panel";
    panel.dataset.state = "closed";
    panel.append(scrollElement);
    document.body.append(panel);

    renderItems();

    const firstWrapper = document.querySelector<HTMLElement>(
      "[data-sidebar-windowed-item]",
    );
    if (firstWrapper === null) {
      throw new Error("Expected the first windowed wrapper.");
    }
    expect(screen.queryByTestId("real-item-0")).toBeNull();

    panel.dataset.state = "open";
    await act(async () => emitIntersection(firstWrapper, true));

    expect(screen.getByTestId("real-item-0")).toBeTruthy();
    expect(screen.queryByTestId("real-item-1")).toBeNull();
  });
});

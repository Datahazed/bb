// @vitest-environment jsdom

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  PluginBrowseCategoryFilter,
  type PluginBrowseCategoryOption,
} from "./PluginBrowseControls";

const OPTIONS: PluginBrowseCategoryOption[] = [
  { id: "memory-and-context", label: "Memory & Context", count: 4 },
  { id: "security", label: "Security", count: 2 },
  { id: "tasks-workflows", label: "Tasks & Workflows", count: 7 },
];

function renderFilter(
  overrides: Partial<
    React.ComponentProps<typeof PluginBrowseCategoryFilter>
  > = {},
) {
  const onChange = vi.fn();
  const result = render(
    <PluginBrowseCategoryFilter
      options={OPTIONS}
      value={null}
      totalCount={13}
      onChange={onChange}
      {...overrides}
    />,
  );
  return { onChange, ...result };
}

function openMenu(selectionLabel: string) {
  fireEvent.click(
    screen.getByRole("button", {
      name: `Filter plugins by category: ${selectionLabel}`,
    }),
  );
}

function categoryList(): HTMLElement {
  return screen.getByRole("listbox", { name: "Plugin categories" });
}

function setScrollMetrics(
  element: HTMLElement,
  metrics: { clientHeight: number; scrollHeight: number; scrollTop: number },
) {
  Object.defineProperties(element, {
    clientHeight: { configurable: true, value: metrics.clientHeight },
    scrollHeight: { configurable: true, value: metrics.scrollHeight },
    scrollTop: { configurable: true, value: metrics.scrollTop, writable: true },
  });
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("PluginBrowseCategoryFilter", () => {
  it("lists the taxonomy without a category-count label", () => {
    renderFilter();
    openMenu("All categories");

    expect(screen.getAllByRole("option")).toHaveLength(OPTIONS.length + 1);
    expect(screen.queryByText(/^\d+ categories$/u)).toBeNull();
    expect(screen.getByRole("option", { name: /Security/u })).toBeTruthy();
  });

  it("clears the filter when the active category is chosen again", () => {
    const { onChange } = renderFilter({ value: "security" });
    openMenu("Security");

    const active = screen.getByRole("option", { name: /Security/u });
    expect(active.getAttribute("aria-selected")).toBe("true");

    fireEvent.click(active);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(null);
  });

  it("still selects a different category and the explicit All row", () => {
    const { onChange } = renderFilter({ value: "security" });
    openMenu("Security");
    fireEvent.click(screen.getByRole("option", { name: /Tasks & Workflows/u }));
    expect(onChange).toHaveBeenCalledWith("tasks-workflows");

    onChange.mockClear();
    openMenu("Security");
    fireEvent.click(screen.getByRole("option", { name: /All categories/u }));
    expect(onChange).toHaveBeenCalledWith(null);
  });

  it("keeps keyboard traversal and toggle-off on the focused option", () => {
    const { onChange } = renderFilter({ value: "tasks-workflows" });
    openMenu("Tasks & Workflows");

    const search = screen.getByRole("combobox", {
      name: "Search plugin categories",
    });
    fireEvent.keyDown(search, { key: "ArrowDown" });
    expect(document.activeElement?.textContent).toContain("All categories");

    fireEvent.keyDown(document.activeElement as HTMLElement, { key: "End" });
    const last = document.activeElement as HTMLElement;
    expect(last.textContent).toContain("Tasks & Workflows");
    expect(last.getAttribute("aria-selected")).toBe("true");

    fireEvent.click(last);
    expect(onChange).toHaveBeenCalledWith(null);
  });

  it("reveals the scrollbar only while the list is scrolling", () => {
    vi.useFakeTimers();
    renderFilter();
    openMenu("All categories");

    const list = categoryList();
    expect(list.className).toContain("transient-scrollbar");
    expect(list.hasAttribute("data-scrollbar-scrolling")).toBe(false);

    setScrollMetrics(list, {
      clientHeight: 100,
      scrollHeight: 400,
      scrollTop: 0,
    });
    fireEvent.scroll(list);
    expect(list.dataset.scrollbarScrolling).toBe("true");

    act(() => {
      vi.advanceTimersByTime(599);
    });
    expect(list.dataset.scrollbarScrolling).toBe("true");

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(list.hasAttribute("data-scrollbar-scrolling")).toBe(false);
  });

  it("fades the list bottom only while content remains below", async () => {
    renderFilter();
    openMenu("All categories");

    const list = categoryList();
    const fade = () => document.querySelector("[data-category-list-fade]");

    setScrollMetrics(list, {
      clientHeight: 400,
      scrollHeight: 400,
      scrollTop: 0,
    });
    fireEvent.scroll(list);
    await waitFor(() => {
      expect(fade()).toBeNull();
    });

    setScrollMetrics(list, {
      clientHeight: 100,
      scrollHeight: 400,
      scrollTop: 0,
    });
    fireEvent.scroll(list);
    await waitFor(() => {
      expect(fade()).not.toBeNull();
    });
    expect(fade()?.className).toContain("from-popover/90");

    list.scrollTop = 300;
    fireEvent.scroll(list);
    await waitFor(() => {
      expect(fade()).toBeNull();
    });
  });
});

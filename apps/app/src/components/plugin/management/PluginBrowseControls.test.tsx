// @vitest-environment jsdom

import { useState } from "react";
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
    Extract<
      React.ComponentProps<typeof PluginBrowseCategoryFilter>,
      { selectionMode: "single" }
    >
  > = {},
) {
  const onChange = vi.fn();
  const props = {
    selectionMode: "single",
    options: OPTIONS,
    value: null,
    onChange,
    ...overrides,
  } satisfies Extract<
    React.ComponentProps<typeof PluginBrowseCategoryFilter>,
    { selectionMode: "single" }
  >;
  const result = render(<PluginBrowseCategoryFilter {...props} />);
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
  it("fills the trigger only when a category filter is active", () => {
    const { rerender } = renderFilter();
    const defaultTrigger = screen.getByRole("button", {
      name: "Filter plugins by category: All categories",
    });

    expect(defaultTrigger.classList.contains("bg-state-active")).toBe(false);

    rerender(
      <PluginBrowseCategoryFilter
        selectionMode="single"
        options={OPTIONS}
        value="security"
        onChange={vi.fn()}
      />,
    );
    const activeTrigger = screen.getByRole("button", {
      name: "Filter plugins by category: Security",
    });

    expect(activeTrigger.classList.contains("bg-state-active")).toBe(true);
    expect(activeTrigger.classList.contains("text-foreground")).toBe(true);
  });

  it("lists the taxonomy without a category-count label", () => {
    renderFilter();
    openMenu("All categories");

    expect(screen.getAllByRole("option")).toHaveLength(OPTIONS.length);
    expect(screen.queryByText(/^\d+ categories$/u)).toBeNull();
    expect(
      screen.queryByRole("option", { name: /All categories/u }),
    ).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Clear filter" }),
    ).toBeNull();
    const security = screen.getByRole("option", { name: /Security/u });
    const count = security.querySelector("[data-category-option-count]");
    expect(count?.textContent).toBe("2");
    expect(count?.classList.contains("rounded-full")).toBe(true);
    expect(count?.classList.contains("p-1.5")).toBe(true);
    expect(count?.classList.contains("bg-surface-recessed")).toBe(true);
    expect(security.children[0]?.classList.contains("w-8")).toBe(true);
    expect(security.children[1]?.textContent).toBe("Security");
    expect(
      security.querySelector("[data-category-option-checkbox]")?.getAttribute(
        "data-state",
      ),
    ).toBe("disabled");
    const search = screen.getByRole("combobox", {
      name: "Search plugin categories",
    });
    expect(search.parentElement?.classList.contains("mx-2.5")).toBe(true);
    expect(search.parentElement?.classList.contains("mt-1.5")).toBe(true);
  });

  it("clears the filter when the active category is chosen again", () => {
    const { onChange } = renderFilter({ value: "security" });
    openMenu("Security");

    const active = screen.getByRole("option", { name: /Security/u });
    expect(active.getAttribute("aria-selected")).toBe("true");
    expect(
      active
        .querySelector("[data-category-option-checkbox]")
        ?.getAttribute("data-state"),
    ).toBe("enabled");

    fireEvent.click(active);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(null);
  });

  it("selects a different category and clears from the footer", () => {
    const { onChange } = renderFilter({ value: "security" });
    openMenu("Security");
    expect(
      screen.getByRole("button", { name: "Clear filter" }),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("option", { name: /Tasks & Workflows/u }));
    expect(onChange).toHaveBeenCalledWith("tasks-workflows");

    onChange.mockClear();
    openMenu("Security");
    fireEvent.click(screen.getByRole("button", { name: "Clear filter" }));
    expect(onChange).toHaveBeenCalledWith(null);
  });

  it("keeps a multi-select menu open while categories are toggled", () => {
    function MultiSelectHarness() {
      const [value, setValue] = useState<string[]>([]);
      return (
        <PluginBrowseCategoryFilter
          selectionMode="multiple"
          options={OPTIONS}
          value={value}
          onChange={setValue}
        />
      );
    }
    render(<MultiSelectHarness />);
    openMenu("All categories");

    fireEvent.click(screen.getByRole("option", { name: /Security/u }));
    expect(categoryList()).toBeTruthy();
    fireEvent.click(
      screen.getByRole("option", { name: /Tasks & Workflows/u }),
    );

    expect(categoryList().getAttribute("aria-multiselectable")).toBe("true");
    expect(
      screen
        .getByRole("option", { name: /Security/u })
        .getAttribute("aria-selected"),
    ).toBe("true");
    expect(
      screen
        .getByRole("option", { name: /Tasks & Workflows/u })
        .getAttribute("aria-selected"),
    ).toBe("true");
    expect(
      screen.getByRole("button", {
        name: "Filter plugins by category: Security, Tasks & Workflows",
      }).textContent,
    ).toContain("2 categories");

    fireEvent.click(screen.getByRole("button", { name: "Clear filter" }));
    expect(
      screen.getByRole("button", {
        name: "Filter plugins by category: All categories",
      }),
    ).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: "Clear filter" }),
    ).toBeNull();
  });

  it("keeps keyboard traversal and toggle-off on the focused option", () => {
    const { onChange } = renderFilter({ value: "tasks-workflows" });
    openMenu("Tasks & Workflows");

    const search = screen.getByRole("combobox", {
      name: "Search plugin categories",
    });
    fireEvent.keyDown(search, { key: "ArrowDown" });
    expect(document.activeElement?.textContent).toContain("Memory & Context");

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
    expect(list.className).toContain("max-h-60");

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
    expect(fade()?.className).toContain("h-10");
    expect(fade()?.className).toContain("from-popover/90");

    list.scrollTop = 300;
    fireEvent.scroll(list);
    await waitFor(() => {
      expect(fade()).toBeNull();
    });
  });
});

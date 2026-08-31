// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import type { ReactElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NO_COLLAPSED_CHILD_ACTIVITY } from "@bb/client-core";
import { TooltipProvider } from "@bb/shared-ui/tooltip";
import { splitLayoutAtom } from "@/lib/split-layout/atoms";
import { SPLIT_LAYOUT_STORAGE_KEY } from "@/lib/split-layout/persistence";
import {
  resetPluginThreadRowStatusesForTest,
  setPluginThreadRowStatus,
} from "@/lib/plugin-thread-row-status";
import { SidebarSectionRow } from "./SidebarSectionRow";

function renderSectionRow(ui: ReactElement) {
  return render(<TooltipProvider>{ui}</TooltipProvider>);
}

afterEach(() => {
  cleanup();
  resetPluginThreadRowStatusesForTest();
  window.localStorage.removeItem(SPLIT_LAYOUT_STORAGE_KEY);
  window.sessionStorage.removeItem(SPLIT_LAYOUT_STORAGE_KEY);
});

describe("SidebarSectionRow", () => {
  it("keeps the disclosure in the fixed final slot after section actions", () => {
    const onCreateThread = vi.fn();
    const result = renderSectionRow(
      <SidebarSectionRow
        name="Nested work"
        label="Nested work"
        depth={1}
        activity={NO_COLLAPSED_CHILD_ACTIVITY}
        isCollapsed={false}
        onToggleCollapsed={vi.fn()}
        onRename={vi.fn()}
        onCreateThread={onCreateThread}
      />,
    );

    const disclosure = screen.getByRole("button", {
      name: "Collapse Nested work section",
    });
    const icon = result.container.querySelector('[data-icon="ListView"]');
    const label = screen.getByText("Nested work");
    const row = label.parentElement?.parentElement as HTMLElement | null;
    const caretSlot = disclosure.closest("[data-sidebar-collapse-caret-slot]");
    const newThread = screen.getByRole("button", {
      name: "New thread in Nested work",
    });
    const more = screen.getByRole("button", {
      name: "Nested work section actions",
    });
    const trailingControls = row?.querySelector(
      "[data-sidebar-collapsible-trailing-controls]",
    );
    const mobileStatusSlot = trailingControls?.querySelector(
      "[data-sidebar-mobile-status-slot]",
    );
    const mobileActions = more.closest(
      "[data-sidebar-hover-actions-mobile]",
    );

    expect(icon).toBeNull();
    expect(
      label.compareDocumentPosition(disclosure) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).not.toBe(0);
    expect(row?.style.paddingLeft).toBe("32px");
    expect(caretSlot?.classList.contains("w-6")).toBe(true);
    expect(row?.lastElementChild).toBe(caretSlot);
    expect(trailingControls?.nextElementSibling).toBe(caretSlot);
    expect(mobileStatusSlot).not.toBeNull();
    expect(
      mobileStatusSlot!.compareDocumentPosition(more) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).not.toBe(0);
    expect(newThread.classList.contains("max-md:pointer-coarse:hidden")).toBe(
      true,
    );
    expect(mobileActions?.getAttribute("data-sidebar-hover-actions-mobile")).toBe(
      "always",
    );
    expect(
      newThread.compareDocumentPosition(more) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).not.toBe(0);
    expect(
      more.compareDocumentPosition(disclosure) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).not.toBe(0);
  });

  it("keeps New thread reachable from the section overflow on mobile", async () => {
    const onCreateThread = vi.fn();
    renderSectionRow(
      <SidebarSectionRow
        name="Nested work"
        label="Nested work"
        depth={1}
        activity={NO_COLLAPSED_CHILD_ACTIVITY}
        isCollapsed={false}
        onToggleCollapsed={vi.fn()}
        onRename={vi.fn()}
        onCreateThread={onCreateThread}
      />,
    );

    fireEvent.pointerDown(
      screen.getByRole("button", { name: "Nested work section actions" }),
      { button: 0 },
    );
    fireEvent.click(
      await screen.findByRole("menuitem", { name: "New thread" }),
    );

    expect(onCreateThread).toHaveBeenCalledTimes(1);
  });

  it("rolls hidden split threads up to the collapsed section row", () => {
    const store = createStore();
    store.set(splitLayoutAtom, {
      focusedPaneId: "pane-second-thread",
      root: {
        type: "split",
        dir: "row",
        sizes: [0.34, 0.33, 0.33],
        children: [
          {
            type: "pane",
            paneId: "pane-first-thread",
            content: {
              kind: "thread",
              projectId: "project-one",
              threadId: "thread-one",
            },
          },
          {
            type: "pane",
            paneId: "pane-compose",
            content: { kind: "new-thread", draftSlotId: "draft-compose" },
          },
          {
            type: "pane",
            paneId: "pane-second-thread",
            content: {
              kind: "thread",
              projectId: "project-two",
              threadId: "thread-two",
            },
          },
        ],
      },
    });

    renderSectionRow(
      <Provider store={store}>
        <SidebarSectionRow
          name="Build"
          label="Work / Build"
          depth={1}
          activity={{
            ...NO_COLLAPSED_CHILD_ACTIVITY,
            pending: true,
          }}
          collapsedThreads={[
            { id: "thread-one", projectId: "project-one" },
            { id: "thread-two", projectId: "project-two" },
          ]}
          isCollapsed
          onToggleCollapsed={vi.fn()}
        />
      </Provider>,
    );

    const splitMaps = screen.getAllByRole("img", {
      name: "Work / Build — contains a thread open in split",
    });
    const splitMap = splitMaps[0];
    if (!splitMap) {
      throw new Error("Expected a collapsed split mini-map");
    }
    const slots = splitMap.querySelectorAll("rect");

    expect(slots).toHaveLength(3);
    expect(slots[0]?.getAttribute("class")).toContain("fill-muted-foreground");
    expect(slots[1]?.getAttribute("class")).toContain("fill-none");
    expect(slots[2]?.getAttribute("class")).toContain("fill-primary");
    expect(screen.queryByLabelText("Thread needs user input")).toBeNull();
  });

  it("rolls a hidden plugin status up to the collapsed section row", () => {
    setPluginThreadRowStatus("thread-one", "prompt-shaper", {
      icon: "AiContentGenerator01",
      label: "Plugin improving draft",
      tone: "running",
    });

    renderSectionRow(
      <SidebarSectionRow
        name="Building"
        label="Work / Building"
        depth={1}
        activity={NO_COLLAPSED_CHILD_ACTIVITY}
        collapsedThreads={[{ id: "thread-one", projectId: "project-one" }]}
        isCollapsed
        onToggleCollapsed={vi.fn()}
      />,
    );

    expect(screen.getAllByLabelText("Plugin improving draft")).not.toHaveLength(
      0,
    );
  });
});

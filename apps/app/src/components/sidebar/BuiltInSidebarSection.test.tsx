// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  renderBuiltInSidebarSection,
  type BuiltInSidebarSectionOptionsById,
} from "./BuiltInSidebarSection";
import { NO_COLLAPSED_CHILD_ACTIVITY } from "@bb/client-core";
import { SIDEBAR_HOVER_ACTIONS_CLASS } from "@/components/ui/sidebar-hover-actions";

const SECTIONS: BuiltInSidebarSectionOptionsById = {
  pinned: {
    label: "Pinned",
    content: <div>Pinned content</div>,
  },
  threads: {
    label: "Threads",
    content: <div>Threads content</div>,
  },
};

function BuiltInSectionsProbe({ showPinned }: { showPinned: boolean }) {
  const sharedProps = {
    sections: SECTIONS,
    disabled: true,
    collapsedSectionIds: new Set<"pinned" | "threads">(),
    onToggleCollapsed: vi.fn(),
    showPinnedSection: showPinned,
  };

  return (
    <>
      {renderBuiltInSidebarSection({
        ...sharedProps,
        sectionId: "pinned",
      })}
      {renderBuiltInSidebarSection({
        ...sharedProps,
        sectionId: "threads",
      })}
    </>
  );
}

afterEach(() => cleanup());

describe("built-in sidebar section renderer", () => {
  it("hides Pinned without hiding Threads, then restores Pinned", () => {
    const result = render(<BuiltInSectionsProbe showPinned={false} />);

    expect(screen.queryByText("Pinned content")).toBeNull();
    expect(screen.getByText("Threads content")).not.toBeNull();

    result.rerender(<BuiltInSectionsProbe showPinned />);

    expect(screen.getByText("Pinned content")).not.toBeNull();
    expect(screen.getByText("Threads content")).not.toBeNull();
    expect(result.container.querySelector('[data-icon="Pin"]')).toBeNull();
  });

  it("uses the shared sticky tier and keeps only Threads actions visible at rest", () => {
    render(
      <>
        {renderBuiltInSidebarSection({
          collapsedSectionIds: new Set(),
          disabled: true,
          onToggleCollapsed: vi.fn(),
          sectionId: "pinned",
          sections: {
            pinned: {
              ...SECTIONS.pinned,
              actions: <button type="button">Pinned action</button>,
            },
            threads: {
              ...SECTIONS.threads,
              actions: <button type="button">Threads action</button>,
            },
          },
          showPinnedSection: true,
        })}
        {renderBuiltInSidebarSection({
          collapsedSectionIds: new Set(),
          disabled: true,
          onToggleCollapsed: vi.fn(),
          sectionId: "threads",
          sections: {
            pinned: {
              ...SECTIONS.pinned,
              actions: <button type="button">Pinned action</button>,
            },
            threads: {
              ...SECTIONS.threads,
              actions: <button type="button">Threads action</button>,
            },
          },
          showPinnedSection: true,
        })}
      </>,
    );

    const pinnedActionContainer = screen.getByRole("button", {
      name: "Pinned action",
    }).parentElement;
    const threadsActionContainer = screen.getByRole("button", {
      name: "Threads action",
    }).parentElement;
    const threadsTier = screen
      .getByTitle("Threads")
      .closest('[data-sidebar-sticky-tier="label"]');
    const threadsGroup = threadsTier?.closest("[data-sidebar-sticky-group]");

    expect(threadsTier).not.toBeNull();
    expect(threadsGroup).not.toBeNull();
    expect(
      pinnedActionContainer?.classList.contains(SIDEBAR_HOVER_ACTIONS_CLASS),
    ).toBe(true);
    expect(
      threadsActionContainer?.classList.contains(SIDEBAR_HOVER_ACTIONS_CLASS),
    ).toBe(false);
  });

  it("surfaces shared activity when Threads is collapsed", () => {
    render(
      renderBuiltInSidebarSection({
        collapsedSectionIds: new Set(["threads"]),
        disabled: true,
        onToggleCollapsed: vi.fn(),
        sectionId: "threads",
        sections: {
          ...SECTIONS,
          threads: {
            ...SECTIONS.threads,
            activity: {
              ...NO_COLLAPSED_CHILD_ACTIVITY,
              goal: true,
              working: true,
            },
          },
        },
        showPinnedSection: false,
      }),
    );

    expect(screen.queryByText("Threads content")).toBeNull();
    expect(screen.getAllByLabelText("Goal active")).not.toHaveLength(0);
  });

  it("renders loose Threads after a stable divider without a collapse caret", () => {
    const { container } = render(
      renderBuiltInSidebarSection({
        collapsedSectionIds: new Set(),
        disabled: true,
        onToggleCollapsed: vi.fn(),
        sectionId: "threads",
        sections: {
          ...SECTIONS,
          threads: {
            ...SECTIONS.threads,
            presentation: "loose",
            showLooseHeading: true,
          },
        },
        showPinnedSection: false,
      }),
    );

    expect(
      container.querySelector("[data-sidebar-loose-thread-group]"),
    ).not.toBeNull();
    expect(screen.getByText("Threads")).not.toBeNull();
    expect(container.querySelector("[data-sidebar-collapse-caret]")).toBeNull();
  });
});

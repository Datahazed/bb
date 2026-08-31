// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProjectListActionButtons } from "./ProjectList";

vi.mock("@/components/commands/AppCommandProvider", () => ({
  useAppCommandShortcut: (command: string) =>
    command === "thread.search"
      ? { label: "⌘ K", ariaKeyshortcuts: "Meta+K" }
      : { label: "⇧ ⌘ O", ariaKeyshortcuts: "Meta+Shift+O" },
  useIsAppCommandModifierHeld: () => false,
}));

vi.mock("./paneContentSplitIndicator", () => ({
  useNewThreadSplitIndicator: () => ({
    isOpenInSplit: false,
    miniMap: null,
  }),
}));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("ProjectListActionButtons", () => {
  it("keeps Search threads directly below New thread with a persistent shortcut", () => {
    const onSearchThreads = vi.fn();

    render(
      <ProjectListActionButtons
        onNewChat={vi.fn()}
        onSearchThreads={onSearchThreads}
      />,
    );

    const buttons = screen.getAllByRole("button");
    const newThreadButton = screen.getByRole("button", {
      name: "New thread (⇧ ⌘ O)",
    });
    const searchThreadsButton = screen.getByRole("button", {
      name: "Search threads (⌘ K)",
    });

    expect(buttons).toEqual([newThreadButton, searchThreadsButton]);
    expect(searchThreadsButton).toHaveAttribute("aria-keyshortcuts", "Meta+K");
    expect(screen.getByText("⌘ K", { selector: "kbd" })).toBeVisible();
    expect(
      screen.queryByText("⇧ ⌘ O", { selector: "kbd" }),
    ).not.toBeInTheDocument();

    fireEvent.click(searchThreadsButton);
    expect(onSearchThreads).toHaveBeenCalledWith(searchThreadsButton);
  });

  it("styles the split affordance like the shortcut accessory pill", () => {
    render(
      <ProjectListActionButtons
        onNewChat={vi.fn()}
        onSearchThreads={vi.fn()}
        onSplit={vi.fn()}
      />,
    );

    const splitButton = screen.getByRole("button", { name: "Split" });
    const splitPill = splitButton.querySelector("span");
    const shortcutPill = screen.getByText("⌘ K", { selector: "kbd" });

    expect(splitPill).not.toBeNull();
    expect(splitPill).toHaveClass("rounded-sm", "bg-state-hover", "opacity-60");
    expect(shortcutPill).toHaveClass(
      "rounded-sm",
      "bg-state-hover",
      "opacity-60",
    );
  });
});

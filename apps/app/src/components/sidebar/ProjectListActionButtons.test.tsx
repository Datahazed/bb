// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProjectListSearchThreadsAction } from "./ProjectList";

const mocks = vi.hoisted(() => ({
  dispatch: vi.fn(),
}));

vi.mock("@/components/commands/AppCommandProvider", () => ({
  useAppCommandRunner: () => ({
    dispatch: mocks.dispatch,
    isCommandAvailable: () => true,
  }),
  useAppCommandShortcut: (command: string) =>
    command === "thread.search"
      ? { ariaKeyshortcuts: "Meta+K", label: "⌘K" }
      : null,
  useIsAppCommandModifierHeld: () => false,
}));

afterEach(() => {
  cleanup();
  mocks.dispatch.mockReset();
});

describe("ProjectListSearchThreadsAction", () => {
  it("keeps the trailing Search shortcut visible without changing activation", () => {
    const onSearchThreads = vi.fn();
    render(
      <ProjectListSearchThreadsAction onSearchThreads={onSearchThreads} />,
    );

    const button = screen.getByRole("button", {
      name: "Search threads (⌘K)",
    });
    const shortcut = screen.getByText("⌘K");
    const label = screen.getByText("Search threads");

    expect(button.getAttribute("aria-keyshortcuts")).toBe("Meta+K");
    expect(shortcut.tagName).toBe("KBD");
    expect(shortcut.getAttribute("aria-hidden")).toBe("true");
    expect(label.classList.contains("flex-1")).toBe(true);
    expect(shortcut.parentElement?.lastElementChild).toBe(shortcut);
    expect(button.classList.contains("[&_kbd]:opacity-60")).toBe(true);
    expect(button.classList.contains("pr-1")).toBe(true);

    fireEvent.click(button);

    expect(onSearchThreads).toHaveBeenCalledOnce();
    expect(mocks.dispatch).toHaveBeenCalledWith("thread.search", button);
  });
});

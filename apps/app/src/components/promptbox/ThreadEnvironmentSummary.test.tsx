// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { TooltipProvider } from "@bb/shared-ui/tooltip";
import { afterEach, describe, expect, it, vi } from "vitest";
import { formatWorkspaceCheckoutDisplay } from "@/lib/workspace-checkout-display";
import { ThreadEnvironmentSummary } from "./ThreadEnvironmentSummary";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function renderSummary(props: Parameters<typeof ThreadEnvironmentSummary>[0]) {
  return render(
    <TooltipProvider delayDuration={0}>
      <ThreadEnvironmentSummary {...props} />
    </TooltipProvider>,
  );
}

function mockTruncation(attribute: string, truncated: boolean): void {
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockImplementation(
    function clientWidth(this: HTMLElement) {
      return this.hasAttribute(attribute) ? 100 : 0;
    },
  );
  vi.spyOn(HTMLElement.prototype, "scrollWidth", "get").mockImplementation(
    function scrollWidth(this: HTMLElement) {
      return this.hasAttribute(attribute) && truncated ? 200 : 100;
    },
  );
}

describe("ThreadEnvironmentSummary", () => {
  it("keeps worktree, machine, and branch context distinct", async () => {
    renderSummary({
      environmentLabel: "Design system polish",
      environmentIcon: "FolderGit",
      environmentTypeLabel: "Worktree",
      machineName: "Build Mac mini",
      environmentCheckout: formatWorkspaceCheckoutDisplay({
        checkout: {
          kind: "branch",
          branchName: "bb/design-system-polish",
          headSha: null,
        },
      }),
    });

    expect(screen.getByText("Design system polish")).toBeTruthy();
    expect(screen.getByText("Build Mac mini")).toBeTruthy();
    expect(
      screen.getByRole("button", {
        name: "Copy branch name: bb/design-system-polish",
      }),
    ).toBeTruthy();

    fireEvent.focus(screen.getByRole("img", { name: "Worktree" }));
    expect((await screen.findByRole("tooltip")).textContent).toBe("Worktree");
  });

  it("does not add a tooltip or focus stop to a fitting machine name", () => {
    mockTruncation("data-machine-name-text", false);
    renderSummary({ machineName: "Build Mac mini" });

    const machineName = screen.getByLabelText("Machine: Build Mac mini");
    expect(machineName.getAttribute("tabindex")).toBeNull();
    fireEvent.pointerEnter(machineName);
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("separates offline status from a truncated machine-name tooltip", async () => {
    mockTruncation("data-machine-name-text", true);
    renderSummary({
      machineName: "Bersabel's remote build MacBook Pro",
      machineConnected: false,
    });

    const offline = screen.getByRole("img", { name: "Offline" });
    fireEvent.focus(offline);
    expect((await screen.findByRole("tooltip")).textContent).toBe("Offline");

    fireEvent.blur(offline);
    await waitFor(() => expect(screen.queryByRole("tooltip")).toBeNull());
    fireEvent.focus(
      screen.getByLabelText(
        "Machine: Bersabel's remote build MacBook Pro, offline",
      ),
    );
    expect((await screen.findByRole("tooltip")).textContent).toBe(
      "Bersabel's remote build MacBook Pro",
    );
  });

  it("uses the machine fallback without losing unnamed worktree identity", () => {
    const { container } = renderSummary({
      environmentLabel: "Bersabel's MacBook Pro",
      environmentIcon: "FolderGit",
      environmentTypeLabel: "Worktree",
    });

    expect(screen.queryByText("Unnamed")).toBeNull();
    expect(container.querySelector('[data-icon="FolderGit"]')).not.toBeNull();
    expect(screen.getByRole("img", { name: "Worktree" })).toBeTruthy();
    expect(screen.queryByRole("img", { name: "Machine" })).toBeNull();
  });

  it("keeps the create-thread action available", async () => {
    renderSummary({ onCreateNewThreadInWorktree: vi.fn() });

    const action = screen.getByRole("button", {
      name: "Create thread in worktree",
    });
    fireEvent.focus(action);
    expect((await screen.findByRole("tooltip")).textContent).toBe(
      "Create thread in worktree",
    );
  });
});

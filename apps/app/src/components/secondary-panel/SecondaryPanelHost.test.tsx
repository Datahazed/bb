// @vitest-environment jsdom

import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  BbDesktopCloseWindowRequestHandler,
  BbDesktopOpenNewTabHandler,
} from "@bb/desktop-contract";
import { AppCommandProvider } from "@/components/commands/AppCommandProvider";
import { createBbDesktopApi } from "@/test/bb-desktop-test-utils";
import { SecondaryPanelCommandHandlers } from "./SecondaryPanelHost";

const commandFixture = vi.hoisted(() => {
  const shortcutKeys = {
    "diff.toggle": "d",
    "file.quickOpen": "o",
    "panel.close": "w",
    "panel.newTab": "t",
    "panel.toggle": "p",
    "terminal.open": "j",
    "workspace.openPreferred": "e",
  } as const;
  const commands = Object.keys(shortcutKeys) as (keyof typeof shortcutKeys)[];
  return {
    keybindings: commands.map((command) => ({
      command,
      desktopOnly: false,
      shortcut: {
        key: shortcutKeys[command],
        mod: true,
        meta: false,
        control: false,
        alt: false,
        shift: false,
      },
      when: { all: ["mainSurface" as const], none: [] },
    })),
    shortcutKeys,
  };
});

type RoutedCommand = keyof typeof commandFixture.shortcutKeys;

vi.mock("@/hooks/queries/system-queries", () => ({
  useSystemConfig: () => ({
    data: {
      generalSettings: {
        showKeyboardHints: false,
      },
      keybindings: commandFixture.keybindings,
    },
  }),
}));

const desktopInfo = {
  lastCheckedAt: null,
  latestVersion: null,
  pendingVersion: null,
  platform: "macos" as const,
  updateAvailable: false,
  updateDownloaded: false,
  version: "0.0.0-test",
};

function dispatchCommandShortcut(command: RoutedCommand): KeyboardEvent {
  const event = new KeyboardEvent("keydown", {
    bubbles: true,
    cancelable: true,
    ctrlKey: true,
    key: commandFixture.shortcutKeys[command],
  });
  fireEvent(window, event);
  return event;
}

afterEach(() => {
  cleanup();
  delete window.bbDesktop;
});

function createPaneHandlers({
  openPreferredResult = false,
}: { openPreferredResult?: boolean } = {}) {
  return {
    onClose: vi.fn(() => true),
    onNewTab: vi.fn(),
    onOpenPreferred: vi.fn(() => openPreferredResult),
    onStartTerminal: vi.fn(),
    onToggle: vi.fn(),
    onToggleDiff: vi.fn(() => true),
  };
}

type PaneHandlers = ReturnType<typeof createPaneHandlers>;

function TestPanelCommandHandlers({
  canStartTerminal = false,
  handlers,
  hasToggleDiff = false,
  isFocused,
  registerLegacyOpenNewTab = false,
}: {
  canStartTerminal?: boolean;
  handlers: PaneHandlers;
  hasToggleDiff?: boolean;
  isFocused: boolean;
  registerLegacyOpenNewTab?: boolean;
}) {
  return (
    <SecondaryPanelCommandHandlers
      host={{
        canStartTerminal,
        handleCloseWindowRequest: handlers.onClose,
        handleOpenNewTab: handlers.onNewTab,
        handleStartTerminal: handlers.onStartTerminal,
        handleToggleSecondaryPanel: handlers.onToggle,
        isFocused,
        registerLegacyOpenNewTab,
      }}
      onOpenPreferred={handlers.onOpenPreferred}
      {...(hasToggleDiff ? { onToggleDiff: handlers.onToggleDiff } : {})}
    />
  );
}

describe("SecondaryPanelCommandHandlers", () => {
  it("routes panel shortcuts and desktop close requests only to the focused New Thread pane", async () => {
    const first = createPaneHandlers();
    const second = createPaneHandlers();
    const desktopCloseHandlers = new Set<BbDesktopCloseWindowRequestHandler>();
    window.bbDesktop = {
      ...createBbDesktopApi(desktopInfo),
      onCloseWindowRequest(listener) {
        desktopCloseHandlers.add(listener);
        return () => desktopCloseHandlers.delete(listener);
      },
    };

    const view = render(
      <AppCommandProvider>
        <TestPanelCommandHandlers isFocused handlers={first} />
        <TestPanelCommandHandlers isFocused={false} handlers={second} />
      </AppCommandProvider>,
    );

    await act(async () => undefined);
    expect(desktopCloseHandlers.size).toBe(1);
    expect(dispatchCommandShortcut("panel.toggle").defaultPrevented).toBe(true);
    expect(first.onToggle).toHaveBeenCalledTimes(1);
    expect(second.onToggle).not.toHaveBeenCalled();
    expect(dispatchCommandShortcut("panel.close").defaultPrevented).toBe(true);
    expect(first.onClose).toHaveBeenCalledTimes(1);
    expect(second.onClose).not.toHaveBeenCalled();
    for (const handler of desktopCloseHandlers) {
      expect(handler()).toBe(true);
    }
    expect(first.onClose).toHaveBeenCalledTimes(2);

    view.rerender(
      <AppCommandProvider>
        <TestPanelCommandHandlers isFocused={false} handlers={first} />
        <TestPanelCommandHandlers isFocused handlers={second} />
      </AppCommandProvider>,
    );
    await act(async () => undefined);

    expect(desktopCloseHandlers.size).toBe(1);
    dispatchCommandShortcut("panel.toggle");
    dispatchCommandShortcut("panel.close");
    expect(first.onToggle).toHaveBeenCalledTimes(1);
    expect(first.onClose).toHaveBeenCalledTimes(2);
    expect(second.onToggle).toHaveBeenCalledTimes(1);
    expect(second.onClose).toHaveBeenCalledTimes(1);
    for (const handler of desktopCloseHandlers) handler();
    expect(second.onClose).toHaveBeenCalledTimes(2);
  });

  it("keeps one desktop close listener across rerenders and re-registers only when the callback changes", async () => {
    const registrations: BbDesktopCloseWindowRequestHandler[] = [];
    const active = new Set<BbDesktopCloseWindowRequestHandler>();
    window.bbDesktop = {
      ...createBbDesktopApi(desktopInfo),
      onCloseWindowRequest(listener) {
        registrations.push(listener);
        active.add(listener);
        return () => active.delete(listener);
      },
    };
    const handlers = createPaneHandlers();

    const view = render(
      <AppCommandProvider>
        <TestPanelCommandHandlers isFocused handlers={handlers} />
      </AppCommandProvider>,
    );
    await act(async () => undefined);
    expect(registrations).toHaveLength(1);

    // The host prop object is rebuilt inline on every render, so these
    // rerenders only keep the callback identities stable. The listener must
    // not be re-registered: the effect has to key on the close callback, not
    // on the host object.
    view.rerender(
      <AppCommandProvider>
        <TestPanelCommandHandlers isFocused handlers={handlers} />
      </AppCommandProvider>,
    );
    view.rerender(
      <AppCommandProvider>
        <TestPanelCommandHandlers isFocused handlers={handlers} />
      </AppCommandProvider>,
    );
    await act(async () => undefined);
    expect(registrations).toHaveLength(1);
    expect(active.size).toBe(1);

    // A new close-callback identity must swap the registration (old listener
    // cleaned up, no leaked duplicate) and route close requests to the new
    // callback — guarding against both stale (`[]`) and missing deps.
    const replacementClose = vi.fn(() => true);
    view.rerender(
      <AppCommandProvider>
        <TestPanelCommandHandlers
          isFocused
          handlers={{ ...handlers, onClose: replacementClose }}
        />
      </AppCommandProvider>,
    );
    await act(async () => undefined);
    expect(registrations).toHaveLength(2);
    expect(active.size).toBe(1);
    for (const listener of active) listener();
    expect(replacementClose).toHaveBeenCalledTimes(1);
    expect(handlers.onClose).not.toHaveBeenCalled();
  });

  interface RouteCase {
    command: RoutedCommand;
    expectFocusedCalls: Partial<Record<keyof PaneHandlers, number>>;
    expectHandled: boolean;
    focusedPane?: {
      canStartTerminal?: boolean;
      hasToggleDiff?: boolean;
      openPreferredResult?: boolean;
    };
    name: string;
  }

  // The unfocused pane always has every capability, so a routing bug that
  // ignores focus trips its zero-call assertions immediately.
  const routeCases: RouteCase[] = [
    {
      command: "panel.newTab",
      expectFocusedCalls: { onNewTab: 1 },
      expectHandled: true,
      name: "panel.newTab opens a new tab only on the focused pane",
    },
    {
      command: "file.quickOpen",
      expectFocusedCalls: { onNewTab: 1 },
      expectHandled: true,
      name: "file.quickOpen routes to the focused pane's new-tab opener",
    },
    {
      command: "terminal.open",
      expectFocusedCalls: { onStartTerminal: 1 },
      expectHandled: true,
      focusedPane: { canStartTerminal: true },
      name: "terminal.open starts a terminal on the focused pane with the capability",
    },
    {
      command: "terminal.open",
      expectFocusedCalls: {},
      expectHandled: false,
      focusedPane: { canStartTerminal: false },
      name: "terminal.open falls through when the focused pane cannot start terminals",
    },
    {
      command: "workspace.openPreferred",
      expectFocusedCalls: { onOpenPreferred: 1 },
      expectHandled: true,
      focusedPane: { openPreferredResult: true },
      name: "workspace.openPreferred consumes the shortcut when the focused opener succeeds",
    },
    {
      command: "workspace.openPreferred",
      expectFocusedCalls: { onOpenPreferred: 1 },
      expectHandled: false,
      focusedPane: { openPreferredResult: false },
      name: "workspace.openPreferred falls through when the focused opener declines",
    },
    {
      command: "diff.toggle",
      expectFocusedCalls: { onToggleDiff: 1 },
      expectHandled: true,
      focusedPane: { hasToggleDiff: true },
      name: "diff.toggle routes to the focused pane's diff toggle",
    },
    {
      command: "diff.toggle",
      expectFocusedCalls: {},
      expectHandled: false,
      focusedPane: { hasToggleDiff: false },
      name: "diff.toggle falls through when the focused pane has no diff toggle",
    },
  ];

  for (const routeCase of routeCases) {
    it(routeCase.name, async () => {
      const focused = createPaneHandlers({
        openPreferredResult: routeCase.focusedPane?.openPreferredResult ?? false,
      });
      const unfocused = createPaneHandlers({ openPreferredResult: true });
      render(
        <AppCommandProvider>
          <TestPanelCommandHandlers
            canStartTerminal={routeCase.focusedPane?.canStartTerminal ?? false}
            handlers={focused}
            hasToggleDiff={routeCase.focusedPane?.hasToggleDiff ?? false}
            isFocused
          />
          <TestPanelCommandHandlers
            canStartTerminal
            handlers={unfocused}
            hasToggleDiff
            isFocused={false}
          />
        </AppCommandProvider>,
      );
      await act(async () => undefined);

      const event = dispatchCommandShortcut(routeCase.command);

      expect(event.defaultPrevented).toBe(routeCase.expectHandled);
      for (const name of Object.keys(focused) as (keyof PaneHandlers)[]) {
        expect(focused[name], `focused ${name}`).toHaveBeenCalledTimes(
          routeCase.expectFocusedCalls[name] ?? 0,
        );
      }
      for (const name of Object.keys(unfocused) as (keyof PaneHandlers)[]) {
        expect(unfocused[name], `unfocused ${name}`).not.toHaveBeenCalled();
      }
    });
  }

  it("registers the legacy desktop new-tab listener only for the focused pane with the capability", async () => {
    const openNewTabHandlers = new Set<BbDesktopOpenNewTabHandler>();
    // A legacy desktop shell: onOpenNewTab exists but onAppCommand is absent.
    window.bbDesktop = {
      ...createBbDesktopApi(desktopInfo),
      onOpenNewTab(listener) {
        openNewTabHandlers.add(listener);
        return () => openNewTabHandlers.delete(listener);
      },
    };
    const focusedLegacy = createPaneHandlers();
    const unfocusedLegacy = createPaneHandlers();
    const focusedWithoutCapability = createPaneHandlers();

    render(
      <AppCommandProvider>
        <TestPanelCommandHandlers
          isFocused
          handlers={focusedLegacy}
          registerLegacyOpenNewTab
        />
        <TestPanelCommandHandlers
          isFocused={false}
          handlers={unfocusedLegacy}
          registerLegacyOpenNewTab
        />
        <TestPanelCommandHandlers isFocused handlers={focusedWithoutCapability} />
      </AppCommandProvider>,
    );
    await act(async () => undefined);

    expect(openNewTabHandlers.size).toBe(1);
    for (const handler of openNewTabHandlers) handler();
    expect(focusedLegacy.onNewTab).toHaveBeenCalledTimes(1);
    expect(unfocusedLegacy.onNewTab).not.toHaveBeenCalled();
    expect(focusedWithoutCapability.onNewTab).not.toHaveBeenCalled();
  });

  it("skips the legacy new-tab listener when the desktop shell dispatches app commands", async () => {
    const openNewTabHandlers = new Set<BbDesktopOpenNewTabHandler>();
    window.bbDesktop = {
      ...createBbDesktopApi(desktopInfo),
      onAppCommand() {
        return () => {};
      },
      onOpenNewTab(listener) {
        openNewTabHandlers.add(listener);
        return () => openNewTabHandlers.delete(listener);
      },
    };
    const handlers = createPaneHandlers();

    render(
      <AppCommandProvider>
        <TestPanelCommandHandlers
          isFocused
          handlers={handlers}
          registerLegacyOpenNewTab
        />
      </AppCommandProvider>,
    );
    await act(async () => undefined);

    expect(openNewTabHandlers.size).toBe(0);
  });
});

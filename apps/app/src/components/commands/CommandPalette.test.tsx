// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  defaultAppSettings,
  type AppCommandId,
  type AppDefaultKeybinding,
  type AppKeybinding,
} from "@bb/domain";
import { CHROME_SECTION_LABEL_CLASS } from "@bb/shared-ui/chrome-style-tokens";
import { AppCommandProvider, useAppCommandHandler } from "./AppCommandProvider";
import {
  removePluginSlotRegistrations,
  setPluginSlotRegistrations,
} from "@/lib/plugin-slots";
import {
  resetPluginLogoStoreForTest,
  setPluginLogoUrls,
} from "@/lib/plugin-logos";
import { CommandPalette } from "./CommandPalette";

const PALETTE_SHORTCUT = {
  key: "p",
  mod: true,
  meta: false,
  control: false,
  alt: false,
  shift: true,
};

const MAIN_SURFACE = { all: ["mainSurface" as const], none: [] };

const PALETTE_BINDING: AppKeybinding = {
  command: "palette.open",
  desktopOnly: false,
  shortcut: PALETTE_SHORTCUT,
  when: { all: ["mainSurface"], none: ["modalOpen"] },
};

// A chord that declines while any modal is open, like most app bindings.
const THREAD_NEW_BINDING: AppKeybinding = {
  command: "thread.new",
  desktopOnly: false,
  shortcut: {
    key: "o",
    mod: true,
    meta: false,
    control: false,
    alt: false,
    shift: true,
  },
  when: { all: ["mainSurface"], none: ["modalOpen"] },
};

const THREAD_SEARCH_BINDING: AppKeybinding = {
  command: "thread.search",
  desktopOnly: false,
  shortcut: {
    key: "k",
    mod: true,
    meta: false,
    control: false,
    alt: false,
    shift: false,
  },
  when: { all: ["mainSurface"], none: ["modalOpen"] },
};

function defaults(...commands: AppCommandId[]): AppDefaultKeybinding[] {
  return commands.map((command) => ({
    command,
    desktopOnly: false,
    shortcut: null,
    when: MAIN_SURFACE,
  }));
}

const testState = vi.hoisted(() => ({ calls: [] as string[] }));

vi.mock("@/hooks/queries/system-queries", () => ({
  useSystemConfig: () => ({
    data: {
      generalSettings: {
        ...defaultAppSettings,
        showKeyboardHints: false,
      },
      keybindings: [PALETTE_BINDING, THREAD_NEW_BINDING, THREAD_SEARCH_BINDING],
      defaultKeybindings: [
        PALETTE_BINDING,
        THREAD_SEARCH_BINDING,
        ...defaults(
          "thread.new",
          "thread.next",
          "panel.toggle",
          "terminal.open",
        ),
      ],
    },
  }),
}));

vi.mock("@/lib/bb-desktop", () => ({
  getBbDesktopInfo: () => null,
}));

function Handler({ command }: { command: AppCommandId }) {
  useAppCommandHandler(command, () => {
    testState.calls.push(command);
    return true;
  });
  return null;
}

function renderPalette() {
  const result = render(
    <MemoryRouter>
      <AppCommandProvider>
        <button type="button" data-testid="origin">
          origin
        </button>
        <Handler command="thread.new" />
        <Handler command="thread.search" />
        <Handler command="thread.next" />
        <Handler command="panel.toggle" />
        <Handler command="terminal.open" />
        <CommandPalette threadId={null} projectId={null} />
      </AppCommandProvider>
    </MemoryRouter>,
  );
  screen.getByTestId("origin").focus();
  return result;
}

function openPalette(): KeyboardEvent {
  const event = new KeyboardEvent("keydown", {
    key: "p",
    ctrlKey: true,
    shiftKey: true,
    bubbles: true,
    cancelable: true,
  });
  (document.activeElement ?? window).dispatchEvent(event);
  return event;
}

const searchField = () => screen.getByRole("combobox");
const commandList = () => screen.getByRole("listbox", { name: "Commands" });
const bucketGroup = (name: string) =>
  within(commandList()).getByRole("group", { name });
const optionTitles = () =>
  screen.getAllByRole("option").map((option) => option.textContent);
const selectedOption = () =>
  screen
    .getAllByRole("option")
    .find((option) => option.getAttribute("aria-selected") === "true");

afterEach(() => {
  cleanup();
  removePluginSlotRegistrations("linear");
  resetPluginLogoStoreForTest();
  testState.calls.length = 0;
  window.localStorage.clear();
});

describe("CommandPalette", () => {
  it("opens on its chord and lists the commands that apply", async () => {
    renderPalette();
    const event = openPalette();
    await waitFor(() => expect(searchField()).toBeTruthy());
    // Chrome maps Mod+Shift+P to print; only preventDefault stops it.
    expect(event.defaultPrevented).toBe(true);
    const titles = optionTitles();
    expect(titles?.[0]).toContain("New thread");
    // Every mounted handler is listed; nothing else is.
    expect(titles).toHaveLength(5);
  });

  it("groups the resting root into three text buckets with producer metadata", async () => {
    renderPalette();
    openPalette();
    await waitFor(() => expect(searchField()).toBeTruthy());

    const groups = within(commandList()).getAllByRole("group");
    expect(
      groups.map((group) => group.getAttribute("data-palette-bucket")),
    ).toEqual(["Threads", "Actions", "Plugins"]);
    for (const [index, label] of ["Threads", "Actions", "Plugins"].entries()) {
      const header = within(groups[index] as HTMLElement).getByText(label, {
        selector: "div",
      });
      for (const className of CHROME_SECTION_LABEL_CLASS.split(" ")) {
        expect(header.classList.contains(className)).toBe(true);
      }
      expect(header.classList.contains("px-2")).toBe(true);
    }

    const threadRows = within(bucketGroup("Threads")).getAllByRole("option");
    expect(threadRows.map((row) => row.textContent)).toEqual([
      expect.stringContaining("New thread"),
      expect.stringContaining("Search threads"),
      expect.stringContaining("Next thread"),
    ]);
    // The bucket already supplies this context, so rows do not repeat it.
    for (const row of threadRows) {
      expect(within(row).queryByText("Threads")).toBeNull();
    }
    expect(threadRows[1]?.querySelector("kbd")).not.toBeNull();

    const actionRows = within(bucketGroup("Actions")).getAllByRole("option");
    expect(actionRows[0]?.textContent).toContain("Window and layout");
    expect(actionRows[1]?.textContent).toContain("Workspace");
    for (const row of [...threadRows, ...actionRows]) {
      expect(row.classList.contains("px-2")).toBe(true);
    }
    // Root rows and headers remain text-only; the existing input icon is
    // outside this list and is removed by the mode-shell layer.
    expect(commandList().querySelector("[data-icon]")).toBeNull();
  });

  it("filters as the user types and keeps the selection on a live row", async () => {
    renderPalette();
    openPalette();
    await waitFor(() => expect(searchField()).toBeTruthy());

    fireEvent.keyDown(searchField(), { key: "ArrowDown" });
    fireEvent.keyDown(searchField(), { key: "ArrowDown" });
    fireEvent.change(searchField(), { target: { value: "terminal" } });

    await waitFor(() => expect(optionTitles()).toHaveLength(1));
    expect(selectedOption()?.textContent).toContain("Open terminal");
    expect(selectedOption()?.textContent).toContain("Workspace");
    expect(within(commandList()).queryAllByRole("group")).toHaveLength(0);
  });

  it("wraps at both ends of the list", async () => {
    renderPalette();
    openPalette();
    await waitFor(() => expect(searchField()).toBeTruthy());

    fireEvent.keyDown(searchField(), { key: "ArrowUp" });
    expect(selectedOption()?.textContent).toContain("Open terminal");

    fireEvent.keyDown(searchField(), { key: "ArrowDown" });
    expect(selectedOption()?.textContent).toContain("New thread");
  });

  it("runs the highlighted command, closes, and restores focus", async () => {
    renderPalette();
    openPalette();
    await waitFor(() => expect(searchField()).toBeTruthy());

    fireEvent.change(searchField(), { target: { value: "toggle panel" } });
    await waitFor(() =>
      expect(selectedOption()?.textContent).toContain("Toggle panel"),
    );
    fireEvent.keyDown(searchField(), { key: "Enter" });

    await waitFor(() => expect(testState.calls).toEqual(["panel.toggle"]));
    expect(screen.queryByRole("combobox")).toBeNull();
    expect(document.activeElement).toBe(screen.getByTestId("origin"));
  });

  it("offers the last command run first within its resting bucket", async () => {
    renderPalette();
    openPalette();
    await waitFor(() => expect(searchField()).toBeTruthy());
    fireEvent.change(searchField(), { target: { value: "toggle panel" } });
    await waitFor(() =>
      expect(selectedOption()?.textContent).toContain("Toggle panel"),
    );
    fireEvent.keyDown(searchField(), { key: "Enter" });
    await waitFor(() => expect(screen.queryByRole("combobox")).toBeNull());

    openPalette();
    await waitFor(() => expect(searchField()).toBeTruthy());
    const actionRows = within(bucketGroup("Actions")).getAllByRole("option");
    expect(actionRows[0]?.textContent).toContain("Toggle panel");
  });

  it("closes on Escape without running anything", async () => {
    renderPalette();
    openPalette();
    await waitFor(() => expect(searchField()).toBeTruthy());

    fireEvent.keyDown(searchField(), { key: "Escape" });

    await waitFor(() => expect(screen.queryByRole("combobox")).toBeNull());
    expect(testState.calls).toEqual([]);
  });

  it("suppresses app chords while open and releases them on close", async () => {
    // The palette is an open modal, so `none: ["modalOpen"]` bindings must
    // decline rather than fire under the search field.
    renderPalette();
    const pressThreadNew = () =>
      fireEvent.keyDown(document.activeElement ?? window, {
        key: "o",
        ctrlKey: true,
        shiftKey: true,
        bubbles: true,
      });

    openPalette();
    await waitFor(() => expect(searchField()).toBeTruthy());
    pressThreadNew();
    expect(testState.calls).toEqual([]);

    fireEvent.keyDown(searchField(), { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("combobox")).toBeNull());
    screen.getByTestId("origin").focus();
    pressThreadNew();
    await waitFor(() => expect(testState.calls).toEqual(["thread.new"]));
  });

  it("scrolls the highlighted row into view when arrowing, but not on hover", async () => {
    // Focus stays in the search field, so nothing scrolls the list on its own.
    const scrollIntoView = vi.spyOn(
      Element.prototype,
      "scrollIntoView",
    ) as unknown as ReturnType<typeof vi.fn>;
    renderPalette();
    openPalette();
    await waitFor(() => expect(searchField()).toBeTruthy());
    scrollIntoView.mockClear();

    fireEvent.keyDown(searchField(), { key: "ArrowDown" });
    await waitFor(() => expect(scrollIntoView).toHaveBeenCalledTimes(1));
    expect(scrollIntoView.mock.instances[0]).toBe(selectedOption());
    expect(scrollIntoView).toHaveBeenLastCalledWith({ block: "nearest" });

    fireEvent.keyDown(searchField(), { key: "End" });
    await waitFor(() => expect(scrollIntoView).toHaveBeenCalledTimes(2));

    // Hovering must not yank the list out from under the pointer.
    scrollIntoView.mockClear();
    fireEvent.pointerMove(screen.getAllByRole("option")[0] as HTMLElement);
    expect(scrollIntoView).not.toHaveBeenCalled();

    scrollIntoView.mockRestore();
  });

  it("lists a plugin's commandPaletteAction and runs it", async () => {
    setPluginLogoUrls(
      new Map([
        [
          "linear",
          {
            displayName: "Linear",
            icon: null,
            compactIconUrl: null,
            logoUrl: null,
            logoDarkUrl: null,
            icons: new Map(),
          },
        ],
      ]),
    );
    setPluginSlotRegistrations("linear", {
      homepageSections: [],
      settingsSections: [],
      navPanels: [],
      threadPanelActions: [],
      sidebarFooterActions: [],
      fileOpeners: [],
      messageDirectives: [],
      commandPaletteActions: [
        {
          id: "open-issue",
          title: "Open issue",
          run: () => {
            testState.calls.push("plugin-ran");
          },
        },
      ],
    });
    renderPalette();
    openPalette();
    await waitFor(() => expect(searchField()).toBeTruthy());

    const pluginRow = within(bucketGroup("Plugins")).getByRole("option");
    expect(pluginRow.textContent).toContain("Open issue");
    expect(pluginRow.textContent).toContain("Linear");

    fireEvent.change(searchField(), { target: { value: "linear" } });
    await waitFor(() => expect(optionTitles()).toHaveLength(1));
    expect(optionTitles()?.[0]).toContain("Open issue");
    expect(optionTitles()?.[0]).toContain("Linear");
    expect(within(commandList()).queryAllByRole("group")).toHaveLength(0);
    fireEvent.keyDown(searchField(), { key: "Enter" });

    await waitFor(() => expect(testState.calls).toEqual(["plugin-ran"]));
  });

  it("says so when nothing matches", async () => {
    renderPalette();
    openPalette();
    await waitFor(() => expect(searchField()).toBeTruthy());

    fireEvent.change(searchField(), { target: { value: "zzzzz" } });

    await waitFor(() =>
      expect(screen.getByText("No matching commands")).toBeTruthy(),
    );
    fireEvent.keyDown(searchField(), { key: "Enter" });
    expect(testState.calls).toEqual([]);
  });
});

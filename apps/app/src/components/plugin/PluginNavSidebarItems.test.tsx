// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { useEffect, type ComponentType } from "react";
import { createStore, Provider } from "jotai";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { CompactViewportOverrideProvider } from "@bb/shared-ui/hooks/use-compact-viewport";
import { SidebarProvider } from "@/components/ui/sidebar.js";
import {
  resetPluginSlotStoreForTest,
  setPluginSlotRegistrations,
  type PluginRegistrationSet,
} from "@/lib/plugin-slots";
import {
  resetAllCrashedPluginSlotsForTest,
  resetCrashedPluginSlots,
} from "./PluginSlotMount";
import {
  ExtensionsNavSidebarItem,
  PluginNavSidebarItems,
} from "./PluginNavSidebarItems";
import { pluginNavPanelOrderAtom } from "./pluginNavSidebarAtoms";

function registrationSet(
  overrides: Partial<PluginRegistrationSet>,
): PluginRegistrationSet {
  return {
    homepageSections: [],
    settingsSections: [],
    navPanels: [],
    threadPanelActions: [],
    sidebarFooterActions: [],
    fileOpeners: [],
    messageDirectives: [],
    ...overrides,
  };
}

function registerPanel(
  pluginId: string,
  title: string,
  experimentalSidebarAccessory?: ComponentType,
) {
  setPluginSlotRegistrations(
    pluginId,
    registrationSet({
      navPanels: [
        {
          id: "main",
          title,
          icon: "Puzzle",
          path: "main",
          component: () => null,
          ...(experimentalSidebarAccessory === undefined
            ? {}
            : {
                experimental_sidebarAccessory: experimentalSidebarAccessory,
              }),
        },
      ],
    }),
  );
}

function renderSidebarItems(
  options: {
    storedOrder?: string[];
    compactViewport?: boolean;
  } = {},
) {
  const store = createStore();
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  if (options.storedOrder) {
    store.set(pluginNavPanelOrderAtom, options.storedOrder);
  }
  return render(
    <CompactViewportOverrideProvider
      isCompactViewport={options.compactViewport ?? false}
    >
      <QueryClientProvider client={queryClient}>
        <Provider store={store}>
          <MemoryRouter initialEntries={["/"]}>
            <SidebarProvider>
              <PluginNavSidebarItems />
            </SidebarProvider>
          </MemoryRouter>
        </Provider>
      </QueryClientProvider>
    </CompactViewportOverrideProvider>,
  );
}

function panelRowNames(labels: readonly string[] = ["Docs", "GitHub"]): string[] {
  const rowLabels = new Set(labels);
  return screen
    .getAllByRole("button")
    .map((button) => button.textContent?.trim() ?? "")
    .filter((label) => rowLabels.has(label));
}

beforeEach(() => {
  window.localStorage.clear();
  resetAllCrashedPluginSlotsForTest();
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  resetPluginSlotStoreForTest();
  resetAllCrashedPluginSlotsForTest();
  vi.restoreAllMocks();
  window.localStorage.clear();
});

describe("PluginNavSidebarItems", () => {
  it("collapses the entire subsection with zero traditional plugins", () => {
    renderSidebarItems();

    expect(screen.queryByTestId("plugin-nav-sidebar-items")).toBeNull();
    expect(screen.queryByText("Plugins")).toBeNull();
  });

  it("shows the subsection label without a disclosure for one plugin", () => {
    registerPanel("docs", "Docs");
    renderSidebarItems();

    expect(screen.getByText("Plugins")).toBeDefined();
    expect(panelRowNames(["Docs"])).toEqual(["Docs"]);
    expect(
      screen.queryByTestId("plugin-nav-sidebar-overflow-toggle"),
    ).toBeNull();
  });

  it("keeps an accessory-less plugin row unchanged", () => {
    registerPanel("docs", "Docs");

    const view = renderSidebarItems();

    expect(screen.getByRole("button", { name: "Docs" }).textContent).toBe(
      "Docs",
    );
    expect(
      screen.getByRole("button", { name: "Docs" }).classList.contains("pr-7"),
    ).toBe(true);
    expect(
      screen.getByRole("button", { name: "Docs" }).classList.contains("pr-18"),
    ).toBe(false);
    expect(
      screen.queryByRole("button", { name: "Docs panel options" }),
    ).not.toBeNull();
    expect(
      view.container.querySelector("[data-plugin-nav-sidebar-accessory]"),
    ).toBeNull();
  });

  it("keeps the panel options trigger visible on mobile", () => {
    registerPanel("docs", "Docs");

    renderSidebarItems();

    expect(
      screen
        .getByRole("button", { name: "Docs panel options" })
        .closest("[data-sidebar-hover-actions-mobile]")
        ?.getAttribute("data-sidebar-hover-actions-mobile"),
    ).toBe("always");
  });

  it("bounds and truncates a long sidebar accessory", () => {
    registerPanel("tasks", "Tasks", () => (
      <span>123456789012345678901234567890</span>
    ));

    const view = renderSidebarItems();
    const accessory = view.container.querySelector(
      "[data-plugin-nav-sidebar-accessory]",
    );

    expect(accessory?.textContent).toBe("123456789012345678901234567890");
    expect(screen.getByRole("button", { name: "Tasks" })).not.toBeNull();
    expect(
      screen.getByRole("button", { name: "Tasks" }).classList.contains("pr-18"),
    ).toBe(true);
    for (const className of [
      "bb-sidebar-hover-actions-fade",
      "right-1",
      "min-w-5",
      "max-h-5",
      "max-w-16",
      "overflow-hidden",
      "text-xs",
      "text-ellipsis",
      "whitespace-nowrap",
    ]) {
      expect(accessory?.classList.contains(className), className).toBe(true);
    }
  });

  it("replaces a live accessory with row options without remounting it", async () => {
    let mounts = 0;
    let unmounts = 0;
    function LiveAccessory() {
      useEffect(() => {
        mounts += 1;
        return () => {
          unmounts += 1;
        };
      }, []);
      return <span>12</span>;
    }
    registerPanel("tasks", "Tasks", LiveAccessory);

    const view = renderSidebarItems();
    const accessory = view.container.querySelector(
      "[data-plugin-nav-sidebar-accessory]",
    );

    expect(mounts).toBe(1);
    expect(unmounts).toBe(0);
    expect(
      accessory?.getAttribute("data-sidebar-hover-actions-open"),
    ).toBeNull();

    fireEvent.pointerDown(
      screen.getByRole("button", { name: "Tasks panel options" }),
      { button: 0 },
    );
    expect(
      await screen.findByRole("menuitem", { name: "Move to top" }),
    ).not.toBeNull();

    expect(accessory?.getAttribute("data-sidebar-hover-actions-open")).toBe(
      "true",
    );
    expect(mounts).toBe(1);
    expect(unmounts).toBe(0);
  });

  it("does not mount sidebar accessories on compact viewports", () => {
    let mounts = 0;
    registerPanel("tasks", "Tasks", () => {
      mounts += 1;
      return <span>12</span>;
    });

    const view = renderSidebarItems({ compactViewport: true });

    expect(mounts).toBe(0);
    expect(
      view.container.querySelector("[data-plugin-nav-sidebar-accessory]"),
    ).toBeNull();
  });

  it("hides a crashed accessory and retries it after a plugin reload", () => {
    function CrashingAccessory(): never {
      throw new Error("accessory crashed");
    }
    registerPanel("tasks", "Tasks", CrashingAccessory);

    const view = renderSidebarItems();

    expect(screen.queryByText("plugin tasks crashed")).toBeNull();
    expect(
      view.container.querySelector("[data-plugin-nav-sidebar-accessory]"),
    ).not.toBeNull();

    resetCrashedPluginSlots("tasks");
    act(() => registerPanel("tasks", "Tasks", () => <span>18</span>));

    expect(screen.getByText("18")).toBeDefined();
    expect(screen.queryByText("plugin tasks crashed")).toBeNull();
  });

  it("puts the fifth plugin behind a count-free disclosure", async () => {
    const labels = ["One", "Two", "Three", "Four", "Five"];
    labels.forEach((label, index) => registerPanel(`plugin-${index}`, label));

    renderSidebarItems();

    expect(panelRowNames(labels)).toEqual(labels.slice(0, 4));
    const toggle = screen.getByTestId("plugin-nav-sidebar-overflow-toggle");
    expect(toggle.textContent).toBe("More plugins");
    expect(toggle.textContent).not.toMatch(/\d/);

    fireEvent.click(toggle);
    await waitFor(() => expect(panelRowNames(labels)).toEqual(labels));
    expect(toggle.textContent).toBe("Show fewer");
  });

  it("moves a visible row to overflow and back to top", async () => {
    const labels = ["One", "Two", "Three", "Four", "Five", "Six"];
    labels.forEach((label, index) => registerPanel(`plugin-${index}`, label));
    renderSidebarItems();

    fireEvent.pointerDown(
      screen.getByRole("button", { name: "One panel options" }),
      { button: 0 },
    );
    fireEvent.click(
      await screen.findByRole("menuitem", { name: "Move to overflow" }),
    );

    await waitFor(() =>
      expect(panelRowNames(labels)).toEqual([
        "Two",
        "Three",
        "Four",
        "Five",
      ]),
    );
    fireEvent.click(screen.getByTestId("plugin-nav-sidebar-overflow-toggle"));
    fireEvent.pointerDown(
      screen.getByRole("button", { name: "One panel options" }),
      { button: 0 },
    );
    fireEvent.click(
      await screen.findByRole("menuitem", { name: "Move to top" }),
    );
    await waitFor(() => expect(panelRowNames(labels)).toEqual(labels));
  });
});

describe("ExtensionsNavSidebarItem", () => {
  it("is host-owned and has no plugin-panel options menu", () => {
    render(
      <MemoryRouter>
        <ExtensionsNavSidebarItem routePath="/extensions/plugins" />
      </MemoryRouter>,
    );

    const row = screen.getByRole("button", { name: "Extensions" });
    expect(row.querySelector(".bb-sidebar-row-icon-swap")).not.toBeNull();
    expect(
      screen.queryByRole("button", { name: "Extensions panel options" }),
    ).toBeNull();
  });
});

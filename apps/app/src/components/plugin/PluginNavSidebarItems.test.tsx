// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { useEffect, type ComponentType } from "react";
import { createStore, Provider } from "jotai";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { CompactViewportOverrideProvider } from "@bb/shared-ui/hooks/use-compact-viewport";
import { AUTOMATIONS_PLUGIN_ID } from "@/lib/route-paths";
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
import { appToast } from "@/components/ui/app-toast";

vi.mock("@/components/ui/app-toast", () => ({
  appToast: {
    dismiss: vi.fn(),
    error: vi.fn(),
    loading: vi.fn(),
    message: vi.fn(),
    success: vi.fn(),
    warning: vi.fn(),
  },
}));

function disabledPluginMutationResponse(id: string) {
  return {
    ok: true,
    plugin: {
      id,
      source: `npm:${id}`,
      rootDir: `/managed/plugins/${id}`,
      version: "1.0.0",
      provenance: "catalog",
      isOrphanedBuiltin: false,
      catalogEntryId: id,
      publisherLabel: "BB Community",
      sourceDisplay: `BB Community · ${id}`,
      updateState: {},
      enabled: false,
      description: null,
      name: id,
      icon: "Puzzle",
      iconUrl: null,
      status: "disabled",
      statusDetail: null,
      handlerStats: { count: 0, totalMs: 0, maxMs: 0, errorCount: 0 },
      services: [],
      schedules: [],
      cliCommand: null,
      capabilities: [],
      hasSettings: false,
      app: { hasApp: true, bundle: null },
      logoUrl: null,
      logoDarkUrl: null,
      providerIds: [],
      icons: {},
    },
  };
}

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
    initialEntry?: string;
    splitEnabled?: boolean;
  } = {},
) {
  const store = createStore();
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  // Seed the store rather than localStorage: the storage atom captured its
  // initial value when this module was imported, before the test could write.
  if (options.storedOrder) {
    store.set(pluginNavPanelOrderAtom, options.storedOrder);
  }
  const view = render(
    <CompactViewportOverrideProvider
      isCompactViewport={options.compactViewport ?? false}
    >
      <QueryClientProvider client={queryClient}>
        <Provider store={store}>
          <MemoryRouter initialEntries={[options.initialEntry ?? "/"]}>
            <SidebarProvider>
              <PluginNavSidebarItems
                splitEnabled={options.splitEnabled ?? false}
              />
              <LocationPath />
            </SidebarProvider>
          </MemoryRouter>
        </Provider>
      </QueryClientProvider>
    </CompactViewportOverrideProvider>,
  );
  return { ...view, queryClient };
}

function panelRowNames(labels: readonly string[]): string[] {
  const rowLabels = new Set(labels);
  return screen
    .getAllByRole("button")
    .map((button) => button.textContent?.trim() ?? "")
    .filter((label) => rowLabels.has(label));
}

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
  resetAllCrashedPluginSlotsForTest();
  // React reports errors caught by the slot boundary; keep expected crashes
  // from obscuring the regression assertions below.
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  resetPluginSlotStoreForTest();
  resetAllCrashedPluginSlotsForTest();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

describe("PluginNavSidebarItems", () => {
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

  it("uses one complete icon-labelled menu for the options button and right-click", async () => {
    registerPanel("docs", "Docs");
    renderSidebarItems({
      splitEnabled: true,
    });

    fireEvent.pointerDown(
      screen.getByRole("button", { name: "Docs panel options" }),
      { button: 0 },
    );
    const dropdownMenu = await screen.findByRole("menu");
    const expected = [
      ["Open in split", "Columns2"],
      ["Detail page", "Info"],
      ["Move to top", "ArrowUp"],
      ["Move to overflow", "ArrowDown"],
      ["Disable", "Unavailable"],
    ] as const;
    const expectCompleteMenu = (menu: HTMLElement) => {
      expect(
        within(menu)
          .getAllByRole("menuitem")
          .map((item) => item.textContent?.trim()),
      ).toEqual(expected.map(([label]) => label));
      expect(within(menu).getAllByRole("separator")).toHaveLength(2);
      for (const [label, icon] of expected) {
        expect(
          within(menu)
            .getByRole("menuitem", { name: label })
            .querySelector(`[data-icon="${icon}"]`),
        ).not.toBeNull();
      }
    };
    expectCompleteMenu(dropdownMenu);
    fireEvent.keyDown(dropdownMenu, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());

    fireEvent.contextMenu(screen.getByRole("button", { name: "Docs" }));
    const contextMenu = await screen.findByRole("menu");
    expectCompleteMenu(contextMenu);

    expect(
      screen.queryByRole("menuitem", { name: /uninstall|remove/i }),
    ).toBeNull();
  });

  it("opens plugin details and omits split when the layout cannot split", async () => {
    registerPanel("docs", "Docs");
    renderSidebarItems();

    fireEvent.pointerDown(
      screen.getByRole("button", { name: "Docs panel options" }),
      { button: 0 },
    );
    expect(
      screen.queryByRole("menuitem", { name: "Open in split" }),
    ).toBeNull();
    fireEvent.click(
      await screen.findByRole("menuitem", { name: "Detail page" }),
    );
    expect(screen.getByTestId("location-path").textContent).toBe(
      "/extensions/plugins/docs",
    );
  });

  it("disables a plugin, refreshes the plugin list, and leaves its active panel", async () => {
    const fetchMock = vi.fn<typeof fetch>(
      async () =>
        new Response(JSON.stringify(disabledPluginMutationResponse("docs")), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    );
    vi.stubGlobal("fetch", fetchMock);
    registerPanel("docs", "Docs");
    const { queryClient } = renderSidebarItems({
      initialEntry: "/plugins/docs/main",
    });
    const invalidateQueries = vi.spyOn(queryClient, "invalidateQueries");

    fireEvent.pointerDown(
      screen.getByRole("button", { name: "Docs panel options" }),
      { button: 0 },
    );
    fireEvent.click(await screen.findByRole("menuitem", { name: "Disable" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [input, init] = fetchMock.mock.calls[0] ?? [];
    expect(String(input)).toBe("/api/v1/plugins/docs/disable");
    expect(init).toMatchObject({ method: "POST", body: "{}" });
    await waitFor(() =>
      expect(screen.getByTestId("location-path").textContent).toBe(
        "/extensions/plugins",
      ),
    );
    expect(appToast.success).toHaveBeenCalledWith("Docs disabled");
    expect(invalidateQueries).toHaveBeenCalled();
  });

  it("reports a disable failure without leaving the active panel", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ ok: false, error: "disable failed" }), {
            status: 500,
            headers: { "content-type": "application/json" },
          }),
      ),
    );
    registerPanel("docs", "Docs");
    renderSidebarItems({ initialEntry: "/plugins/docs/main" });

    fireEvent.pointerDown(
      screen.getByRole("button", { name: "Docs panel options" }),
      { button: 0 },
    );
    fireEvent.click(await screen.findByRole("menuitem", { name: "Disable" }));

    await waitFor(() =>
      expect(appToast.error).toHaveBeenCalledWith("Failed to disable Docs", {
        description: "HTTP 500: disable failed",
      }),
    );
    expect(screen.getByTestId("location-path").textContent).toBe(
      "/plugins/docs/main",
    );
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

  it("shows five plugins without overflow and disables moving into it", async () => {
    const labels = ["One", "Two", "Three", "Four", "Five"];
    labels.forEach((label, index) => registerPanel(`plugin-${index}`, label));
    renderSidebarItems();

    expect(panelRowNames(labels)).toEqual(labels);
    expect(
      screen.queryByTestId("plugin-nav-sidebar-overflow-toggle"),
    ).toBeNull();
    fireEvent.pointerDown(
      screen.getByRole("button", { name: "One panel options" }),
      { button: 0 },
    );
    expect(
      (
        await screen.findByRole("menuitem", { name: "Move to overflow" })
      ).hasAttribute("data-disabled"),
    ).toBe(true);
  });

  it("puts the sixth plugin behind a count-free trailing disclosure", async () => {
    const labels = ["One", "Two", "Three", "Four", "Five", "Six"];
    labels.forEach((label, index) => registerPanel(`plugin-${index}`, label));
    renderSidebarItems();

    expect(panelRowNames(labels)).toEqual(labels.slice(0, 5));
    const toggle = screen.getByTestId("plugin-nav-sidebar-overflow-toggle");
    expect(toggle.textContent).toBe("More plugins");
    expect(toggle.textContent).not.toMatch(/\d/);
    expect(toggle.lastElementChild?.getAttribute("data-icon")).toBe(
      "ChevronRight",
    );
    expect(toggle.lastElementChild?.classList.contains("rotate-90")).toBe(
      false,
    );

    fireEvent.click(toggle);
    await waitFor(() => expect(panelRowNames(labels)).toEqual(labels));
    expect(toggle.textContent).toBe("Show fewer");
    expect(toggle.lastElementChild?.classList.contains("rotate-90")).toBe(true);
  });

  it("keeps every overflow row in the same order when a long list is toggled", async () => {
    const labels = [
      "One",
      "Two",
      "Three",
      "Four",
      "Five",
      "Six",
      "Seven",
      "Eight",
    ];
    labels.forEach((label, index) => registerPanel(`plugin-${index}`, label));
    renderSidebarItems({
      storedOrder: labels.map((_, index) => `plugin-${index}/main`),
    });

    const toggle = screen.getByTestId("plugin-nav-sidebar-overflow-toggle");
    expect(panelRowNames(labels)).toEqual(labels.slice(0, 5));

    fireEvent.click(toggle);
    await waitFor(() => expect(panelRowNames(labels)).toEqual(labels));

    fireEvent.click(toggle);
    await waitFor(() =>
      expect(panelRowNames(labels)).toEqual(labels.slice(0, 5)),
    );
  });

  it("moves a visible row to positional overflow and back to top", async () => {
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
        "Six",
      ]),
    );
    fireEvent.click(screen.getByTestId("plugin-nav-sidebar-overflow-toggle"));
    await waitFor(() =>
      expect(panelRowNames(labels)).toEqual([
        "Two",
        "Three",
        "Four",
        "Five",
        "Six",
        "One",
      ]),
    );

    fireEvent.pointerDown(
      screen.getByRole("button", { name: "One panel options" }),
      { button: 0 },
    );
    expect(
      (
        await screen.findByRole("menuitem", { name: "Move to overflow" })
      ).hasAttribute("data-disabled"),
    ).toBe(true);

    fireEvent.click(
      await screen.findByRole("menuitem", { name: "Move to top" }),
    );
    await waitFor(() => expect(panelRowNames(labels)).toEqual(labels));
  });

  it("excludes Automations from traditional ordering and overflow", () => {
    registerPanel(AUTOMATIONS_PLUGIN_ID, "Automations");
    registerPanel("docs", "Docs");
    renderSidebarItems({
      storedOrder: [`${AUTOMATIONS_PLUGIN_ID}/main`, "docs/main"],
    });

    expect(screen.queryByRole("button", { name: "Automations" })).toBeNull();
    expect(panelRowNames(["Docs"])).toEqual(["Docs"]);
    expect(
      window.localStorage.getItem("bb.sidebar.pluginPanelOrder") ?? "",
    ).not.toContain(AUTOMATIONS_PLUGIN_ID);
  });

  it("keeps a saved order when plugin frontends register after the first render", async () => {
    renderSidebarItems({
      storedOrder: ["github/main", "docs/main"],
    });

    expect(screen.queryByTestId("plugin-nav-sidebar-items")).toBeNull();

    registerPanel("docs", "Docs");
    registerPanel("github", "GitHub");

    await waitFor(() => {
      expect(panelRowNames(["Docs", "GitHub"])).toEqual(["GitHub", "Docs"]);
    });
  });

  it("orders only plugin pages and never seeds a host-owned Extensions key", async () => {
    registerPanel("docs", "Docs");
    renderSidebarItems({ storedOrder: ["docs/main"] });

    await waitFor(() => expect(panelRowNames(["Docs"])).toEqual(["Docs"]));
    expect(
      window.localStorage.getItem("bb.sidebar.pluginPanelOrder") ?? "",
    ).not.toContain("__builtin__");
  });
});

function LocationPath() {
  return <span data-testid="location-path">{useLocation().pathname}</span>;
}

describe("ExtensionsNavSidebarItem", () => {
  it("navigates independently of plugin ordering and has no panel menu", () => {
    render(
      <MemoryRouter initialEntries={["/"]}>
        <ExtensionsNavSidebarItem routePath="/extensions/plugins" />
        <LocationPath />
      </MemoryRouter>,
    );

    const extensionsRow = screen.getByRole("button", { name: "Extensions" });
    fireEvent.click(extensionsRow);

    expect(screen.getByTestId("location-path").textContent).toBe(
      "/extensions/plugins",
    );
    expect(
      screen.queryByRole("button", { name: "Extensions panel options" }),
    ).toBeNull();

    // The swap is CSS on the row's :hover, which jsdom cannot evaluate. What is
    // testable is that both glyphs share one swap container without reflow.
    expect(extensionsRow).toBeTruthy();
    const swap = extensionsRow.querySelector(".bb-sidebar-row-icon-swap");
    expect(swap).toBeTruthy();
    expect(
      swap?.querySelector('.bb-sidebar-row-icon-rest[data-icon="Toolbox"]'),
    ).toBeTruthy();
    expect(
      swap?.querySelector('.bb-sidebar-row-icon-hover[data-icon="ToolCase"]'),
    ).toBeTruthy();
  });
});

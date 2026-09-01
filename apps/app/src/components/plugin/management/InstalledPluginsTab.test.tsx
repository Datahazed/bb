// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";
import {
  EMPTY_PLUGIN_UPDATE_STATE,
  type PluginListItem,
} from "@/hooks/queries/plugin-settings-queries";
import {
  InstalledPluginCard,
  InstalledPluginsTab,
} from "./InstalledPluginsTab";

function plugin(overrides: Partial<PluginListItem> = {}): PluginListItem {
  return {
    id: "notify",
    source: "path:/tmp/bb-plugin-notify",
    rootDir: "/tmp/bb-plugin-notify",
    version: "0.2.1",
    enabled: true,
    status: "running",
    statusDetail: null,
    lastProblem: null,
    categoryId: null,
    category: null,
    description: "Desktop notifications when a thread needs you.",
    name: "Notify",
    icon: null,
    compactIconUrl: null,
    logoUrl: null,
    logoDarkUrl: null,
    hasSettings: false,
    provenance: "direct",
    isOrphanedBuiltin: false,
    catalogEntryId: null,
    publisherLabel: null,
    sourceDisplay: "path · /tmp/bb-plugin-notify",
    updateState: EMPTY_PLUGIN_UPDATE_STATE,
    handlerStats: { count: 0, totalMs: 0, maxMs: 0, errorCount: 0 },
    services: [],
    schedules: [],
    cliCommand: null,
    capabilities: [],
    app: { hasApp: false, bundle: null },
    ...overrides,
  };
}

function renderCard(item: PluginListItem) {
  const { wrapper: QueryClientWrapper } = createQueryClientTestHarness();
  return render(
    <MemoryRouter>
      <QueryClientWrapper>
        <InstalledPluginCard plugin={item} onUpdateClick={vi.fn()} />
      </QueryClientWrapper>
    </MemoryRouter>,
  );
}

afterEach(() => {
  cleanup();
});

describe("InstalledPluginCard", () => {
  it("opens the shared detail panel through the collection callback", () => {
    const onOpenPlugin = vi.fn();
    const { wrapper: QueryClientWrapper } = createQueryClientTestHarness();
    render(
      <MemoryRouter>
        <QueryClientWrapper>
          <InstalledPluginCard
            plugin={plugin()}
            onUpdateClick={vi.fn()}
            onOpenPlugin={onOpenPlugin}
          />
        </QueryClientWrapper>
      </MemoryRouter>,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Notify plugin details" }),
    );
    expect(onOpenPlugin).toHaveBeenCalledOnce();
    expect(onOpenPlugin).toHaveBeenCalledWith("notify");
  });

  it("replaces the description with one compact problem line", () => {
    renderCard(
      plugin({
        status: "incompatible",
        statusDetail: "requires bb >=0.38.0 <0.39.0, this is 0.39.0",
        lastProblem: {
          class: "incompatible",
          message: "requires bb >=0.38.0 <0.39.0, this is 0.39.0",
          at: Date.now(),
        },
      }),
    );

    expect(screen.queryByText(plugin().description ?? "")).toBeNull();
    expect(screen.getByTestId("plugin-problem-line-notify").textContent).toBe(
      "Not running — requires bb >=0.38.0 <0.39.0, this is 0.39.0 · just now",
    );
    expect(screen.queryByText("Incompatible")).toBeNull();
    const resourceCard = screen
      .getByTestId("plugin-card-notify")
      .querySelector(".rounded-lg");
    expect(resourceCard?.classList.contains("bg-surface-destructive")).toBe(
      true,
    );
    expect(
      resourceCard?.classList.contains("border-surface-destructive-border"),
    ).toBe(true);
    expect(resourceCard?.classList.contains("text-destructive-text")).toBe(
      true,
    );
    expect(
      screen
        .getByRole("switch", {
          name: "Disable notify (incompatible, not running)",
        })
        .getAttribute("aria-checked"),
    ).toBe("true");
  });

  it("renders a running plugin's durable error count as one attention pill", () => {
    renderCard(
      plugin({
        handlerStats: {
          count: 5,
          totalMs: 10,
          maxMs: 4,
          errorCount: 2,
        },
        lastProblem: {
          class: "error",
          message: "notification handler failed",
          at: Date.now(),
        },
      }),
    );

    const count = screen
      .getByText("2 errors")
      .closest("span.bg-surface-attention");
    expect(count?.classList.contains("bg-surface-attention")).toBe(true);
    expect(count?.classList.contains("text-warning-text")).toBe(true);
    expect(screen.getAllByText("2 errors")).toHaveLength(1);
    expect(screen.getByTestId("plugin-problem-line-notify").textContent).toBe(
      "2 errors, last just now — notification handler failed",
    );
  });

  it("uses the Browse card's category footer without repeating provenance", () => {
    renderCard(
      plugin({
        provenance: "catalog",
        publisherLabel: "BB Community",
        categoryId: "security",
        category: "Security",
      }),
    );

    const card = screen.getByTestId("plugin-card-notify");
    expect(card.textContent).not.toContain("BB Community");
    expect(card.textContent).toContain("Security");
  });

  it("shows a rolled-back update beside a still-available update", () => {
    renderCard(
      plugin({
        updateState: {
          ...EMPTY_PLUGIN_UPDATE_STATE,
          availableVersion: "0.3.0",
          lastFailure: {
            version: "0.3.0",
            at: Date.now(),
            detail: "Reload failed; restored 0.2.1.",
          },
        },
      }),
    );

    expect(
      screen.getByRole("button", {
        name: "Update failed: Reload failed; restored 0.2.1.",
      }),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Retry update to 0.3.0" }),
    ).toBeTruthy();
    expect(screen.queryByText("Retry")).toBeNull();
  });

  it("shows when update checks need attention", () => {
    renderCard(
      plugin({
        updateState: {
          ...EMPTY_PLUGIN_UPDATE_STATE,
          outcome: "unavailable",
          detail: "The source ref could not be verified.",
        },
      }),
    );

    expect(
      screen.getByRole("button", {
        name: "Needs attention: The source ref could not be verified.",
      }),
    ).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: /^Update(?: to| available)/u }),
    ).toBeNull();
  });

  it("keeps a current plugin quiet", () => {
    renderCard(plugin());

    expect(screen.queryByText("Update")).toBeNull();
    expect(
      screen.queryByRole("button", { name: /^Update(?: to| available)/u }),
    ).toBeNull();
  });
});

describe("InstalledPluginsTab", () => {
  it("renders installed plugins in one flat Browse-style card grid", () => {
    const securityPlugins = Array.from({ length: 7 }, (_, index) =>
      plugin({
        id: `security-${index}`,
        name: `Security ${index}`,
        categoryId: "security",
        category: "Security",
      }),
    );
    const memoryPlugins = Array.from({ length: 2 }, (_, index) =>
      plugin({
        id: `memory-${index}`,
        name: `Memory ${index}`,
        categoryId: "memory-and-context",
        category: "Memory & Context",
      }),
    );
    const { wrapper: QueryClientWrapper } = createQueryClientTestHarness();
    render(
      <MemoryRouter>
        <QueryClientWrapper>
          <InstalledPluginsTab
            plugins={[...securityPlugins, ...memoryPlugins]}
          />
        </QueryClientWrapper>
      </MemoryRouter>,
    );

    const securityCards = screen.getAllByTestId(/^plugin-card-security-/u);
    expect(securityCards).toHaveLength(7);
    expect(screen.getAllByTestId(/^plugin-card-memory-/u)).toHaveLength(2);
    expect(securityCards[0]?.parentElement?.classList.contains("grid")).toBe(
      true,
    );
    expect(
      document.querySelectorAll("[data-resource-list-panel]"),
    ).toHaveLength(0);
    expect(
      document.querySelector("[data-installed-plugin-shelves]"),
    ).toBeNull();
    expect(
      document.querySelector("[data-installed-plugin-category-header]"),
    ).toBeNull();
    expect(screen.getAllByText("Security")).toHaveLength(7);
    expect(screen.getAllByText("Memory & Context")).toHaveLength(2);
  });
});

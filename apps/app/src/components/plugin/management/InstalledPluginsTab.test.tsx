// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";
import {
  EMPTY_PLUGIN_UPDATE_STATE,
  type PluginListItem,
} from "@/hooks/queries/plugin-settings-queries";
import { InstalledPluginRow } from "./InstalledPluginsTab";

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

function renderRow(item: PluginListItem) {
  const { wrapper: QueryClientWrapper } = createQueryClientTestHarness();
  return render(
    <MemoryRouter>
      <QueryClientWrapper>
        <InstalledPluginRow plugin={item} onUpdateClick={vi.fn()} />
      </QueryClientWrapper>
    </MemoryRouter>,
  );
}

afterEach(() => {
  cleanup();
});

describe("InstalledPluginRow", () => {
  it("opens the shared detail panel through the collection callback", () => {
    const onOpenPlugin = vi.fn();
    const { wrapper: QueryClientWrapper } = createQueryClientTestHarness();
    render(
      <MemoryRouter>
        <QueryClientWrapper>
          <InstalledPluginRow
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
    renderRow(
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
    const resourceRow = screen
      .getByTestId("plugin-row-notify")
      .querySelector("[data-resource-row]");
    expect(resourceRow?.classList.contains("bg-surface-destructive")).toBe(
      true,
    );
    expect(
      resourceRow?.classList.contains("border-surface-destructive-border"),
    ).toBe(true);
    expect(resourceRow?.classList.contains("text-destructive-text")).toBe(true);
    // The switch stays "on" (the user enabled it) but says so honestly.
    expect(
      screen
        .getByRole("switch", {
          name: "Disable notify (incompatible, not running)",
        })
        .getAttribute("aria-checked"),
    ).toBe("true");
  });

  it("renders a running plugin's durable error count as one attention pill", () => {
    renderRow(
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

  it("does not repeat provenance or category as row pills", () => {
    renderRow(
      plugin({
        provenance: "catalog",
        publisherLabel: "BB Community",
        categoryId: "security",
        category: "Security",
      }),
    );

    const row = screen.getByTestId("plugin-row-notify");
    expect(row.textContent).not.toContain("BB Community");
    expect(row.textContent).not.toContain("Security");
  });
});

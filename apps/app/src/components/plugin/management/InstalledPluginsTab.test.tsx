// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
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
  it("keeps the description when the plugin has no problem", () => {
    renderRow(plugin());

    expect(
      screen.getByText("Desktop notifications when a thread needs you."),
    ).toBeTruthy();
    expect(screen.queryByTestId("plugin-problem-line-notify")).toBeNull();
  });

  it("shows the last problem and marks the switch when a plugin is not running", () => {
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

    expect(screen.getByTestId("plugin-problem-line-notify").textContent).toBe(
      "Not running — requires bb >=0.38.0 <0.39.0, this is 0.39.0 · just now",
    );
    expect(screen.queryByText("Incompatible")).toBeNull();
    expect(
      screen
        .getByRole("switch", {
          name: "Disable notify (incompatible, not running)",
        })
        .getAttribute("aria-checked"),
    ).toBe("true");
  });

  it("shows the stored handler error count and problem", () => {
    renderRow(
      plugin({
        handlerStats: { count: 5, totalMs: 10, maxMs: 4, errorCount: 2 },
        lastProblem: {
          class: "error",
          message: "notification handler failed",
          at: Date.now(),
        },
      }),
    );

    expect(screen.getByText("2 errors")).toBeTruthy();
    expect(screen.getByTestId("plugin-problem-line-notify").textContent).toBe(
      "2 errors, last just now — notification handler failed",
    );
  });

  it("does not call a needs-configuration plugin not running", () => {
    renderRow(
      plugin({
        status: "needs-configuration",
        statusDetail: "Set an API token.",
      }),
    );

    expect(screen.getByTestId("plugin-problem-line-notify").textContent).toBe(
      "Not running — needs configuration in its settings",
    );
    expect(screen.queryByTestId("plugin-not-running-notify")).toBeNull();
  });
});

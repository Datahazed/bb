// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";
import { EMPTY_PLUGIN_UPDATE_STATE } from "@/hooks/queries/plugin-settings-queries";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";
import { PluginDetail } from "./ToolsView";

const GITHUB_PLUGIN = {
  id: "github",
  source: "github-release:ymichael/bb/bb-plugin-github-{version}.tgz@^0.1.0",
  isBuiltin: false,
  rootDir: "/managed/plugins/github",
  version: "0.1.0",
  enabled: true,
  status: "running",
  statusDetail: null,
  description: "Browse GitHub issues and pull requests in BB.",
  displayName: "GitHub",
  icon: "Github",
  logoUrl: null,
  logoDarkUrl: null,
  hasSettings: false,
  handlerStats: { count: 0, totalMs: 0, maxMs: 0, errorCount: 0 },
  services: [],
  schedules: [],
  cliCommand: null,
  app: { hasApp: true },
  provenance: "marketplace" as const,
  marketplaceName: "BB Official",
  sourceDisplay: "BB Official · GitHub",
  updateState: EMPTY_PLUGIN_UPDATE_STATE,
};

afterEach(cleanup);

describe("PluginDetail marketplace lifecycle", () => {
  it("keeps marketplace provenance and update management in the unified detail taxonomy", async () => {
    const { wrapper: QueryClientWrapper } = createQueryClientTestHarness();
    render(
      <MemoryRouter>
        <QueryClientWrapper>
          <PluginDetail
            isLoading={false}
            plugin={GITHUB_PLUGIN}
            pending={false}
            editDisabled
            onToggle={() => {}}
            onReload={() => {}}
            onEdit={() => {}}
            onDelete={() => {}}
            onBack={() => {}}
          />
        </QueryClientWrapper>
      </MemoryRouter>,
    );

    expect(screen.getByText("From BB Official")).toBeTruthy();
    expect(screen.getByText("About")).toBeTruthy();
    expect(
      screen.getByText("Browse GitHub issues and pull requests in BB."),
    ).toBeTruthy();
    expect(screen.getByText("Release")).toBeTruthy();
    expect(screen.getByText("0.1.0")).toBeTruthy();
    expect(screen.getByText("BB Official · GitHub")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Check now" })).toBeTruthy();

    fireEvent.pointerDown(
      screen.getByRole("button", { name: "GitHub actions" }),
      { button: 0 },
    );
    expect(
      await screen.findByRole("menuitem", { name: "Uninstall" }),
    ).toBeTruthy();
  });
});

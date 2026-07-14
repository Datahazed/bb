import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import {
  EMPTY_PLUGIN_UPDATE_STATE,
  type PluginListItem,
} from "@/hooks/queries/plugin-settings-queries";
import { ResourceTemplateBrowseCard } from "@bb/shared-ui/resource-list";
import { PluginListRow } from "./ToolsView";

function makePlugin(overrides: Partial<PluginListItem> = {}): PluginListItem {
  return {
    id: "linear",
    source: "path:/plugins/linear",
    isBuiltin: false,
    rootDir: "/plugins/linear",
    version: "0.1.0",
    enabled: true,
    status: "running",
    statusDetail: null,
    description: "Linear integration.",
    displayName: "Linear",
    icon: null,
    logoUrl: null,
    logoDarkUrl: null,
    hasSettings: false,
    handlerStats: { count: 0, totalMs: 0, maxMs: 0, errorCount: 0 },
    services: [],
    schedules: [],
    cliCommand: null,
    app: { hasApp: false },
    provenance: "direct",
    marketplaceName: null,
    sourceDisplay: "path · /plugins/linear",
    updateState: EMPTY_PLUGIN_UPDATE_STATE,
    ...overrides,
  };
}

function renderPluginRow({
  pending = false,
  editDisabled = false,
}: {
  pending?: boolean;
  editDisabled?: boolean;
} = {}): string {
  return renderToStaticMarkup(
    <MemoryRouter>
      <PluginListRow
        plugin={makePlugin()}
        pending={pending}
        editDisabled={editDisabled}
        onToggle={() => {}}
        onEdit={() => {}}
        onDelete={() => {}}
      />
    </MemoryRouter>,
  );
}

describe("PluginListRow", () => {
  it("shows lifecycle and management controls for user-installed plugins", () => {
    const markup = renderPluginRow();

    expect(markup).toContain('aria-label="Edit linear"');
    expect(markup).toContain('aria-label="Remove from bb linear"');
    expect(markup).not.toContain("group-hover:translate-x-1");
    expect(markup).toContain("hover:bg-state-hover");
    expect(markup).toContain('aria-label="Disable linear"');
  });

  it("limits built-in plugins to enable or disable", () => {
    const markup = renderToStaticMarkup(
      <MemoryRouter>
        <PluginListRow
          plugin={makePlugin({
            id: "connect",
            source: "builtin:connect",
            isBuiltin: true,
          })}
          pending={false}
          editDisabled={false}
          onToggle={() => {}}
          onEdit={() => {}}
          onDelete={() => {}}
        />
      </MemoryRouter>,
    );

    expect(markup).toContain('aria-label="Disable connect"');
    expect(markup).not.toContain('aria-label="Edit connect"');
    expect(markup).not.toContain('aria-label="Remove from bb connect"');
  });

  it("disables row actions while a plugin mutation is pending", () => {
    const markup = renderPluginRow({ pending: true });

    expect(markup.match(/disabled=""/g)).toHaveLength(3);
  });

  it("disables edit when the plugin directory cannot be opened", () => {
    const markup = renderPluginRow({ editDisabled: true });

    expect(markup).toMatch(/aria-label="Edit linear"[^>]*disabled=""/);
    expect(markup).not.toMatch(
      /aria-label="Remove from bb linear"[^>]*disabled=""/,
    );
  });

  it("does not expose source editing for registry-installed plugins", () => {
    const markup = renderToStaticMarkup(
      <MemoryRouter>
        <PluginListRow
          plugin={makePlugin({
            source: "npm:bb-plugin-linear@0.1.0",
            rootDir: "/managed/plugins/linear",
          })}
          pending={false}
          editDisabled={false}
          onToggle={() => {}}
          onEdit={() => {}}
          onDelete={() => {}}
        />
      </MemoryRouter>,
    );

    expect(markup).not.toContain('aria-label="Edit linear"');
    expect(markup).toContain('aria-label="Uninstall linear"');
  });
});

describe("ResourceTemplateBrowseCard", () => {
  it("reserves three lines for long template descriptions", () => {
    const markup = renderToStaticMarkup(
      <ResourceTemplateBrowseCard
        title="Long-running review"
        description="Review every active project, summarize new failures, group repeated causes, and open follow-up threads only when intervention is needed."
        onUse={() => {}}
      />,
    );

    expect(markup).toContain("min-h-20 line-clamp-3");
    expect(markup).toContain("group repeated causes");
  });
});

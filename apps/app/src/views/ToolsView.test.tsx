import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import type { PluginListItem } from "@/hooks/queries/plugin-settings-queries";
import { PluginListRow } from "./ToolsView";

function makePlugin(overrides: Partial<PluginListItem> = {}): PluginListItem {
  return {
    id: "linear",
    source: "path:/plugins/linear",
    rootDir: "/plugins/linear",
    version: "0.1.0",
    enabled: true,
    status: "running",
    statusDetail: null,
    description: "Linear integration.",
    displayName: "Linear",
    logoUrl: null,
    logoDarkUrl: null,
    hasSettings: false,
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
        onEdit={() => {}}
        onDelete={() => {}}
      />
    </MemoryRouter>,
  );
}

describe("PluginListRow", () => {
  it("uses edit and delete hover actions instead of lifecycle controls", () => {
    const markup = renderPluginRow();

    expect(markup).toContain('aria-label="Edit linear"');
    expect(markup).toContain('aria-label="Delete linear"');
    expect(markup).not.toContain('aria-label="Disable linear"');
    expect(markup).not.toContain('aria-label="Enable linear"');
  });

  it("disables row actions while a plugin mutation is pending", () => {
    const markup = renderPluginRow({ pending: true });

    expect(markup.match(/disabled=""/g)).toHaveLength(2);
  });

  it("disables edit when the plugin directory cannot be opened", () => {
    const markup = renderPluginRow({ editDisabled: true });

    expect(markup).toMatch(/aria-label="Edit linear"[^>]*disabled=""/);
    expect(markup).not.toMatch(/aria-label="Delete linear"[^>]*disabled=""/);
  });
});

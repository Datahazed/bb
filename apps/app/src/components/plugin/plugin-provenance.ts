import type { PluginListItem } from "@/hooks/queries/plugin-settings-queries";

export type PluginSourceFilter = "all" | PluginListItem["provenance"];

export const PLUGIN_SOURCE_FILTER_OPTIONS: readonly {
  id: PluginSourceFilter;
  label: string;
}[] = [
  { id: "all", label: "All sources" },
  { id: "builtin", label: "BB Official" },
  { id: "catalog", label: "BB Community" },
  { id: "direct", label: "Local" },
];

export function pluginSourceFilterId(
  plugin: PluginListItem,
): PluginListItem["provenance"] {
  return plugin.provenance;
}

export function pluginSourceFilterLabel(value: PluginSourceFilter): string {
  return (
    PLUGIN_SOURCE_FILTER_OPTIONS.find((option) => option.id === value)?.label ??
    "All sources"
  );
}

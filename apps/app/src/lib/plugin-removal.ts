import type { PluginListItem } from "@/hooks/queries/plugin-settings-queries";

export function pluginIsLocalSource(plugin: PluginListItem): boolean {
  return plugin.source.startsWith("path:");
}

export function pluginRemovalLabel(plugin: PluginListItem): string {
  return pluginIsLocalSource(plugin) ? "Remove from bb" : "Uninstall";
}

/**
 * Describe the server's removal behavior without implying that a local
 * plugin's source directory will be deleted.
 */
export function pluginRemovalDescription(plugin: PluginListItem): string {
  return pluginIsLocalSource(plugin)
    ? `Remove "${plugin.id}" from bb and delete its settings, secrets, and schedules? Its source files stay on disk. To move it to another directory, install the new path instead; that keeps its settings.`
    : `Uninstall "${plugin.id}" and delete its managed files, settings, secrets, and schedules?`;
}

import type { PluginListItem } from "@/hooks/queries/plugin-settings-queries";

/**
 * Removal policy and copy for an installed plugin, shared by every surface that
 * offers it: the Extensions detail page and the sidebar panel-row menu. One
 * home keeps the two menus from disagreeing about what "Uninstall" does to the
 * files on disk.
 */

/** A `path:` install: bb registered a directory it does not own. */
export function pluginIsLocalSource(plugin: PluginListItem): boolean {
  return plugin.source.startsWith("path:");
}

export function pluginRemovalLabel(plugin: PluginListItem): string {
  return pluginIsLocalSource(plugin) ? "Remove from bb" : "Uninstall";
}

/**
 * Why removal is unavailable, or null while it is allowed. DELETE
 * /plugins/:id answers 409 for a plugin that ships with bb, so the menus
 * refuse it up front instead of surfacing a server error the user cannot act
 * on.
 */
export function pluginRemovalBlockedReason(
  plugin: PluginListItem,
): string | null {
  return plugin.provenance === "builtin"
    ? "Included with BB; disable this plugin instead."
    : null;
}

export interface PluginRemovalConfirmCopy {
  title: string;
  description: string;
}

/** Confirmation wording, which turns on whether bb deletes the files. */
export function pluginRemovalConfirmCopy(
  plugin: PluginListItem,
): PluginRemovalConfirmCopy {
  return pluginIsLocalSource(plugin)
    ? {
        title: "Remove plugin from bb?",
        description: `Remove "${plugin.id}" from bb? Its source files will stay on disk.`,
      }
    : {
        title: "Uninstall plugin?",
        description: `Uninstall "${plugin.id}" and delete its managed files and settings?`,
      };
}

export function pluginRemovalSuccessMessage(plugin: PluginListItem): string {
  return pluginIsLocalSource(plugin)
    ? "Plugin removed from bb"
    : "Plugin uninstalled";
}

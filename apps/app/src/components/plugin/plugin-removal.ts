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

/**
 * Whether removal actually deletes the plugin's files. Only a tree bb fetched
 * itself is deleted: a `path:` source is the user's own directory, and a
 * `builtin:` source — which an official catalog entry can also install from —
 * is left in place behind a removal marker. Promising deletion for either
 * would be a lie the server never carries out.
 */
export function pluginRemovalDeletesFiles(plugin: PluginListItem): boolean {
  return (
    !plugin.source.startsWith("path:") && !plugin.source.startsWith("builtin:")
  );
}

export interface PluginRemovalConfirmCopy {
  title: string;
  description: string;
}

/** Confirmation wording, which turns on what removal does to the files. */
export function pluginRemovalConfirmCopy(
  plugin: PluginListItem,
): PluginRemovalConfirmCopy {
  if (pluginIsLocalSource(plugin)) {
    return {
      title: "Remove plugin from bb?",
      description: `Remove "${plugin.id}" from bb and delete its settings? Its source files will stay on disk.`,
    };
  }
  return {
    title: "Uninstall plugin?",
    description: pluginRemovalDeletesFiles(plugin)
      ? `Uninstall "${plugin.id}" and delete its downloaded files and settings?`
      : `Uninstall "${plugin.id}" and delete its settings? Its bundled files stay on disk.`,
  };
}

export function pluginRemovalSuccessMessage(plugin: PluginListItem): string {
  return pluginIsLocalSource(plugin)
    ? "Plugin removed from bb"
    : "Plugin uninstalled";
}

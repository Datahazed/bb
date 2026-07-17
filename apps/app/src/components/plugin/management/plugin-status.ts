import type { PluginListItem } from "@/hooks/queries/plugin-settings-queries";

export interface PluginRuntimeStatusPresentation {
  label: string;
  tone: "error" | "warning";
  recovery: string;
}

type RuntimeStatusDefinition = Omit<
  PluginRuntimeStatusPresentation,
  "recovery"
>;

/**
 * Canonical user-facing projection of plugin runtime health. Enabled/disabled
 * remains lifecycle state, while updates remain release state; neither is
 * folded into this health vocabulary.
 */
const RUNTIME_STATUS_DEFINITIONS: Partial<
  Record<PluginListItem["status"], RuntimeStatusDefinition>
> = {
  error: { label: "Error", tone: "error" },
  incompatible: { label: "Incompatible", tone: "error" },
  missing: { label: "Missing", tone: "error" },
  "needs-configuration": { label: "Setup required", tone: "warning" },
  degraded: { label: "Degraded", tone: "warning" },
};

function pluginRuntimeRecovery(plugin: PluginListItem): string {
  switch (plugin.status) {
    case "error":
      if (plugin.source.startsWith("path:")) {
        return "Edit the plugin, then reload it.";
      }
      if (plugin.provenance === "builtin") {
        return "Reload the plugin. If the error continues, restart bb.";
      }
      return "Reload the plugin. If the error continues, reinstall it.";
    case "incompatible":
      return plugin.provenance === "builtin"
        ? "Update bb to load a compatible bundled plugin."
        : "Install a plugin version compatible with this version of bb.";
    case "missing":
      return "Reinstall the plugin or remove this entry.";
    case "needs-configuration":
      return plugin.hasSettings
        ? "Complete the Settings section; bb reloads the plugin after you save."
        : "Add the required configuration, then reload the plugin.";
    case "degraded":
      return "Reload the plugin. If it remains degraded, restart bb.";
    default:
      return "";
  }
}

export function pluginRuntimeStatusPresentation(
  plugin: PluginListItem,
): PluginRuntimeStatusPresentation | null {
  const definition = RUNTIME_STATUS_DEFINITIONS[plugin.status];
  if (definition === undefined) return null;
  return { ...definition, recovery: pluginRuntimeRecovery(plugin) };
}

/**
 * A plugin row earns at most one signal. Actions use a pill; passive runtime
 * health uses a specific inline status. A failed update that rolled back
 * outranks an available update — the user should know a rollback happened
 * before applying anything else. Newer-but-incompatible releases and pinned
 * sources never signal the list; they surface on the detail page.
 */
export type PluginRowSignal =
  | { kind: "update"; version: string }
  | {
      kind: "status";
      label: string;
      tone: "error" | "warning";
      detail: string | null;
    };

export function pluginRowSignal(
  plugin: PluginListItem,
): PluginRowSignal | null {
  const state = plugin.updateState;
  // A rollback wins the row's single signal slot even when the same plugin
  // still has an available candidate.
  if (state.lastFailure !== null) {
    return {
      kind: "status",
      label: "Update failed",
      tone: "error",
      detail:
        state.lastFailure.detail.length > 0
          ? state.lastFailure.detail
          : `Update to ${state.lastFailure.version} failed and was rolled back.`,
    };
  }
  const runtimeStatus = pluginRuntimeStatusPresentation(plugin);
  if (runtimeStatus !== null) {
    return {
      kind: "status",
      label: runtimeStatus.label,
      tone: runtimeStatus.tone,
      detail: plugin.statusDetail,
    };
  }
  if (state.availableVersion !== null) {
    return { kind: "update", version: state.availableVersion };
  }
  return null;
}

/** The detail-page banner mirrors the row pill's update case. */
export function pluginUpdateAvailableVersion(
  plugin: PluginListItem,
): string | null {
  const signal = pluginRowSignal(plugin);
  return signal?.kind === "update" ? signal.version : null;
}

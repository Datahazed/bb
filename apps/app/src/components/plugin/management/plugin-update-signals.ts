import type { PluginListItem } from "@/hooks/queries/plugin-settings-queries";

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

const RUNTIME_STATUS_SIGNALS: Partial<
  Record<PluginListItem["status"], { label: string; tone: "error" | "warning" }>
> = {
  error: { label: "Failed to load", tone: "error" },
  incompatible: { label: "Incompatible", tone: "error" },
  missing: { label: "Missing", tone: "error" },
  "needs-configuration": { label: "Setup required", tone: "warning" },
  degraded: { label: "Degraded", tone: "warning" },
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
  const runtimeSignal = RUNTIME_STATUS_SIGNALS[plugin.status];
  if (runtimeSignal !== undefined) {
    return {
      kind: "status",
      ...runtimeSignal,
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

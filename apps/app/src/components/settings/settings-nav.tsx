import { useEffect } from "react";
import { matchPath, useLocation } from "react-router-dom";
import type { IconName } from "@bb/shared-ui/icon";
import { useHostDaemon, useLocalHostDaemonAccess } from "@/hooks/useHostDaemon";
import { usePluginSlots } from "@/lib/plugin-slots";
import { requestProviderPluginFrontend } from "@/lib/plugin-frontend-lazy";
import { usePluginList } from "@/hooks/queries/plugin-settings-queries";
import {
  SETTINGS_MACHINE_ROUTE_PATH,
  SETTINGS_PLUGIN_ROUTE_PATH,
  SETTINGS_SECTION_ROUTE_PATH,
} from "@/lib/route-paths";

/**
 * The settings buckets: shared between the settings sidebar (which replaces
 * the app sidebar on /settings routes) and SettingsView (which renders the
 * selected bucket's content).
 */
export const SETTINGS_NAV_SECTIONS = [
  { icon: "Settings", id: "general", label: "General" },
  { icon: "Bot", id: "providers", label: "Providers" },
  { icon: "Palette", id: "appearance", label: "Appearance" },
  { icon: "SlidersHorizontal", id: "keyboard", label: "Keyboard" },
  { icon: "ChartColumn", id: "usage", label: "Usage limits" },
  { icon: "Folder", id: "files", label: "Files" },
  { icon: "Laptop", id: "machines", label: "Machines" },
  { icon: "PackageReceive", id: "updates", label: "Updates" },
  { icon: "Puzzle", id: "marketplaces", label: "Plugin marketplaces" },
  { icon: "Beaker", id: "experiments", label: "Experiments" },
  { icon: "MessageSquare", id: "community", label: "Community" },
  { icon: "Archive", id: "archived", label: "Archived threads" },
] as const satisfies readonly {
  icon: IconName;
  id: string;
  label: string;
}[];

type SettingsNavSection = (typeof SETTINGS_NAV_SECTIONS)[number];

export type SettingsSectionId = SettingsNavSection["id"];

function isSettingsSectionId(value: string): value is SettingsSectionId {
  return SETTINGS_NAV_SECTIONS.some((section) => section.id === value);
}

export interface SettingsNavState {
  /** Selected bucket; null while a plugin page is active. */
  activeSection: SettingsSectionId | null;
  /** True when the :section URL segment is unknown (the view redirects). */
  hasUnknownSection: boolean;
  /** The plugin whose settings page is open, when on /settings/plugins/:id. */
  activePluginId: string | null;
  /** Enabled plugins with configuration, for the sidebar's Plugins group. */
  pluginEntries: readonly { id: string; label: string; icon: string | null }[];
  /** Buckets visible on this host. */
  sections: readonly SettingsNavSection[];
}

/**
 * URL → settings navigation state. Uses matchPath on the location (not
 * useParams) so it works both inside the settings route element and in the
 * sidebar, which mounts outside the route tree.
 */
export function useSettingsNavState(): SettingsNavState {
  const location = useLocation();
  const { hasDaemon } = useHostDaemon();
  const { accessState } = useLocalHostDaemonAccess();
  const { fileOpeners, settingsSections } = usePluginSlots();
  const pluginListQuery = usePluginList({ enabled: true });
  // A provider plugin's bundle is deferred until a thread of its provider
  // opens, but a settingsSection it registers (the Pi model editor) is what
  // earns it a row here: ask for every enabled provider plugin's bundle while
  // Settings is open. A no-op for plugins without one.
  const plugins = pluginListQuery.data?.plugins;
  useEffect(() => {
    for (const plugin of plugins ?? []) {
      if (plugin.enabled && plugin.app.hasApp && plugin.providerIds.length > 0) {
        requestProviderPluginFrontend(plugin.id);
      }
    }
  }, [plugins]);

  const sectionMatch = matchPath(
    SETTINGS_SECTION_ROUTE_PATH,
    location.pathname,
  );
  const pluginMatch = matchPath(SETTINGS_PLUGIN_ROUTE_PATH, location.pathname);
  const activePluginId = pluginMatch?.params.pluginId ?? null;
  // A machine page keeps the Machines bucket selected in the sidebar.
  const machineMatch = matchPath(
    SETTINGS_MACHINE_ROUTE_PATH,
    location.pathname,
  );
  const activeMachineId = machineMatch?.params.hostId ?? null;
  const sectionParam = sectionMatch?.params.section;
  const hasUnknownSection =
    sectionParam !== undefined && !isSettingsSectionId(sectionParam);
  const activeSection: SettingsSectionId | null =
    activeMachineId !== null
      ? "machines"
      : activePluginId !== null
        ? null
        : sectionParam !== undefined && isSettingsSectionId(sectionParam)
          ? sectionParam
          : "general";

  const sections = SETTINGS_NAV_SECTIONS.filter((section) => {
    if (section.id === "files") {
      return (
        hasDaemon || accessState !== "unavailable" || fileOpeners.length > 0
      );
    }
    return true;
  });
  // A plugin earns a Settings row by actually having configuration: a
  // declarative settings form or a mounted settingsSection slot.
  const pluginEntries = (pluginListQuery.data?.plugins ?? [])
    .filter(
      (plugin) =>
        plugin.enabled &&
        (plugin.hasSettings ||
          settingsSections.some((section) => section.pluginId === plugin.id)),
    )
    .map((plugin) => ({
      id: plugin.id,
      label: plugin.name ?? plugin.id,
      icon: plugin.icon,
    }))
    .sort((left, right) => left.label.localeCompare(right.label));

  return {
    activePluginId,
    activeSection,
    hasUnknownSection,
    pluginEntries,
    sections,
  };
}

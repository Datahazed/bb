import { useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useSetAtom } from "jotai";
import { appToast } from "@/components/ui/app-toast";
import { invalidatePluginList } from "@/hooks/cache-owners/plugin-cache-owner";
import {
  removePlugin,
  setPluginEnabled,
  type PluginListItem,
} from "@/hooks/queries/plugin-settings-queries";
import { pluginAdminErrorMessage } from "@/lib/plugin-admin-error";
import { closePanesForPluginAtom } from "@/lib/split-layout/atoms";
import { paneContentRoute } from "@/views/thread-detail/splitThreadNavigation";
import {
  getRootComposeRoutePath,
  isPluginPanelRoutePath,
} from "@/lib/route-paths";
import { pluginRemovalSuccessMessage } from "./plugin-removal";

/**
 * Enable/disable and uninstall for an installed plugin, shared by every surface
 * that offers them: the sidebar row's menu and the Extensions detail page.
 *
 * The surfaces used to own a mutation pair each, and they drifted — the detail
 * page kept navigating away from a removed plugin while never dropping the
 * split panes its panels left behind. What has to happen on every surface lives
 * here; only where to go afterwards is the caller's business.
 */
export interface PluginLifecycleOptions {
  /**
   * Runs after a removal has settled, for a surface whose own page dies with
   * the plugin. Leaving a dead *panel* route is handled here, since that is
   * true everywhere.
   */
  onRemoved?: (plugin: PluginListItem) => void;
}

export interface PluginLifecycle {
  /** The plugin with a lifecycle request in flight, if any. */
  pendingPluginId: string | null;
  toggleEnabled: (plugin: PluginListItem) => void;
  requestRemove: (plugin: PluginListItem) => void;
  /** The plugin awaiting removal confirmation, if any. */
  removeTarget: PluginListItem | null;
  removePending: boolean;
  confirmRemove: () => void;
  cancelRemove: () => void;
}

export function usePluginLifecycle(
  options: PluginLifecycleOptions = {},
): PluginLifecycle {
  const { onRemoved } = options;
  const location = useLocation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const closePanesForPlugin = useSetAtom(closePanesForPluginAtom);
  const [removeTarget, setRemoveTarget] = useState<PluginListItem | null>(null);

  const isOnPanelRouteFor = (plugin: PluginListItem) =>
    isPluginPanelRoutePath({
      pathname: location.pathname,
      pluginId: plugin.id,
    });

  const toggleEnabled = useMutation({
    mutationFn: (plugin: PluginListItem) =>
      setPluginEnabled(fetch, plugin.id, !plugin.enabled),
    onSuccess: (_result, plugin) => {
      invalidatePluginList({ queryClient });
      if (!plugin.enabled) return;
      // Disabling unregisters the plugin's panels the same way uninstalling
      // does, so staying would strand the window on a dead route with the row
      // that opened it gone from the sidebar — and reload would return to it.
      // The row's disappearance is the visible confirmation; the placeholder is
      // not. Unlike an uninstall this leaves the split panes alone: disable is
      // reversible, and re-enabling should restore the arrangement.
      if (isOnPanelRouteFor(plugin)) void navigate(getRootComposeRoutePath());
    },
    onError: (error, plugin) => {
      appToast.error(
        `${plugin.enabled ? "Disabling" : "Enabling"} ${
          plugin.name ?? plugin.id
        } failed`,
        { description: pluginAdminErrorMessage(error) },
      );
    },
  });

  const remove = useMutation({
    mutationFn: (plugin: PluginListItem) => removePlugin(fetch, plugin.id),
    onSuccess: (_result, plugin) => {
      setRemoveTarget(null);
      invalidatePluginList({ queryClient });
      appToast.success(pluginRemovalSuccessMessage(plugin));
      // The plugin's panels are unregistered now, so every surface still
      // pointing at one would render the "panel is not available" placeholder
      // for a page nothing can restore — and the split layout is persisted, so
      // reload would bring it back. Drop the panes first, then move the window
      // off the dead route to whatever pane kept focus.
      const closed = closePanesForPlugin(plugin.id);
      if (isOnPanelRouteFor(plugin)) {
        void navigate(
          closed.focusedContent === null
            ? getRootComposeRoutePath()
            : paneContentRoute(closed.focusedContent),
        );
      }
      onRemoved?.(plugin);
    },
    onError: (error, plugin) => {
      appToast.error(`Removing ${plugin.name ?? plugin.id} failed`, {
        description: pluginAdminErrorMessage(error),
      });
    },
  });

  const pendingPluginId = toggleEnabled.isPending
    ? (toggleEnabled.variables?.id ?? null)
    : remove.isPending
      ? (remove.variables?.id ?? null)
      : null;

  return {
    pendingPluginId,
    toggleEnabled: (plugin) => toggleEnabled.mutate(plugin),
    requestRemove: (plugin) => setRemoveTarget(plugin),
    removeTarget,
    removePending: remove.isPending,
    confirmRemove: () => {
      if (removeTarget !== null) remove.mutate(removeTarget);
    },
    cancelRemove: () => setRemoveTarget(null),
  };
}

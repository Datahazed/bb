import { useMutation, useQueryClient } from "@tanstack/react-query";
import { MapsIcon, MapsLocation02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useNavigate } from "react-router-dom";
import { Button } from "@bb/shared-ui/button";
import { Icon } from "@bb/shared-ui/icon";
import { appToast } from "@/components/ui/app-toast";
import { invalidatePluginList } from "@/hooks/cache-owners/plugin-cache-owner";
import {
  setPluginEnabled,
  type PluginListItem,
} from "@/hooks/queries/plugin-settings-queries";
import { schedulePluginFrontendReconcile } from "@/lib/plugin-frontend-lazy";
import {
  getPluginSlotSnapshot,
  subscribePluginSlots,
} from "@/lib/plugin-slots";
import { getPluginPanelRoutePath } from "@/lib/route-paths";

const PLUGIN_GUIDE_ID = "plugin-api-docs";
const PLUGIN_GUIDE_PANEL_PATH = "plugin-api";
const PLUGIN_GUIDE_LOAD_TIMEOUT_MS = 10_000;

function isPluginGuidePanelRegistered(): boolean {
  return getPluginSlotSnapshot().navPanels.some(
    (panel) =>
      panel.pluginId === PLUGIN_GUIDE_ID &&
      panel.path === PLUGIN_GUIDE_PANEL_PATH,
  );
}

function waitForPluginGuidePanel(): Promise<void> {
  if (isPluginGuidePanelRegistered()) return Promise.resolve();

  return new Promise((resolve, reject) => {
    let settled = false;
    const unsubscribe = subscribePluginSlots(() => {
      if (!isPluginGuidePanelRegistered() || settled) return;
      settled = true;
      window.clearTimeout(timeoutId);
      unsubscribe();
      resolve();
    });
    const timeoutId = window.setTimeout(() => {
      if (settled) return;
      settled = true;
      unsubscribe();
      reject(new Error("The guide did not finish loading. Try again."));
    }, PLUGIN_GUIDE_LOAD_TIMEOUT_MS);

    if (isPluginGuidePanelRegistered()) {
      settled = true;
      window.clearTimeout(timeoutId);
      unsubscribe();
      resolve();
    }
  });
}

export function OpenPluginGuideButton({
  plugin,
  pluginListLoading,
}: {
  plugin: PluginListItem | undefined;
  pluginListLoading: boolean;
}) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const openGuide = useMutation({
    mutationFn: async () => {
      if (plugin === undefined) {
        throw new Error("Plugin Guide is not installed.");
      }

      if (!plugin.enabled) {
        await setPluginEnabled(fetch, PLUGIN_GUIDE_ID, true);
        void invalidatePluginList({ queryClient });
        schedulePluginFrontendReconcile();
        await waitForPluginGuidePanel();
      }

      navigate(
        getPluginPanelRoutePath({
          pluginId: PLUGIN_GUIDE_ID,
          path: PLUGIN_GUIDE_PANEL_PATH,
        }),
      );
    },
    onError: (error) => {
      appToast.error("Couldn’t open Plugin Guide", {
        description: error instanceof Error ? error.message : String(error),
      });
    },
  });

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className="group"
      disabled={pluginListLoading || openGuide.isPending}
      aria-busy={openGuide.isPending}
      onClick={() => openGuide.mutate()}
    >
      {openGuide.isPending ? (
        <Icon name="Spinner" className="animate-spin" aria-hidden />
      ) : (
        <span className="relative size-4 shrink-0" aria-hidden>
          <HugeiconsIcon
            icon={MapsIcon}
            className="absolute inset-0 opacity-100 transition-opacity group-hover:opacity-0 group-focus-visible:opacity-0"
          />
          <HugeiconsIcon
            icon={MapsLocation02Icon}
            className="absolute inset-0 opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
          />
        </span>
      )}
      <span className="grid">
        <span className="invisible col-start-1 row-start-1">
          Open Plugin Guide
        </span>
        <span className="col-start-1 row-start-1">
          {openGuide.isPending ? "Opening…" : "Open Plugin Guide"}
        </span>
      </span>
    </Button>
  );
}

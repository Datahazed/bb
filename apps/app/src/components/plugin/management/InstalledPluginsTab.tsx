import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { Switch } from "@bb/shared-ui/switch";
import { Pill } from "@bb/shared-ui/pill";
import {
  ResourceListPanel,
  ResourceRow,
  ResourceRowDetailChevron,
} from "@bb/shared-ui/resource-list";
import { appToast } from "@/components/ui/app-toast.js";
import { invalidatePluginList } from "@/hooks/cache-owners/plugin-cache-owner";
import {
  setPluginEnabled,
  type PluginListItem,
} from "@/hooks/queries/plugin-settings-queries";
import { pluginNeedsAttention } from "@/hooks/usePluginAttention";
import { getPluginDetailRoutePath } from "@/lib/route-paths";
import { pluginRowSignal, installedPluginProblemLine } from "./plugin-status";
import { PluginRowSignalView, PluginSignalLogo } from "./PluginRowSignal";
import { UpdatePluginDialog } from "./UpdatePluginDialog";
import { PluginLogo } from "./plugin-ui";

/**
 * Every row keeps the same logo, name, description, and switch shape. Runtime
 * trouble replaces the description with one compact problem line; fatal
 * states tint the row and running handler failures use the attention pill.
 * Source and category belong to the list filters, never repeated row badges.
 * An available update remains the row's one action pill and opens the existing
 * confirmation directly.
 */
export function InstalledPluginsTab({
  plugins,
  onOpenPlugin,
}: {
  plugins: readonly PluginListItem[];
  onOpenPlugin?: (pluginId: string) => void;
}) {
  const [updateTargetId, setUpdateTargetId] = useState<string | null>(null);
  const updateTarget =
    updateTargetId === null
      ? null
      : (plugins.find((plugin) => plugin.id === updateTargetId) ?? null);

  if (plugins.length === 0) {
    return null;
  }

  return (
    <>
      <ResourceListPanel>
        <div className="divide-y divide-border">
          {plugins.map((plugin) => (
            <InstalledPluginRow
              key={plugin.id}
              plugin={plugin}
              onUpdateClick={() => setUpdateTargetId(plugin.id)}
              onOpenPlugin={onOpenPlugin}
            />
          ))}
        </div>
      </ResourceListPanel>
      {updateTarget !== null ? (
        <UpdatePluginDialog
          plugin={updateTarget}
          open
          onOpenChange={(open) => {
            if (!open) setUpdateTargetId(null);
          }}
        />
      ) : null}
    </>
  );
}

/** Exported for tests (pill states + enable/disable round-trip). */
export function InstalledPluginRow({
  plugin,
  onUpdateClick,
  onOpenPlugin,
}: {
  plugin: PluginListItem;
  onUpdateClick: () => void;
  onOpenPlugin?: (pluginId: string) => void;
}) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const toggle = useMutation({
    mutationFn: (enabled: boolean) =>
      setPluginEnabled(fetch, plugin.id, enabled),
    onError: (error, enabled) => {
      appToast.error(
        `${enabled ? "Enabling" : "Disabling"} ${plugin.id} failed`,
        {
          description: error instanceof Error ? error.message : String(error),
        },
      );
    },
    onSettled: () => invalidatePluginList({ queryClient }),
  });
  // Reflect the in-flight target immediately; the invalidated list settles it.
  const enabled = toggle.isPending ? toggle.variables : plugin.enabled;
  const signal = pluginRowSignal(plugin);
  const statusSignal = signal?.kind === "status" ? signal : null;
  // Update health and an available candidate are independent facts. A failed
  // attempt can roll back successfully while the same candidate remains
  // available, so the badge and action must be allowed to coexist.
  const updateSignal =
    plugin.updateState.availableVersion === null
      ? null
      : {
          kind: "update" as const,
          version: plugin.updateState.availableVersion,
        };
  const problemLine = installedPluginProblemLine(plugin);
  const notRunning = pluginNeedsAttention({
    enabled: enabled === true,
    status: plugin.status,
  });

  const openDetail = () => {
    if (onOpenPlugin !== undefined) {
      onOpenPlugin(plugin.id);
      return;
    }
    navigate(
      getPluginDetailRoutePath({ pluginId: plugin.id, view: "installed" }),
    );
  };
  return (
    <div data-testid={`plugin-row-${plugin.id}`}>
      <ResourceRow
        className={
          problemLine?.tone === "error"
            ? "-mx-2 rounded-md border border-surface-destructive-border bg-surface-destructive px-2 text-destructive-text"
            : undefined
        }
        leading={
          <PluginSignalLogo signal={statusSignal} onStatusClick={openDetail}>
            <PluginLogo plugin={plugin} className="size-6 shrink-0" />
          </PluginSignalLogo>
        }
        title={plugin.name ?? plugin.id}
        description={
          problemLine === null ? (
            plugin.description
          ) : (
            <span
              data-testid={`plugin-problem-line-${plugin.id}`}
              className={`inline-flex min-w-0 items-center gap-1 ${
                problemLine.tone === "error"
                  ? "text-destructive-text"
                  : "text-warning-text"
              }`}
            >
              {problemLine.attentionCount === null ? null : (
                <Pill
                  variant="outline"
                  className="border-transparent bg-surface-attention text-warning-text"
                >
                  {problemLine.attentionCount}
                </Pill>
              )}
              {problemLine.text === "" ? null : (
                <span className="min-w-0 truncate">{problemLine.text}</span>
              )}
            </span>
          )
        }
        openLabel={`${plugin.name ?? plugin.id} plugin details`}
        onOpen={openDetail}
        trailingMeta={
          updateSignal !== null ? (
            <span data-testid={`plugin-update-signal-${plugin.id}`}>
              <PluginRowSignalView
                signal={updateSignal}
                onUpdateClick={onUpdateClick}
                onStatusClick={openDetail}
              />
            </span>
          ) : undefined
        }
        persistentActions={
          <>
            <Switch
              checked={enabled}
              disabled={toggle.isPending}
              onCheckedChange={(next) => toggle.mutate(next)}
              aria-label={`${enabled ? "Disable" : "Enable"} ${plugin.id}${
                notRunning ? ` (${plugin.status}, not running)` : ""
              }`}
            />
          </>
        }
        trailingVisual={<ResourceRowDetailChevron />}
      />
    </div>
  );
}

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { Switch } from "@bb/shared-ui/switch";
import { Pill } from "@bb/shared-ui/pill";
import {
  ResourceBrowseCard,
  ResourceBrowseGrid,
} from "@bb/shared-ui/resource-list";
import { cn } from "@bb/shared-ui/lib/utils";
import { appToast } from "@/components/ui/app-toast.js";
import { invalidatePluginList } from "@/hooks/cache-owners/plugin-cache-owner";
import type { PluginCatalogSearchEntry } from "@/hooks/queries/plugin-catalog-queries";
import {
  setPluginEnabled,
  type PluginListItem,
} from "@/hooks/queries/plugin-settings-queries";
import { pluginNeedsAttention } from "@/hooks/usePluginAttention";
import { getPluginDetailRoutePath } from "@/lib/route-paths";
import { pluginRowSignal, installedPluginProblemLine } from "./plugin-status";
import { PluginRowSignalView } from "./PluginRowSignal";
import { UpdatePluginDialog } from "./UpdatePluginDialog";
import { PluginAuthorByline } from "./PluginAuthorLink";
import { pluginMarketplaceAuthorId } from "./plugin-marketplace-author";
import { PluginCategoryLabel, PluginLogo } from "./plugin-ui";

export const UNCATEGORIZED_PLUGIN_CATEGORY = "__uncategorized__";

export function InstalledPluginsTab({
  catalogEntriesByPluginId,
  plugins,
  onOpenPlugin,
}: {
  catalogEntriesByPluginId?: ReadonlyMap<string, PluginCatalogSearchEntry>;
  plugins: readonly PluginListItem[];
  onOpenPlugin?: (pluginId: string) => void;
}) {
  const [updateTarget, setUpdateTarget] = useState<PluginListItem | null>(null);

  if (plugins.length === 0) {
    return null;
  }

  return (
    <>
      <ResourceBrowseGrid className="grid-cols-[repeat(auto-fill,minmax(min(100%,16rem),1fr))] gap-2">
        {plugins.map((plugin) => (
          <InstalledPluginCard
            key={plugin.id}
            catalogEntry={catalogEntriesByPluginId?.get(plugin.id) ?? null}
            plugin={plugin}
            onUpdateClick={() => setUpdateTarget(plugin)}
            onOpenPlugin={onOpenPlugin}
          />
        ))}
      </ResourceBrowseGrid>
      {updateTarget !== null ? (
        <UpdatePluginDialog
          plugin={updateTarget}
          open
          onOpenChange={(open) => {
            if (!open) setUpdateTarget(null);
          }}
        />
      ) : null}
    </>
  );
}

export function InstalledPluginCard({
  catalogEntry = null,
  plugin,
  onUpdateClick,
  onOpenPlugin,
}: {
  catalogEntry?: PluginCatalogSearchEntry | null;
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
  const enabled = toggle.isPending ? toggle.variables : plugin.enabled;
  const signal = pluginRowSignal(plugin);
  const statusSignal = signal?.kind === "status" ? signal : null;
  const updateSignal =
    plugin.updateState.availableVersion === null
      ? null
      : {
          kind: "update" as const,
          version: plugin.updateState.availableVersion,
          retry: plugin.updateState.lastFailure !== null,
        };
  const problemLine = installedPluginProblemLine(plugin);
  const notRunning = pluginNeedsAttention({
    enabled: enabled === true,
    status: plugin.status,
  });
  const authorId =
    catalogEntry === null ? null : pluginMarketplaceAuthorId(catalogEntry);
  const authorByline =
    catalogEntry?.author === null ||
    catalogEntry?.author === undefined ||
    authorId === null ? undefined : (
      <PluginAuthorByline authorId={authorId} name={catalogEntry.author.name} />
    );
  const categoryLabel =
    plugin.categoryId === null || plugin.category === null ? undefined : (
      <PluginCategoryLabel
        categoryId={plugin.categoryId}
        label={plugin.category}
      />
    );

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
    <div data-testid={`plugin-card-${plugin.id}`}>
      <ResourceBrowseCard
        className={cn(
          "min-h-28 gap-2 border-border bg-background p-3 shadow-none",
          problemLine?.tone === "error" &&
            "border-surface-destructive-border bg-surface-destructive text-destructive-text",
        )}
        leading={<PluginLogo plugin={plugin} className="size-6 shrink-0" />}
        title={
          <span className="line-clamp-2 whitespace-normal break-words font-medium leading-tight">
            {plugin.name ?? plugin.id}
          </span>
        }
        description={
          <span className="block min-h-[2lh]">
            {problemLine === null ? (
              plugin.description
            ) : (
              <span
                data-testid={`plugin-problem-line-${plugin.id}`}
                className={cn(
                  "inline-flex min-w-0 items-center gap-1",
                  problemLine.tone === "error"
                    ? "text-destructive-text"
                    : "text-warning-text",
                )}
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
            )}
          </span>
        }
        byline={authorByline}
        headerAction={
          <span className="flex items-center gap-1">
            {statusSignal !== null ? (
              <PluginRowSignalView
                signal={statusSignal}
                onUpdateClick={onUpdateClick}
                onStatusClick={openDetail}
              />
            ) : null}
            {updateSignal !== null ? (
              <span data-testid={`plugin-update-signal-${plugin.id}`}>
                <PluginRowSignalView
                  signal={updateSignal}
                  onUpdateClick={onUpdateClick}
                  onStatusClick={openDetail}
                />
              </span>
            ) : null}
            <Switch
              checked={enabled}
              disabled={toggle.isPending}
              onCheckedChange={(next) => toggle.mutate(next)}
              aria-label={`${enabled ? "Disable" : "Enable"} ${plugin.id}${
                notRunning ? ` (${plugin.status}, not running)` : ""
              }`}
            />
          </span>
        }
        footerMeta={categoryLabel}
        openLabel={`${plugin.name ?? plugin.id} plugin details`}
        onOpen={openDetail}
      />
    </div>
  );
}

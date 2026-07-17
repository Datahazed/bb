import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@bb/shared-ui/button";
import { Icon } from "@bb/shared-ui/icon";
import {
  ResourceActionButton,
  ResourceDetailActionRow,
} from "@bb/shared-ui/resource-list";
import { appToast } from "@/components/ui/app-toast.js";
import { pluginAdminErrorMessage } from "@/lib/plugin-admin-error";
import { invalidatePluginList } from "@/hooks/cache-owners/plugin-cache-owner";
import {
  checkPluginUpdates,
  usePluginSource,
} from "@/hooks/queries/plugin-catalog-queries";
import type { PluginListItem } from "@/hooks/queries/plugin-settings-queries";
import { formatRelativeTime } from "@/lib/relative-time";
import { pluginUpdateAvailableVersion } from "./plugin-status";
import {
  KeyValueGrid,
  SUCCESS_BANNER_STYLE,
  formatAbsoluteDate,
} from "./plugin-ui";
import { UpdatePluginDialog } from "./UpdatePluginDialog";

/**
 * Layer 2 (sketch v2, detail page): the update-available banner and the
 * "Updates & source" card. Everything that was crowding the list row lands
 * here — human source line, last check — with the full technical detail one
 * disclosure deeper under "Source details".
 *
 * Bundled plugins — auto builtins and store-installed officials alike — are
 * pinned to the copy shipped inside the app and update with bb releases, so
 * none of these surfaces render for them.
 */
export function pluginHasUpdateSurfaces(plugin: PluginListItem): boolean {
  if (plugin.source.startsWith("builtin:")) return false;
  return plugin.provenance === "direct" || plugin.provenance === "catalog";
}

export function PluginUpdateBanner({ plugin }: { plugin: PluginListItem }) {
  const [updateOpen, setUpdateOpen] = useState(false);
  const availableVersion = pluginUpdateAvailableVersion(plugin);
  const failure = plugin.updateState.lastFailure;

  if (!pluginHasUpdateSurfaces(plugin)) return null;

  if (failure !== null) {
    return (
      <div
        className="flex items-center gap-3 rounded-lg border border-destructive-text/30 bg-destructive/5 px-3 py-2.5"
        data-testid="plugin-update-failure-banner"
      >
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-destructive-text">
            Update to {failure.version} failed — rolled back
            {failure.at !== null ? ` on ${formatAbsoluteDate(failure.at)}` : ""}
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {failure.detail.length > 0
              ? failure.detail
              : `Code and data were restored to ${plugin.version}.`}
          </p>
        </div>
      </div>
    );
  }

  if (availableVersion === null) return null;

  return (
    <>
      <div
        className="flex items-center gap-3 rounded-lg border px-3 py-2.5"
        style={SUCCESS_BANNER_STYLE}
        data-testid="plugin-update-banner"
      >
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-foreground">
            Update available — {availableVersion}
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Compatible with your bb.
          </p>
        </div>
        <Button
          type="button"
          size="sm"
          className="h-7 px-2.5 text-xs"
          onClick={() => setUpdateOpen(true)}
        >
          Update
        </Button>
      </div>
      <UpdatePluginDialog
        plugin={plugin}
        open={updateOpen}
        onOpenChange={setUpdateOpen}
      />
    </>
  );
}

export function PluginUpdatesSourceCard({
  plugin,
  showHeading = true,
  embedded = false,
}: {
  plugin: PluginListItem;
  showHeading?: boolean;
  /** Removes the nested card when this content lives in a detail-stack row. */
  embedded?: boolean;
}) {
  const queryClient = useQueryClient();
  const [renderedAt] = useState(() => Date.now());
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [blockedOpen, setBlockedOpen] = useState(false);
  const sourceQuery = usePluginSource(plugin.id, { enabled: detailsOpen });

  const checkNow = useMutation({
    mutationFn: () => checkPluginUpdates(fetch, { id: plugin.id }),
    onSuccess: () => invalidatePluginList({ queryClient }),
    onError: (error) => {
      appToast.error("The update check failed", {
        description: pluginAdminErrorMessage(error),
      });
    },
  });

  if (!pluginHasUpdateSurfaces(plugin)) return null;

  const state = plugin.updateState;
  const source = sourceQuery.data ?? null;
  const blockedVersion =
    state.availableVersion === null ? state.blockedVersion : null;

  return (
    <div className="space-y-3">
      {showHeading ? (
        <h3 className="text-sm font-semibold text-foreground">
          Updates &amp; source
        </h3>
      ) : null}
      <div
        className={
          embedded ? "" : "rounded-lg border border-border bg-card px-4 py-3.5"
        }
      >
        <div className="divide-y divide-border">
          <div className="pb-3">
            <ResourceDetailActionRow
              label="Source"
              description={plugin.sourceDisplay}
              action={
                <ResourceActionButton
                  label={
                    detailsOpen ? "Hide source details" : "Show source details"
                  }
                  icon="Info"
                  onClick={() => setDetailsOpen((current) => !current)}
                />
              }
            />
            {detailsOpen ? (
              <div
                className="mt-2 rounded-md border border-border-seam bg-muted/30 px-3 py-2.5"
                data-testid="plugin-source-details"
              >
                {sourceQuery.isPending ? (
                  <p className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Icon name="Spinner" className="size-3.5 animate-spin" />
                    Loading source details…
                  </p>
                ) : source === null ? (
                  <p className="text-xs text-muted-foreground">
                    Source details are unavailable.
                  </p>
                ) : (
                  <KeyValueGrid
                    entries={[
                      { key: "Requested", value: source.requested },
                      {
                        key: "Resolved",
                        value:
                          source.integrity !== null
                            ? `${source.resolved} · ${source.integrity}`
                            : source.resolved,
                      },
                      ...(source.registry !== null
                        ? [{ key: "Registry", value: source.registry }]
                        : []),
                      ...(source.engines.bb !== null ||
                      source.engines.bbPluginSdk !== null
                        ? [
                            {
                              key: "Requires",
                              value: [
                                source.engines.bb !== null
                                  ? `bb ${source.engines.bb}`
                                  : null,
                                source.engines.bbPluginSdk !== null
                                  ? `sdk ${source.engines.bbPluginSdk}`
                                  : null,
                              ]
                                .filter((part): part is string => part !== null)
                                .join(" · "),
                            },
                          ]
                        : []),
                      ...(source.installedAt !== null
                        ? [
                            {
                              key: "Installed",
                              value: formatAbsoluteDate(source.installedAt),
                              mono: false,
                            },
                          ]
                        : []),
                      ...(source.history.length > 0
                        ? [
                            {
                              key: "History",
                              value: source.history
                                .map((entry) => entry.version)
                                .join(" ← "),
                            },
                          ]
                        : []),
                    ]}
                  />
                )}
              </div>
            ) : null}
          </div>

          <div className={blockedVersion !== null ? "py-3" : "pt-3"}>
            <ResourceDetailActionRow
              label="Last checked"
              description={
                state.lastCheckAt !== null
                  ? formatRelativeTime({
                      timestamp: state.lastCheckAt,
                      now: renderedAt,
                    })
                  : "Never checked"
              }
              action={
                <ResourceActionButton
                  label="Check for updates now"
                  tooltipLabel="Check now"
                  icon="RotateCcw"
                  loading={checkNow.isPending}
                  disabled={checkNow.isPending}
                  onClick={() => checkNow.mutate()}
                />
              }
            />
          </div>

          {blockedVersion !== null ? (
            // Newer-but-incompatible surfaces here, never on the list
            // (locked design): nothing is actionable, so no pill and no
            // toast — just the explanation one click away.
            <div className="pt-3">
              <ResourceDetailActionRow
                label={`${blockedVersion} isn't compatible with this bb`}
                description={
                  plugin.updateState.blockedReasons[0] ??
                  `Staying on ${plugin.version}.`
                }
                action={
                  <ResourceActionButton
                    label="View compatibility details"
                    icon="Info"
                    onClick={() => setBlockedOpen(true)}
                  />
                }
              />
            </div>
          ) : null}
        </div>
      </div>
      {blockedVersion !== null ? (
        <UpdatePluginDialog
          plugin={plugin}
          open={blockedOpen}
          onOpenChange={setBlockedOpen}
        />
      ) : null}
    </div>
  );
}

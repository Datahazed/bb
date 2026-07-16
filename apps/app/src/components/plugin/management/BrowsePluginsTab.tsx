import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useDebounceValue } from "usehooks-ts";
import { Button } from "@bb/shared-ui/button";
import { Icon } from "@bb/shared-ui/icon";
import { Input } from "@bb/shared-ui/input";
import {
  RESOURCE_GRID_PAGE_SIZE,
  ResourcePagination,
  useResourcePagination,
} from "@bb/shared-ui/resource-pagination";
import { cn } from "@bb/shared-ui/lib/utils";
import { EmptyState } from "@bb/shared-ui/empty-state";
import { ResourceInstalledControl } from "@bb/shared-ui/resource-list";
import { pluginIconName } from "@/components/plugin/PluginIcon";
import { appToast } from "@/components/ui/app-toast";
import {
  invalidateMarketplaces,
  invalidatePluginList,
} from "@/hooks/cache-owners/plugin-cache-owner";
import {
  useMarketplaceSearch,
  useMarketplaces,
  type MarketplaceSearchEntry,
} from "@/hooks/queries/plugin-marketplace-queries";
import { removePlugin } from "@/hooks/queries/plugin-settings-queries";
import type { AddPluginInitial } from "./AddPluginDialog";
import { PlaceholderBadge } from "./plugin-ui";

/**
 * The Browse tab (sketch v1 C): search across added catalogs with
 * marketplace filter chips and a category card grid. Catalog entries never
 * render as installed-but-disabled rows; installed entries get a check,
 * incompatible entries say why Install is off. Install opens the shared
 * Add-plugin dialog pre-filled — one pipeline (the top-level store page is
 * deferred; this tab is Phase 5's whole discovery surface).
 *
 * Search results carry only the marketplace id; display names come from
 * joining the marketplace list.
 */
export function BrowsePluginsTab({
  onInstall,
}: {
  onInstall: (initial: AddPluginInitial) => void;
}) {
  const [query, setQuery] = useState("");
  const [debouncedQuery] = useDebounceValue(query.trim(), 300);
  const [marketplaceFilter, setMarketplaceFilter] = useState<string | null>(
    null,
  );
  const marketplacesQuery = useMarketplaces({ enabled: true });
  const searchQuery = useMarketplaceSearch(debouncedQuery, { enabled: true });

  const marketplaces = marketplacesQuery.data ?? [];
  const marketplaceNames = new Map(
    marketplaces.map((marketplace) => [
      marketplace.id,
      marketplace.displayName,
    ]),
  );
  const entries = (searchQuery.data ?? []).filter(
    (entry) =>
      marketplaceFilter === null || entry.marketplaceId === marketplaceFilter,
  );
  const pagination = useResourcePagination(entries, {
    pageSize: RESOURCE_GRID_PAGE_SIZE,
    resetKey: [query.trim().toLowerCase(), marketplaceFilter ?? "all"].join(
      "\u0000",
    ),
  });

  const byCategory = new Map<string, MarketplaceSearchEntry[]>();
  for (const entry of pagination.items) {
    const category = entry.category ?? "Other";
    const bucket = byCategory.get(category);
    if (bucket === undefined) byCategory.set(category, [entry]);
    else bucket.push(entry);
  }

  return (
    <div id="plugins-browse-results" className="space-y-4">
      <div className="flex flex-wrap items-center gap-2.5">
        <div className="relative min-w-48 flex-1">
          <Icon
            name="Search"
            className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-subtle-foreground"
          />
          <Input
            value={query}
            placeholder="Search plugins…"
            aria-label="Search plugins"
            className="h-8 pl-8 text-xs"
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
        {marketplaces.length > 1 ? (
          <div className="flex items-center gap-1.5">
            <FilterChip
              label="All"
              active={marketplaceFilter === null}
              onClick={() => setMarketplaceFilter(null)}
            />
            {marketplaces.map((marketplace) => (
              <FilterChip
                key={marketplace.id}
                label={marketplace.displayName}
                active={marketplaceFilter === marketplace.id}
                onClick={() => setMarketplaceFilter(marketplace.id)}
              />
            ))}
          </div>
        ) : null}
      </div>

      {searchQuery.isPending ? (
        <p className="flex items-center gap-2 py-6 text-xs text-muted-foreground">
          <Icon name="Spinner" className="size-3.5 animate-spin" />
          Searching catalogs…
        </p>
      ) : entries.length === 0 ? (
        <EmptyState
          message={
            marketplaces.length === 0
              ? "No marketplaces added yet. Add one in the Marketplaces tab to browse plugins."
              : "No plugins match this search."
          }
        />
      ) : (
        <>
          {[...byCategory.entries()].map(([category, categoryEntries]) => (
            <div key={category}>
              <h3 className="mb-2 text-sm font-semibold text-foreground">
                {category}
              </h3>
              <div className="grid gap-2.5 sm:grid-cols-2">
                {categoryEntries.map((entry) => (
                  <BrowseCard
                    key={`${entry.marketplaceId}:${entry.entryId}`}
                    entry={entry}
                    marketplaceName={
                      marketplaceNames.get(entry.marketplaceId) ??
                      entry.marketplaceId
                    }
                    onInstall={onInstall}
                  />
                ))}
              </div>
            </div>
          ))}
          <ResourcePagination
            page={pagination.page}
            pageSize={pagination.pageSize}
            total={pagination.total}
            visibleCount={pagination.visibleCount}
            onPageChange={pagination.setPage}
            scrollTargetId="plugins-browse-results"
          />
        </>
      )}
    </div>
  );
}

function FilterChip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      className={cn(
        "rounded-full border px-3 py-1 text-xs",
        active
          ? "border-transparent bg-foreground text-background"
          : "border-border text-muted-foreground hover:text-foreground",
      )}
      onClick={onClick}
    >
      {label}
    </button>
  );
}

function BrowseCard({
  entry,
  marketplaceName,
  onInstall,
}: {
  entry: MarketplaceSearchEntry;
  marketplaceName: string;
  onInstall: (initial: AddPluginInitial) => void;
}) {
  const queryClient = useQueryClient();
  const sourceLabel = `${marketplaceName} · ${entry.source}`;
  const uninstall = useMutation({
    mutationFn: () => removePlugin(fetch, entry.entryId),
    onSuccess: () => {
      invalidatePluginList({ queryClient });
      invalidateMarketplaces({ queryClient });
      appToast.success(`${entry.displayName} uninstalled`);
    },
    onError: (error) => {
      appToast.error(`Uninstalling ${entry.displayName} failed`, {
        description: error instanceof Error ? error.message : String(error),
      });
    },
  });

  return (
    <div
      className="flex items-start gap-3 rounded-lg border border-border bg-card p-3.5"
      data-testid={`browse-card-${entry.entryId}`}
    >
      <PlaceholderBadge
        className="size-6"
        iconName={pluginIconName(entry.icon)}
      />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-foreground">
          {entry.displayName}
        </p>
        {entry.description.length > 0 ? (
          <p className="mt-0.5 text-xs leading-snug text-muted-foreground">
            {entry.description}
          </p>
        ) : null}
        <p
          className="mt-1.5 truncate text-2xs text-subtle-foreground"
          title={sourceLabel}
          data-testid={`browse-source-${entry.entryId}`}
        >
          {sourceLabel}
        </p>
        {!entry.compatible && entry.incompatibleReason !== null ? (
          <p className="text-2xs text-warning-text">
            {entry.incompatibleReason}
          </p>
        ) : null}
      </div>
      {entry.installed ? (
        <span className="mt-0.5">
          <ResourceInstalledControl
            accessibleLabel={`Uninstall ${entry.displayName}`}
            pending={uninstall.isPending}
            onAction={() => uninstall.mutate()}
          />
        </span>
      ) : (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="mt-0.5 h-7 shrink-0 px-2.5 text-xs"
          disabled={!entry.compatible}
          onClick={() =>
            onInstall({
              marketplaceId: entry.marketplaceId,
              marketplaceName,
              entryId: entry.entryId,
              displayName: entry.displayName,
              icon: entry.icon,
            })
          }
        >
          Install
        </Button>
      )}
    </div>
  );
}

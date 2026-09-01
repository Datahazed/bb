import { useMemo } from "react";
import type {
  PluginListingLifecycle,
  PluginListingRecord,
} from "@bb/server-contract";
import {
  ResourceBrowseCard,
  ResourceBrowseGrid,
  ResourceListState,
} from "@bb/shared-ui/resource-list";
import type { PluginCatalogSearchEntry } from "@/hooks/queries/plugin-catalog-queries";
import {
  usePluginListings,
  type PluginListItem,
} from "@/hooks/queries/plugin-settings-queries";
import { formatInstallCount } from "@/lib/skills-registry";
import { PluginCatalogInstallControl } from "./PluginCatalogInstallControl";
import { PluginCreationOnboarding } from "./PluginCreationOnboarding";
import { PluginListingStatusPill } from "./PluginListingStatusPill";
import { CatalogEntryIconChip, PluginCategoryLabel } from "./plugin-ui";

interface AuthoredPluginRow {
  plugin: PluginListItem;
  record: PluginListingRecord;
}

type ListingLifecycleGroup = "not-published" | "in-review" | "published";

const LISTING_LIFECYCLE_ORDER: readonly ListingLifecycleGroup[] = [
  "not-published",
  "in-review",
  "published",
];

function listingLifecycleGroup(
  lifecycle: PluginListingLifecycle,
): ListingLifecycleGroup {
  if (lifecycle.status === "in-review") return "in-review";
  if (lifecycle.status === "published") return "published";
  return "not-published";
}

export function MyPluginsTab({
  catalogEntriesByEntryId,
  plugins,
  onOpenPlugin,
  onCreatePlugin,
}: {
  catalogEntriesByEntryId?: ReadonlyMap<string, PluginCatalogSearchEntry>;
  plugins: readonly PluginListItem[];
  onOpenPlugin: (pluginId: string) => void;
  onCreatePlugin: (prompt: string) => void;
}) {
  const listings = usePluginListings({ enabled: true });
  const authored = useMemo(() => {
    const pluginById = new Map(plugins.map((plugin) => [plugin.id, plugin]));
    const rows = (listings.data?.records ?? []).flatMap<AuthoredPluginRow>(
      (record) => {
        const plugin = pluginById.get(record.pluginId);
        return plugin === undefined
          ? []
          : [
              {
                plugin,
                record,
              },
            ];
      },
    );
    const grouped = new Map<ListingLifecycleGroup, AuthoredPluginRow[]>();
    for (const row of rows) {
      const groupId = listingLifecycleGroup(row.record.lifecycle);
      const group = grouped.get(groupId) ?? [];
      group.push(row);
      grouped.set(groupId, group);
    }
    const orderedRows = LISTING_LIFECYCLE_ORDER.flatMap((id) => {
      const entries = grouped.get(id);
      return entries === undefined
        ? []
        : entries.sort((left, right) =>
            (left.plugin.name ?? left.plugin.id).localeCompare(
              right.plugin.name ?? right.plugin.id,
            ),
          );
    });
    return { rows: orderedRows, count: rows.length };
  }, [listings.data?.records, plugins]);

  if (listings.isError) {
    return (
      <ResourceListState
        state="error"
        message="Couldn't load your plugins."
        onRetry={() => void listings.refetch()}
      />
    );
  }
  if (listings.isFetching && listings.data === undefined) {
    return <ResourceListState state="loading" message="Loading your plugins" />;
  }
  if (authored.count === 0) {
    return (
      <PluginCreationOnboarding mode="prominent" onCreate={onCreatePlugin} />
    );
  }

  return (
    <div className="space-y-7" data-testid="my-plugins-list">
      <section className="space-y-2" aria-labelledby="authored-plugin-cards">
        <h1
          id="authored-plugin-cards"
          className="flex flex-wrap items-center gap-2 text-xl font-semibold text-foreground"
        >
          <span>My plugins</span>
          <span
            data-authored-plugin-count
            className="rounded-md bg-muted px-2 py-1 text-2xs font-medium tabular-nums text-subtle-foreground"
          >
            {authored.count.toLocaleString()}{" "}
            {authored.count === 1 ? "plugin" : "plugins"}
          </span>
        </h1>
        <ResourceBrowseGrid className="grid-cols-[repeat(auto-fill,minmax(min(100%,16rem),1fr))] gap-2">
          {authored.rows.map(({ plugin, record }) => {
            const displayName = plugin.name ?? plugin.id;
            const catalogEntry =
              record.lifecycle.status === "published"
                ? (catalogEntriesByEntryId?.get(record.lifecycle.entryId) ??
                  null)
                : null;
            const installs = catalogEntry?.installs;
            const installCount =
              installs === null || installs === undefined
                ? undefined
                : {
                    display: formatInstallCount(installs),
                    accessibleLabel: `${installs.toLocaleString()} installs`,
                  };
            const categoryLabel =
              catalogEntry?.category !== undefined ? (
                <PluginCategoryLabel
                  categoryId={catalogEntry.categoryId}
                  label={catalogEntry.category}
                />
              ) : plugin.category === null ? undefined : (
                <PluginCategoryLabel
                  categoryId={plugin.categoryId ?? undefined}
                  label={plugin.category}
                />
              );
            return (
              <div key={plugin.id} data-testid={`my-plugin-card-${plugin.id}`}>
                <ResourceBrowseCard
                  className="min-h-28 gap-2 border-border bg-background p-3 shadow-none"
                  leading={
                    <CatalogEntryIconChip
                      entry={
                        catalogEntry ?? {
                          displayName,
                          icon: plugin.icon,
                          iconUrl: plugin.compactIconUrl,
                          iconTinted: false,
                        }
                      }
                    />
                  }
                  title={
                    <span className="line-clamp-2 whitespace-normal break-words font-medium leading-tight">
                      {displayName}
                    </span>
                  }
                  description={
                    <span className="block min-h-[2lh]">
                      {plugin.description}
                    </span>
                  }
                  descriptionLines={2}
                  headerAction={
                    installCount === undefined ? undefined : (
                      <PluginCatalogInstallControl
                        displayName={displayName}
                        installed
                        count={installCount}
                      />
                    )
                  }
                  footerMeta={
                    record.lifecycle.status === "published" ? (
                      categoryLabel
                    ) : (
                      <PluginListingStatusPill lifecycle={record.lifecycle} />
                    )
                  }
                  openLabel={`${displayName} listing details`}
                  onOpen={() => onOpenPlugin(plugin.id)}
                />
              </div>
            );
          })}
        </ResourceBrowseGrid>
      </section>
      {authored.count < 3 ? (
        <PluginCreationOnboarding mode="supporting" onCreate={onCreatePlugin} />
      ) : null}
    </div>
  );
}

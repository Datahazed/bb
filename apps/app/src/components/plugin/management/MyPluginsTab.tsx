import { useMemo } from "react";
import type {
  PluginListingLifecycle,
  PluginListingRecord,
} from "@bb/server-contract";
import { Pill } from "@bb/shared-ui/pill";
import {
  ResourceListPanel,
  ResourceListState,
  ResourceRow,
  ResourceRowDetailChevron,
} from "@bb/shared-ui/resource-list";
import { PluginLogo } from "./plugin-ui";
import { usePluginCatalogSearch } from "@/hooks/queries/plugin-catalog-queries";
import {
  usePluginListings,
  type PluginListItem,
} from "@/hooks/queries/plugin-settings-queries";
import { pluginListingCategoryLabel } from "@/lib/plugin-listing-prompts";
import { PluginCreationEmptyState } from "./PluginCreationEmptyState";

export function PluginListingStatusPill({
  lifecycle,
  includePublished = false,
}: {
  lifecycle: PluginListingLifecycle;
  includePublished?: boolean;
}) {
  if (lifecycle.status === "published") {
    return includePublished ? (
      <Pill
        variant="outline"
        className="border-transparent bg-success/15 text-success"
      >
        Published
      </Pill>
    ) : null;
  }
  if (lifecycle.status === "in-review") {
    return (
      <Pill
        variant="outline"
        className="border-transparent bg-surface-attention text-warning-text"
      >
        In review
      </Pill>
    );
  }
  return (
    <Pill
      variant="outline"
      className="border-border/40 bg-surface-recessed/45 text-subtle-foreground"
    >
      Not published
    </Pill>
  );
}

interface AuthoredPluginRow {
  plugin: PluginListItem;
  record: PluginListingRecord;
  category: string;
}

function categoryForRecord(
  record: PluginListingRecord,
  catalogCategories: ReadonlyMap<string, string>,
): string {
  const lifecycle = record.lifecycle;
  if (lifecycle.status === "draft" || lifecycle.status === "in-review") {
    return pluginListingCategoryLabel(lifecycle.entry.category);
  }
  if (lifecycle.status === "published") {
    return catalogCategories.get(lifecycle.entryId) ?? "Published listing";
  }
  return "Listing not started";
}

export function MyPluginsTab({
  plugins,
  onOpenPlugin,
}: {
  plugins: readonly PluginListItem[];
  onOpenPlugin: (pluginId: string) => void;
}) {
  const listings = usePluginListings({ enabled: true });
  const catalog = usePluginCatalogSearch("", { enabled: true });
  const groups = useMemo(() => {
    const pluginById = new Map(plugins.map((plugin) => [plugin.id, plugin]));
    const catalogCategories = new Map(
      (catalog.data ?? []).flatMap((entry) =>
        entry.category === null || entry.category === undefined
          ? []
          : [[entry.entryId, entry.category] as const],
      ),
    );
    const rows = (listings.data?.records ?? []).flatMap<AuthoredPluginRow>(
      (record) => {
        const plugin = pluginById.get(record.pluginId);
        return plugin === undefined
          ? []
          : [
              {
                plugin,
                record,
                category: categoryForRecord(record, catalogCategories),
              },
            ];
      },
    );
    const grouped = new Map<string, AuthoredPluginRow[]>();
    for (const row of rows) {
      const group = grouped.get(row.category) ?? [];
      group.push(row);
      grouped.set(row.category, group);
    }
    return [...grouped.entries()]
      .sort(([left], [right]) => {
        if (left === "Listing not started") return 1;
        if (right === "Listing not started") return -1;
        return left.localeCompare(right);
      })
      .map(([category, entries]) => ({
        category,
        entries: entries.sort((left, right) =>
          (left.plugin.name ?? left.plugin.id).localeCompare(
            right.plugin.name ?? right.plugin.id,
          ),
        ),
      }));
  }, [catalog.data, listings.data?.records, plugins]);

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
  if (groups.length === 0) {
    return <PluginCreationEmptyState />;
  }

  return (
    <div className="space-y-5" data-testid="my-plugins-list">
      {groups.map((group) => (
        <section key={group.category} className="space-y-2">
          <h2 className="text-xs font-medium text-muted-foreground">
            {group.category} · {group.entries.length}
          </h2>
          <ResourceListPanel>
            <div className="divide-y divide-border">
              {group.entries.map(({ plugin, record }) => (
                <ResourceRow
                  key={plugin.id}
                  leading={<PluginLogo plugin={plugin} className="size-6" />}
                  title={plugin.name ?? plugin.id}
                  description={plugin.description}
                  openLabel={`${plugin.name ?? plugin.id} listing details`}
                  onOpen={() => onOpenPlugin(plugin.id)}
                  trailingMeta={
                    <PluginListingStatusPill lifecycle={record.lifecycle} />
                  }
                  trailingVisual={<ResourceRowDetailChevron />}
                />
              ))}
            </div>
          </ResourceListPanel>
        </section>
      ))}
    </div>
  );
}

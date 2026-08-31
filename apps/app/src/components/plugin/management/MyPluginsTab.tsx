import { useMemo } from "react";
import type {
  PluginListingLifecycle,
  PluginListingRecord,
} from "@bb/server-contract";
import {
  ResourceListPanel,
  ResourceListState,
  ResourceRow,
  ResourceRowDetailChevron,
} from "@bb/shared-ui/resource-list";
import { PluginLogo } from "./plugin-ui";
import {
  usePluginListings,
  type PluginListItem,
} from "@/hooks/queries/plugin-settings-queries";
import { PluginCreationOnboarding } from "./PluginCreationOnboarding";

interface AuthoredPluginRow {
  plugin: PluginListItem;
  record: PluginListingRecord;
}

type ListingLifecycleGroup = "not-published" | "in-review" | "published";

const LISTING_LIFECYCLE_GROUPS: readonly {
  id: ListingLifecycleGroup;
  label: string;
}[] = [
  { id: "not-published", label: "Not published" },
  { id: "in-review", label: "In review" },
  { id: "published", label: "Published" },
];

function listingLifecycleGroup(
  lifecycle: PluginListingLifecycle,
): ListingLifecycleGroup {
  if (lifecycle.status === "in-review") return "in-review";
  if (lifecycle.status === "published") return "published";
  return "not-published";
}

export function MyPluginsTab({
  plugins,
  onOpenPlugin,
  onCreatePlugin,
}: {
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
    const groups = LISTING_LIFECYCLE_GROUPS.flatMap(({ id, label }) => {
      const entries = grouped.get(id);
      return entries === undefined
        ? []
        : [
            {
              id,
              label,
              entries: entries.sort((left, right) =>
                (left.plugin.name ?? left.plugin.id).localeCompare(
                  right.plugin.name ?? right.plugin.id,
                ),
              ),
            },
          ];
    });
    return { groups, count: rows.length };
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
      <div className="space-y-5">
        {authored.groups.map((group) => (
          <section key={group.id} className="space-y-2">
            <h2 className="text-xs font-medium text-muted-foreground">
              {group.label} · {group.entries.length}
            </h2>
            <ResourceListPanel>
              <div className="divide-y divide-border">
                {group.entries.map(({ plugin }) => (
                  <ResourceRow
                    key={plugin.id}
                    leading={<PluginLogo plugin={plugin} className="size-6" />}
                    title={plugin.name ?? plugin.id}
                    description={plugin.description}
                    openLabel={`${plugin.name ?? plugin.id} listing details`}
                    onOpen={() => onOpenPlugin(plugin.id)}
                    trailingVisual={<ResourceRowDetailChevron />}
                  />
                ))}
              </div>
            </ResourceListPanel>
          </section>
        ))}
      </div>
      <PluginCreationOnboarding
        mode={authored.count < 5 ? "supporting" : "compact"}
        onCreate={onCreatePlugin}
      />
    </div>
  );
}

import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Icon } from "@bb/shared-ui/icon";
import {
  ResourceCollectionViewport,
  ResourceListState,
} from "@bb/shared-ui/resource-list";
import { cn } from "@bb/shared-ui/lib/utils";
import { TOOLS_PAGE_BAND_CLASSES } from "@/components/tools/tools-navigation";
import { usePluginCatalogSearch } from "@/hooks/queries/plugin-catalog-queries";
import { getPluginsRoutePath } from "@/lib/route-paths";
import { categoryShelves } from "./plugin-browse-discovery";
import { entriesByMarketplaceAuthor } from "./plugin-marketplace-author";
import { AddPluginDialog, type AddPluginInitial } from "./AddPluginDialog";
import { PluginCatalogGrid } from "./BrowsePluginsTab";

export function PluginAuthorPage({
  authorId,
  onOpenPlugin,
}: {
  authorId: string;
  onOpenPlugin: (pluginId: string) => void;
}) {
  const catalogQuery = usePluginCatalogSearch("", { enabled: true });
  const entries = useMemo(
    () => entriesByMarketplaceAuthor(catalogQuery.data ?? [], authorId),
    [authorId, catalogQuery.data],
  );
  const author = entries[0]?.author ?? null;
  const shelves = categoryShelves(entries);
  const [installTarget, setInstallTarget] = useState<AddPluginInitial | null>(
    null,
  );

  return (
    <>
      <ResourceCollectionViewport
        scrollId="plugin-author-results"
        contentClassName="[&>div]:!block [&>div]:!min-w-0 [&>div]:!w-full"
      >
        <div className={cn("space-y-6", TOOLS_PAGE_BAND_CLASSES)}>
          <div className="space-y-1">
            <Link
              to={getPluginsRoutePath()}
              className="-ml-1 inline-flex items-center gap-1 rounded-sm px-1 text-xs text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            >
              <Icon name="ChevronLeft" className="size-3" aria-hidden />
              Browse plugins
            </Link>
            {author === null ? null : (
              <>
                <h1 className="text-xl font-semibold text-foreground">
                  {author.name}
                </h1>
                <p className="text-xs text-subtle-foreground">
                  {entries.length.toLocaleString()}{" "}
                  {entries.length === 1 ? "plugin" : "plugins"}
                  {author.url === null ? null : (
                    <>
                      {" · "}
                      <a
                        href={author.url}
                        target="_blank"
                        rel="noreferrer"
                        className="rounded-sm underline underline-offset-2 hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                      >
                        {author.url
                          .replace(/^https?:\/\//u, "")
                          .replace(/\/+$/u, "")}
                        <Icon
                          name="ExternalLink"
                          className="ml-0.5 inline size-3"
                          aria-hidden
                        />
                      </a>
                    </>
                  )}
                </p>
              </>
            )}
          </div>

          {catalogQuery.isPending ? (
            <ResourceListState state="loading" message="Loading author" />
          ) : catalogQuery.isError ? (
            <ResourceListState
              state="error"
              message="Couldn't load this author."
              onRetry={() => void catalogQuery.refetch()}
            />
          ) : author === null ? (
            <ResourceListState state="empty" message="Author not found." />
          ) : (
            <div className="space-y-6">
              {shelves.map((shelf) => (
                <section key={shelf.id} className="space-y-2.5">
                  <h2 className="text-sm font-semibold text-foreground">
                    {shelf.label}
                    <span className="ml-1.5 text-xs font-normal text-subtle-foreground">
                      · {shelf.entries.length}
                    </span>
                  </h2>
                  <PluginCatalogGrid
                    entries={shelf.entries}
                    onInstall={setInstallTarget}
                    onOpenPlugin={onOpenPlugin}
                  />
                </section>
              ))}
            </div>
          )}
        </div>
      </ResourceCollectionViewport>
      <AddPluginDialog
        open={installTarget !== null}
        initial={installTarget}
        onOpenChange={(open) => {
          if (!open) setInstallTarget(null);
        }}
        onInstalled={(plugin) => onOpenPlugin(plugin.id)}
      />
    </>
  );
}

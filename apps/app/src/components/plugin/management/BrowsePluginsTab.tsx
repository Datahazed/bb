import { useEffect, useState, type ReactNode } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useDebounceValue } from "usehooks-ts";
import {
  PLUGIN_CATALOG_CATEGORIES,
  PLUGIN_CATALOG_SHELF_GROUPS,
  defaultPluginDiscoverySortDirection,
} from "@bb/domain";
import {
  ResourceBrowseCard,
  ResourceBrowseGrid,
  ResourceCardStat,
  ResourceCollectionViewport,
  ResourceInstallControl,
  ResourceListState,
  ResourceShelfAction,
  ResourceSourceShelf,
  ResourceSortMenu,
  ResourceToolbar,
} from "@bb/shared-ui/resource-list";
import {
  ConfirmDeleteDialog,
  ConfirmDeleteDialogContent,
} from "@/components/dialogs/ConfirmDeleteDialog";
import { Button } from "@bb/shared-ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@bb/shared-ui/dropdown-menu";
import { Icon, type IconName } from "@bb/shared-ui/icon";
import { cn } from "@bb/shared-ui/lib/utils";
import { appToast } from "@/components/ui/app-toast";
import { TOOLS_PAGE_BAND_CLASSES } from "@/components/tools/tools-navigation";
import { BrowseArchetypeCards } from "@/components/plugin/browse-hero/BrowseArchetypeCards";
import { nextComposerRequestNonce } from "@/components/plugin/browse-hero/browse-hero-archetypes";
import { BrowseHeroCarousel } from "@/components/plugin/browse-hero/BrowseHeroCarousel";
import {
  invalidatePluginCatalogSearch,
  invalidatePluginList,
} from "@/hooks/cache-owners/plugin-cache-owner";
import {
  usePluginCatalogSearch,
  type PluginCatalogSearchEntry,
} from "@/hooks/queries/plugin-catalog-queries";
import { removePlugin } from "@/hooks/queries/plugin-settings-queries";
import { formatRelativeTime } from "@/lib/relative-time";
import { formatInstallCount } from "@/lib/skills-registry";
import { getPluginAuthorRoutePath } from "@/lib/route-paths";
import type { AddPluginInitial } from "./AddPluginDialog";
import {
  browseShelfGroups,
  categoryShelves,
  newAndNotableEntries,
  publisherGroups,
  sortPluginEntries,
  type PluginBrowseSort,
  type PluginBrowseSortDirection,
  type PluginPublisherGroup,
} from "./plugin-browse-discovery";
import {
  PluginBrowseCategoryFilter,
  type PluginBrowseCategoryOption,
} from "./PluginBrowseControls";
import { PluginCategoryChips } from "./PluginCategoryChips";
import { CatalogEntryIconChip, PluginCategoryLabel } from "./plugin-ui";
import { pluginMarketplaceAuthorId } from "./plugin-marketplace-author";

const PLUGIN_BROWSE_SORTS = [
  "recently-added",
  "most-installed",
  "name",
] as const satisfies readonly PluginBrowseSort[];

const PLUGIN_BROWSE_SORT_LABELS: Record<PluginBrowseSort, string> = {
  "recently-added": "Recently added",
  "most-installed": "Most installed",
  name: "Name",
};

/** One glyph per criterion, so the menu reads without parsing three labels. */
const PLUGIN_BROWSE_SORT_ICONS: Record<PluginBrowseSort, IconName> = {
  "recently-added": "Clock",
  "most-installed": "Download",
  name: "Sort",
};

function browseSort(value: string | null): PluginBrowseSort | null {
  return PLUGIN_BROWSE_SORTS.find((sort) => sort === value) ?? null;
}

function browseSortDirection(
  value: string | null,
): PluginBrowseSortDirection | null {
  return value === "asc" || value === "desc" ? value : null;
}

/**
 * The Browse page: hero → one CTA row (create + install-from-source) → then
 * ONE of two mutually exclusive bodies. Browsing shows the search toolbar and
 * the installable grid; composing swaps that for the example cards, since the
 * examples exist to feed the open composer. Every create-shaped affordance
 * opens the hero's inline composer in place; nothing navigates away.
 */
export function BrowsePluginsTab({
  onInstall,
  onOpenPlugin,
  onInstallFromSource,
}: {
  onInstall: (initial: AddPluginInitial) => void;
  onOpenPlugin: (pluginId: string) => void;
  /** Opens the Add-plugin dialog; rendered beside the hero CTA. */
  onInstallFromSource: () => void;
}) {
  const [query, setQuery] = useState("");
  // Example cards and the page button open the hero's inline composer through
  // this request; nonces make a repeated click on the same card still land.
  const [searchParams, setSearchParams] = useSearchParams();
  const creationViewActive = searchParams.get("view") === "create";
  const [heroRequest, setHeroRequest] = useState<{
    nonce: number;
    seed?: string;
    close?: boolean;
  } | null>(() =>
    creationViewActive ? { nonce: nextComposerRequestNonce() } : null,
  );
  const [requestedCreationView, setRequestedCreationView] =
    useState(creationViewActive);
  const [composing, setComposing] = useState(false);
  const openComposer = (seed?: string) =>
    setHeroRequest({
      nonce: nextComposerRequestNonce(),
      ...(seed === undefined ? {} : { seed }),
    });
  // Creation is a real navigation entry so the app shell's existing sidebar
  // Back control owns the return to Browse. POP/forward navigation then drives
  // the inline composer without adding another page-local back affordance.
  if (requestedCreationView !== creationViewActive) {
    setRequestedCreationView(creationViewActive);
    setHeroRequest({
      nonce: nextComposerRequestNonce(),
      ...(creationViewActive ? {} : { close: true }),
    });
  }
  // The composer lives in the hero at the top; opening it from a card further
  // down must bring it into view or the click appears to do nothing.
  useEffect(() => {
    if (heroRequest === null) return;
    const viewport = document.getElementById("plugins-browse-results");
    // Optional call: jsdom implements elements without scrollTo.
    viewport?.scrollTo?.({
      top: 0,
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
        ? "auto"
        : "smooth",
    });
  }, [heroRequest]);
  const [debouncedQuery] = useDebounceValue(query.trim(), 300);
  const catalogQuery = usePluginCatalogSearch("", { enabled: true });
  const searchQuery = usePluginCatalogSearch(debouncedQuery, { enabled: true });
  // Browse offers installs, so an entry this BB cannot install is noise here.
  // The search API still returns incompatible entries with their reasons for
  // the CLI, where the "requires newer bb" status is the useful signal.
  const catalogEntries = (catalogQuery.data ?? []).filter(
    (entry) => entry.compatible,
  );
  const entries = (searchQuery.data ?? []).filter((entry) => entry.compatible);
  const shelves = categoryShelves(entries);
  const catalogShelves = categoryShelves(catalogEntries);
  const hasCategoryDiscovery = catalogShelves.length > 0;
  const selectedCategoryId = hasCategoryDiscovery
    ? searchParams.get("category")
    : null;
  const selectedCategory = PLUGIN_CATALOG_CATEGORIES.find(
    (category) => category.id === selectedCategoryId,
  );
  const selectedCategoryLabel =
    selectedCategory?.displayName ?? selectedCategoryId ?? "All categories";
  const selectedShelfId = hasCategoryDiscovery
    ? searchParams.get("shelf")
    : null;
  const selectedShelf = PLUGIN_CATALOG_SHELF_GROUPS.find(
    (group) => group.id === selectedShelfId,
  );
  const hasInstallCounts = catalogEntries.some(
    (entry) => entry.installs !== null,
  );
  const requestedSort = browseSort(searchParams.get("sort"));
  const usableRequestedSort =
    requestedSort === "most-installed" && !hasInstallCounts
      ? null
      : requestedSort;
  const activeSort = usableRequestedSort;
  const activeDirection =
    activeSort === null
      ? "desc"
      : (browseSortDirection(searchParams.get("direction")) ??
        defaultPluginDiscoverySortDirection(activeSort));
  const sortOptions = PLUGIN_BROWSE_SORTS.filter(
    (sort) => sort !== "most-installed" || hasInstallCounts,
  ).map((sort) => ({
    id: sort,
    label: PLUGIN_BROWSE_SORT_LABELS[sort],
    leading: <Icon name={PLUGIN_BROWSE_SORT_ICONS[sort]} className="size-4" />,
  }));
  const catalogCategoryCounts = new Map(
    catalogShelves.map((shelf) => [shelf.id, shelf.entries.length]),
  );
  const catalogCategorizedEntryCount = catalogShelves.reduce(
    (count, shelf) => count + shelf.entries.length,
    0,
  );
  // The picker exposes the complete stable taxonomy, including categories
  // with no current entries. A zero-count category is still valid metadata
  // and must not disappear just because this catalog happens to be sparse.
  const categoryOptions: PluginBrowseCategoryOption[] =
    PLUGIN_CATALOG_CATEGORIES.map((category) => ({
      id: category.id,
      label: category.displayName,
      count: catalogCategoryCounts.get(category.id) ?? 0,
    }));
  if (selectedCategoryId !== null && selectedCategory === undefined) {
    // Preserve a stale or future deep-link filter instead of silently showing
    // unfiltered results; the canonical sixteen options remain alongside it.
    categoryOptions.push({
      id: selectedCategoryId,
      label: selectedCategoryLabel,
      count: 0,
    });
  }
  const categorizedEntries = shelves.flatMap((shelf) => shelf.entries);
  const legacyEntries = entries.filter(
    (entry) => entry.categoryId === undefined || entry.category === undefined,
  );
  const scopedEntries = categorizedEntries.filter((entry) => {
    if (selectedCategoryId !== null) {
      return entry.categoryId === selectedCategoryId;
    }
    if (selectedShelf !== undefined) {
      return selectedShelf.categoryIds.some(
        (categoryId) => categoryId === entry.categoryId,
      );
    }
    return true;
  });
  const flatEntries =
    activeSort === null
      ? scopedEntries
      : sortPluginEntries(scopedEntries, activeSort, activeDirection);
  const notableEntries = newAndNotableEntries(categorizedEntries);
  const notableEntryKeys = new Set(
    notableEntries.map((entry) => `${entry.marketplace}/${entry.entryId}`),
  );
  const legacyGroups = publisherGroups(legacyEntries).map((group) => ({
    ...group,
    entries: sortPluginEntries(
      group.entries,
      activeSort ?? "name",
      activeSort === null ? "asc" : activeDirection,
    ),
  }));
  const groupedShelves = browseShelfGroups(entries);
  const showLegacyPublisherHeadings =
    hasCategoryDiscovery || legacyGroups.length > 1;

  function setCategory(categoryId: string | null) {
    const nextSearchParams = new URLSearchParams(searchParams);
    nextSearchParams.delete("shelf");
    if (categoryId === null) nextSearchParams.delete("category");
    else nextSearchParams.set("category", categoryId);
    setSearchParams(nextSearchParams);
  }

  function setShelf(shelfId: string) {
    const nextSearchParams = new URLSearchParams(searchParams);
    nextSearchParams.delete("category");
    nextSearchParams.set("shelf", shelfId);
    setSearchParams(nextSearchParams);
  }

  function setSort(sort: PluginBrowseSort) {
    const nextSearchParams = new URLSearchParams(searchParams);
    nextSearchParams.set("sort", sort);
    nextSearchParams.set(
      "direction",
      sort === activeSort
        ? activeDirection === "asc"
          ? "desc"
          : "asc"
        : defaultPluginDiscoverySortDirection(sort),
    );
    setSearchParams(nextSearchParams);
  }

  /** Drop the sort so the shelf view comes back. */
  function clearSort() {
    const nextSearchParams = new URLSearchParams(searchParams);
    nextSearchParams.delete("sort");
    nextSearchParams.delete("direction");
    setSearchParams(nextSearchParams);
  }

  function clearDiscoveryScope() {
    const nextSearchParams = new URLSearchParams(searchParams);
    nextSearchParams.delete("category");
    nextSearchParams.delete("shelf");
    setSearchParams(nextSearchParams);
  }

  // Radix gives every scroll viewport a display:table content wrapper so it
  // can measure horizontal content. Browse itself is vertical-only; its
  // shelves own their responsive grids. Keeping that wrapper as a table lets
  // wide card content expand the whole page at compact widths, so constrain
  // only this viewport's generated child to the available pane.
  return (
    <ResourceCollectionViewport
      scrollId="plugins-browse-results"
      contentClassName="[&>div]:!block [&>div]:!min-w-0 [&>div]:!w-full"
    >
      {/* One wrapper owns the page rhythm and centers the content column: the
          scroller spans the whole pane so the wheel works from the gutters.
          (Spacing utilities on the scroll viewport itself never fire: Radix
          interposes a display:table div, so the sections would not be siblings
          of each other there.) */}
      <div className={cn("space-y-7", TOOLS_PAGE_BAND_CLASSES)}>
        {/* The create control sits at the page's top right, like every other
            collection's actions row; the hero keeps only its showcase. */}
        <div className="flex items-center justify-end gap-3">
          <div className="flex items-stretch">
            <Button
              className="rounded-r-none"
              onClick={() => {
                if (creationViewActive) return;
                const nextSearchParams = new URLSearchParams(searchParams);
                nextSearchParams.set("view", "create");
                setSearchParams(nextSearchParams);
              }}
            >
              <Icon name="MessageSquarePlus" className="size-3.5" />
              Create a plugin
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  aria-label="Create a plugin options"
                  className="rounded-l-none border-l border-l-primary-foreground/20 px-1.5"
                >
                  <Icon name="ChevronDown" className="size-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-max min-w-40">
                <DropdownMenuItem onSelect={onInstallFromSource}>
                  <Icon name="Download" className="size-4" />
                  Install from source
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        <BrowseHeroCarousel
          openRequest={heroRequest}
          onComposingChange={setComposing}
        />

        {composing ? (
          /* The examples exist to feed the open composer, so they appear only
             in this state — browsing and composing are mutually exclusive
             bodies below one stable hero. */
          <BrowseArchetypeCards onCreate={openComposer} />
        ) : (
          <section>
            <div className="w-full px-[var(--resource-source-shelf-inset)]">
              <ResourceToolbar
                searchValue={query}
                searchPlaceholder="Search plugins"
                onSearchChange={setQuery}
                controls={
                  <>
                    {sortOptions.length > 0 ? (
                      <ResourceSortMenu
                        // Null while unsorted, so the trigger keeps reading
                        // "Sort plugins" rather than naming a sort that is not
                        // applied. The Featured row is the way back, not a
                        // claim about the current state.
                        value={activeSort}
                        direction={activeDirection}
                        options={sortOptions}
                        compact
                        placeholderLabel="Sort plugins"
                        onClear={clearSort}
                        onChange={(value) => {
                          const sort = browseSort(value);
                          if (sort !== null) setSort(sort);
                        }}
                      />
                    ) : null}
                    {hasCategoryDiscovery ? (
                      <PluginBrowseCategoryFilter
                        value={selectedCategoryId}
                        options={categoryOptions}
                        totalCount={catalogCategorizedEntryCount}
                        onChange={setCategory}
                      />
                    ) : null}
                  </>
                }
              />
            </div>

            {activeSort === null ? null : (
              // Same content width as the toolbar above, so the pill row lines
              // up with the search field rather than running past it.
              <div className="mt-3 w-full px-[var(--resource-source-shelf-inset)]">
                {hasCategoryDiscovery ? (
                  <PluginCategoryChips
                    options={categoryOptions}
                    value={selectedCategoryId}
                    ariaLabel="Filter plugins by category"
                    onChange={setCategory}
                  />
                ) : null}
              </div>
            )}

            <div className="mt-7 space-y-3">
              {searchQuery.isError && entries.length > 0 ? (
                // The empty-catalog error below offers Retry; this one is the
                // same failure with stale results still on screen, so it needs
                // the same way out. Without it the only escape from a stale
                // catalog is reloading the page or editing the query.
                <div
                  className="flex items-center gap-2 text-xs text-warning-text"
                  role="status"
                >
                  <span>
                    Showing cached catalog results because the latest search
                    failed.
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      void searchQuery.refetch();
                    }}
                  >
                    Retry
                  </Button>
                </div>
              ) : null}

              {searchQuery.isPending ? (
                <ResourceListState state="loading" message="Loading plugins" />
              ) : entries.length === 0 ? (
                <ResourceListState
                  state={searchQuery.isError ? "error" : "empty"}
                  message={
                    searchQuery.isError
                      ? "BB's official plugins are unavailable."
                      : "No plugins match this search."
                  }
                  onRetry={
                    searchQuery.isError
                      ? () => {
                          void searchQuery.refetch();
                        }
                      : undefined
                  }
                />
              ) : activeSort !== null ? (
                flatEntries.length === 0 &&
                (selectedCategoryId !== null ||
                  selectedShelfId !== null ||
                  legacyEntries.length === 0) ? (
                  <ResourceListState
                    state="empty"
                    message="No plugins match these filters."
                  />
                ) : (
                  <div className="space-y-5">
                    {flatEntries.length === 0 ? null : (
                      <PluginCatalogGrid
                        entries={flatEntries}
                        showCategory
                        onInstall={onInstall}
                        onOpenPlugin={onOpenPlugin}
                      />
                    )}
                    {selectedCategoryId === null && selectedShelfId === null ? (
                      <LegacyPublisherGroups
                        groups={legacyGroups}
                        showHeadings={showLegacyPublisherHeadings}
                        onInstall={onInstall}
                        onOpenPlugin={onOpenPlugin}
                      />
                    ) : null}
                  </div>
                )
              ) : selectedCategoryId === null && selectedShelfId === null ? (
                <div className="space-y-9 [&>*+*]:border-t [&>*+*]:border-border-seam/60 [&>*+*]:pt-9">
                  {hasCategoryDiscovery ? (
                    <BrowseShelf
                      label="New & notable"
                      entries={notableEntries}
                      leading={
                        // Filled, and geometric rather than pictorial: a set of
                        // modules reads as "extensions" at 14px, where an
                        // outlined toolbox or package turns to mush.
                        <Icon
                          name="GridView"
                          className="size-3.5 fill-current text-muted-foreground"
                          aria-hidden
                        />
                      }
                      onInstall={onInstall}
                      onOpenPlugin={onOpenPlugin}
                    />
                  ) : null}
                  {groupedShelves.map((shelf) => (
                    <BrowseShelf
                      key={shelf.id}
                      label={shelf.label}
                      description={shelf.description}
                      entries={shelf.entries
                        .filter(
                          (entry) =>
                            !notableEntryKeys.has(
                              `${entry.marketplace}/${entry.entryId}`,
                            ),
                        )
                        .slice(0, 6)}
                      onViewAll={() => setShelf(shelf.id)}
                      onInstall={onInstall}
                      onOpenPlugin={onOpenPlugin}
                    />
                  ))}
                  <LegacyPublisherGroups
                    groups={legacyGroups}
                    showHeadings={showLegacyPublisherHeadings}
                    onInstall={onInstall}
                    onOpenPlugin={onOpenPlugin}
                  />
                </div>
              ) : (
                <section className="space-y-3">
                  <div>
                    <ResourceShelfAction
                      type="button"
                      className="-ml-2"
                      onClick={clearDiscoveryScope}
                    >
                      <Icon name="ChevronLeft" className="size-3" />
                      Browse plugins
                    </ResourceShelfAction>
                    <h2 className="text-base font-semibold text-foreground">
                      {selectedCategoryId === null
                        ? (selectedShelf?.displayName ?? selectedShelfId)
                        : selectedCategoryLabel}
                      <span className="ml-1.5 text-xs font-normal text-subtle-foreground">
                        · {scopedEntries.length} plugins
                      </span>
                    </h2>
                    {selectedCategoryId === null && selectedShelf ? (
                      <p className="mt-1 text-xs text-muted-foreground">
                        {selectedShelf.description}
                      </p>
                    ) : selectedCategory?.description ? (
                      <p className="mt-1 text-xs text-muted-foreground">
                        {selectedCategory.description}
                      </p>
                    ) : null}
                  </div>
                  {scopedEntries.length === 0 ? (
                    <ResourceListState
                      state="empty"
                      message="No plugins match this browse selection and search."
                    />
                  ) : (
                    <PluginCatalogGrid
                      entries={flatEntries}
                      showCategory={selectedShelf !== undefined}
                      onInstall={onInstall}
                      onOpenPlugin={onOpenPlugin}
                    />
                  )}
                </section>
              )}
            </div>
          </section>
        )}
      </div>
    </ResourceCollectionViewport>
  );
}

export function PluginCatalogGrid({
  entries,
  previewLimitBelowXl,
  showCategory = false,
  onInstall,
  onOpenPlugin,
}: {
  entries: readonly PluginCatalogSearchEntry[];
  /** Keep compact panes scannable; View all still exposes the full shelf. */
  previewLimitBelowXl?: number;
  showCategory?: boolean;
  onInstall: (initial: AddPluginInitial) => void;
  onOpenPlugin: (pluginId: string) => void;
}) {
  return (
    <ResourceBrowseGrid className="grid-cols-[repeat(auto-fill,minmax(min(100%,16rem),1fr))] gap-2">
      {entries.map((entry, index) => (
        <PluginCatalogCard
          key={`${entry.marketplace}/${entry.entryId}`}
          entry={entry}
          className={cn(
            previewLimitBelowXl !== undefined &&
              index >= previewLimitBelowXl &&
              "max-xl:hidden",
          )}
          installedPluginId={entry.installed ? entry.pluginId : null}
          showCategory={showCategory}
          onInstall={onInstall}
          onOpenPlugin={onOpenPlugin}
        />
      ))}
    </ResourceBrowseGrid>
  );
}

function BrowseShelf({
  label,
  description,
  leading,
  entries,
  onViewAll,
  onInstall,
  onOpenPlugin,
}: {
  label: string;
  description?: string;
  leading?: ReactNode;
  entries: readonly PluginCatalogSearchEntry[];
  onViewAll?: () => void;
  onInstall: (initial: AddPluginInitial) => void;
  onOpenPlugin: (pluginId: string) => void;
}) {
  if (entries.length === 0) return null;
  return (
    <ResourceSourceShelf
      label={label}
      leading={leading}
      description={description}
      contentMode="panel"
      contentSurface="plain"
      browseAction={
        onViewAll === undefined ? undefined : (
          <ResourceShelfAction
            type="button"
            onClick={onViewAll}
            className="group gap-1"
          >
            View all
            {/* The arrow leans into the direction it takes you. */}
            {/* CONTROL_HOVER_TRANSITION is colour-only and snaps on hover, so
                it cannot carry this: the arrow needs the transform itself to
                ease, at the same 150ms the rest of the controls use. */}
            <Icon
              name="ChevronRight"
              className="size-3 transition-transform duration-150 group-hover:translate-x-1"
              aria-hidden
            />
          </ResourceShelfAction>
        )
      }
    >
      <PluginCatalogGrid
        entries={entries}
        previewLimitBelowXl={4}
        onInstall={onInstall}
        onOpenPlugin={onOpenPlugin}
      />
    </ResourceSourceShelf>
  );
}

function LegacyPublisherGroups({
  groups,
  showHeadings,
  onInstall,
  onOpenPlugin,
}: {
  groups: readonly PluginPublisherGroup[];
  showHeadings: boolean;
  onInstall: (initial: AddPluginInitial) => void;
  onOpenPlugin: (pluginId: string) => void;
}) {
  if (groups.length === 0) return null;
  return (
    <div className="space-y-5">
      {groups.map((group) => (
        <section key={group.key} className="space-y-3">
          {showHeadings ? (
            <h2 className="flex items-baseline gap-2 text-sm font-medium text-foreground">
              {group.label}
              {group.thirdParty ? (
                <span className="text-2xs font-normal text-subtle-foreground">
                  third-party marketplace
                </span>
              ) : null}
            </h2>
          ) : null}
          <PluginCatalogGrid
            entries={group.entries}
            onInstall={onInstall}
            onOpenPlugin={onOpenPlugin}
          />
        </section>
      ))}
    </div>
  );
}

export function PluginCatalogCard({
  entry,
  className,
  installedPluginId,
  showCategory = false,
  onInstall,
  onOpenPlugin,
}: {
  entry: PluginCatalogSearchEntry;
  className?: string;
  installedPluginId: string | null;
  showCategory?: boolean;
  onInstall: (initial: AddPluginInitial) => void;
  onOpenPlugin: (pluginId: string) => void;
}) {
  const queryClient = useQueryClient();
  const [confirmingUninstall, setConfirmingUninstall] = useState(false);
  const uninstall = useMutation({
    mutationFn: () => {
      if (installedPluginId === null) {
        throw new Error("Installed plugin id is unavailable");
      }
      return removePlugin(fetch, installedPluginId);
    },
    onSuccess: () => {
      setConfirmingUninstall(false);
      invalidatePluginList({ queryClient });
      invalidatePluginCatalogSearch({ queryClient });
      appToast.success(`${entry.displayName} uninstalled`);
    },
    onError: (error) => {
      appToast.error(`Uninstalling ${entry.displayName} failed`, {
        description: error instanceof Error ? error.message : String(error),
      });
    },
  });

  const leading = <CatalogEntryIconChip entry={entry} />;
  const description =
    entry.description.length > 0 ? entry.description : undefined;
  const descriptionArea = (
    <span className="block min-h-[2lh]">{description}</span>
  );
  const authorId = pluginMarketplaceAuthorId(entry);
  const authorByline =
    entry.author === null || authorId === null ? undefined : (
      <Link
        to={getPluginAuthorRoutePath({ authorId })}
        className="pointer-events-auto relative rounded-sm underline-offset-2 hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
      >
        <span className="text-2xs text-subtle-foreground">By:</span>{" "}
        <span className="text-xs text-foreground/80">{entry.author.name}</span>
      </Link>
    );
  // The category rides the byline rather than its own row: a card's metadata
  // line is where a reader already looks for it, and a fourth row made every
  // card taller for one short tag.
  const byline =
    showCategory && entry.category !== undefined ? (
      <span className="flex min-w-0 items-center gap-1.5">
        <PluginCategoryLabel
          categoryId={entry.categoryId}
          label={entry.category}
        />
        {/* The pill keeps its full width; the author is what gives way, or a
            long name runs under the source link beside it. */}
        <span className="min-w-0 truncate">{authorByline}</span>
      </span>
    ) : (
      authorByline
    );
  // The publisher label, not the marketplace's raw display name: a third-party
  // manifest names itself, and the raw name would print a reserved BB label on
  // the card that the server already refused to grant.
  // The source link sits with the publisher label: both say where the
  // plugin comes from. The card footer ignores pointer events so clicks fall
  // through to the open button; the link opts back in to take its own click.
  const sourceLink =
    entry.repositoryUrl === null ? null : (
      <a
        href={entry.repositoryUrl}
        target="_blank"
        rel="noreferrer"
        aria-label={`Open ${entry.displayName} source`}
        className="pointer-events-auto inline-flex items-center gap-0.5 leading-none underline underline-offset-2 hover:text-foreground"
      >
        Source
        {/* Optical nudge: centered against the line box, the glyph sits a
            pixel above the x-height of the lowercase label beside it. */}
        <Icon
          name="ExternalLink"
          className="size-2.5 shrink-0 translate-y-px"
          aria-hidden
        />
      </a>
    );
  const hasStats = entry.installs !== null || entry.updatedAt !== undefined;
  // Compact cards prioritize the two registry trust signals when they exist.
  // Keep the actionable source link beside them; the marketplace label
  // remains on cards with no stats (or when there is no link to show).
  const showPublisherLabel =
    !entry.official && (!hasStats || sourceLink === null);
  const originMeta =
    !showPublisherLabel && sourceLink === null ? undefined : (
      <span className="min-w-0 truncate text-2xs text-subtle-foreground">
        {showPublisherLabel ? entry.publisherLabel : null}
        {showPublisherLabel && sourceLink !== null ? " · " : null}
        {sourceLink}
      </span>
    );
  const updatedRelativeTime =
    entry.updatedAt === undefined
      ? null
      : formatRelativeTime({
          timestamp: Date.parse(entry.updatedAt),
          now: Date.now(),
        });
  // Just the number, handed to the install control as its own metadata. The
  // download glyph it used to carry repeated the control's glyph an inch away,
  // which read as two install affordances.
  const installCount =
    entry.installs === null
      ? undefined
      : {
          display: formatInstallCount(entry.installs),
          accessibleLabel: `${entry.installs.toLocaleString()} installs`,
        };
  // Install count sits with the Install control; the footer keeps provenance,
  // with the source link flush right where the eye lands last.
  const footerMeta =
    originMeta === undefined && updatedRelativeTime === null ? undefined : (
      <span className="flex min-w-0 items-center gap-1.5">
        {updatedRelativeTime === null ? null : (
          <ResourceCardStat
            icon="Clock"
            accessibleLabel={`Updated ${updatedRelativeTime}`}
          >
            {updatedRelativeTime}
          </ResourceCardStat>
        )}
        {originMeta}
      </span>
    );
  const installControl =
    installedPluginId !== null ? (
      <ResourceInstallControl
        accessibleLabel={`Uninstall ${entry.displayName}`}
        icon="Download"
        pending={uninstall.isPending}
        presentation="icon"
        tooltip={`Installed — uninstall ${entry.displayName}`}
        count={installCount}
        // Installed is a settled state, not an offer: it sits at the weight of
        // a disabled control so the eye goes to the cards you can still act on.
        // The glyph matches the install count beside it so the pair reads level.
        className="border-transparent bg-transparent text-subtle-foreground shadow-none hover:border-transparent hover:bg-transparent hover:text-muted-foreground focus-visible:border-transparent focus-visible:bg-transparent [&_svg]:size-3.5"
        onAction={() => setConfirmingUninstall(true)}
      />
    ) : (
      <ResourceInstallControl
        accessibleLabel={`Install ${entry.displayName}`}
        disabled={!entry.compatible}
        presentation="icon"
        tooltip={`Install ${entry.displayName}`}
        count={installCount}
        // A bordered box here competed with the card's own edge; the glyph
        // alone is enough on a surface this dense, sized to match the count.
        className="border-transparent bg-transparent shadow-none hover:border-transparent hover:bg-state-hover [&_svg]:size-3.5"
        onAction={() =>
          onInstall({
            entryId: entry.entryId,
            marketplace: entry.marketplace,
            publisherLabel: entry.publisherLabel,
            displayName: entry.displayName,
            icon: entry.icon,
            iconUrl: entry.iconUrl,
            iconTinted: entry.iconTinted,
            source: entry.source,
          })
        }
      />
    );
  // The control owns the count now, so the header action is the control.
  const headerAction = installControl;

  return (
    <>
      <ResourceBrowseCard
        className={cn(
          "min-h-28 gap-2 border-border bg-background p-3 shadow-none",
          className,
        )}
        leading={leading}
        title={
          <span className="line-clamp-2 whitespace-normal break-words font-medium leading-tight">
            {entry.displayName}
          </span>
        }
        description={descriptionArea}
        descriptionLines={2}
        byline={byline}
        footerMeta={footerMeta}
        headerAction={headerAction}
        openLabel={`Open ${entry.displayName} details`}
        onOpen={() => onOpenPlugin(entry.pluginId)}
      />
      {confirmingUninstall ? (
        <ConfirmDeleteDialog
          open
          onOpenChange={(open) => {
            if (!uninstall.isPending) setConfirmingUninstall(open);
          }}
        >
          <ConfirmDeleteDialogContent
            title={`Uninstall ${entry.displayName}?`}
            description="The plugin, its installed files, and its settings, secrets, and schedules are removed from this BB host."
            confirmLabel={uninstall.isPending ? "Uninstalling…" : "Uninstall"}
            pending={uninstall.isPending}
            onConfirm={() => uninstall.mutate()}
            onCancel={() => setConfirmingUninstall(false)}
          />
        </ConfirmDeleteDialog>
      ) : null}
    </>
  );
}

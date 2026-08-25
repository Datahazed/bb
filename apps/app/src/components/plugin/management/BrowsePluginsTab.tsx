import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useDebounceValue } from "usehooks-ts";
import {
  ResourceBrowseCard,
  ResourceBrowseGrid,
  ResourceCardStat,
  ResourceCollectionViewport,
  ResourceInstallControl,
  ResourceListState,
  ResourceOptionMenu,
  ResourceShelfAction,
  ResourceSourceItem,
  ResourceSourceShelf,
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
import { Icon } from "@bb/shared-ui/icon";
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
  categoryShelves,
  newAndNotableEntries,
  publisherGroups,
  sortPluginEntries,
  visibleCategoryChipCount,
  type PluginBrowseSort,
  type PluginCategoryShelf,
  type PluginPublisherGroup,
} from "./plugin-browse-discovery";
import { CatalogEntryIcon } from "./plugin-ui";
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

function browseSort(value: string | null): PluginBrowseSort | null {
  return PLUGIN_BROWSE_SORTS.find((sort) => sort === value) ?? null;
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
  const selectedCategory = catalogShelves.find(
    (shelf) => shelf.id === selectedCategoryId,
  );
  const selectedCategoryLabel =
    selectedCategory?.label ?? selectedCategoryId ?? "All categories";
  const hasInstallCounts = catalogEntries.some(
    (entry) => entry.installCount !== undefined,
  );
  const requestedSort = browseSort(searchParams.get("sort"));
  const activeSort =
    requestedSort === "most-installed" && !hasInstallCounts
      ? null
      : requestedSort;
  const sortOptions = PLUGIN_BROWSE_SORTS.filter(
    (sort) => sort !== "most-installed" || hasInstallCounts,
  ).map((sort) => ({ id: sort, label: PLUGIN_BROWSE_SORT_LABELS[sort] }));
  const categoryOptions = [
    { id: "all", label: "All categories" },
    ...catalogShelves.map((shelf) => ({ id: shelf.id, label: shelf.label })),
  ];
  if (selectedCategoryId !== null && selectedCategory === undefined) {
    // Keep a URL-addressed category active while a search has no matches in
    // it. Otherwise the page silently falls back to unfiltered results.
    categoryOptions.push({
      id: selectedCategoryId,
      label: selectedCategoryLabel,
    });
  }
  const categorizedEntries = shelves.flatMap((shelf) => shelf.entries);
  const legacyEntries = entries.filter(
    (entry) => entry.categoryId === undefined || entry.category === undefined,
  );
  const filteredCategoryEntries =
    selectedCategoryId === null
      ? categorizedEntries
      : categorizedEntries.filter(
          (entry) => entry.categoryId === selectedCategoryId,
        );
  const flatEntries =
    activeSort === null
      ? filteredCategoryEntries
      : sortPluginEntries(filteredCategoryEntries, activeSort);
  const notableEntries = newAndNotableEntries(categorizedEntries);
  const legacyGroups = publisherGroups(legacyEntries).map((group) => ({
    ...group,
    entries: sortPluginEntries(group.entries, activeSort ?? "name"),
  }));
  const showLegacyPublisherHeadings =
    hasCategoryDiscovery || legacyGroups.length > 1;

  function setDiscoveryParam(name: "category" | "sort", value: string | null) {
    const nextSearchParams = new URLSearchParams(searchParams);
    if (value === null) nextSearchParams.delete(name);
    else nextSearchParams.set(name, value);
    setSearchParams(nextSearchParams);
  }

  function clearSort() {
    const nextSearchParams = new URLSearchParams(searchParams);
    nextSearchParams.delete("sort");
    nextSearchParams.delete("category");
    setSearchParams(nextSearchParams);
  }

  // Radix gives every scroll viewport a display:table content wrapper so it
  // can measure horizontal content. Browse itself is vertical-only; its
  // shelves own their horizontal rails. Keeping that wrapper as a table lets
  // the rails expand the whole page at compact widths, so constrain only this
  // viewport's generated child to the available pane.
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
            <div className="w-full">
              <ResourceToolbar
                searchValue={query}
                searchPlaceholder="Search plugins"
                onSearchChange={setQuery}
                controls={
                  <>
                    {sortOptions.length > 0 ? (
                      <ResourceOptionMenu
                        label="Sort plugins"
                        icon="ArrowUpDown"
                        value={activeSort ?? ""}
                        options={sortOptions}
                        onChange={(value) => setDiscoveryParam("sort", value)}
                      />
                    ) : null}
                    {categoryOptions.length > 1 ? (
                      <ResourceOptionMenu
                        label="Filter plugins by category"
                        icon="SlidersHorizontal"
                        value={selectedCategoryId ?? "all"}
                        options={categoryOptions}
                        onChange={(value) =>
                          setDiscoveryParam(
                            "category",
                            value === "all" ? null : value,
                          )
                        }
                      />
                    ) : null}
                  </>
                }
              />
            </div>

            {activeSort === null ? null : (
              <div className="mt-3 space-y-2">
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    className="h-7 rounded-full px-2.5 font-normal"
                    aria-label={`Clear ${PLUGIN_BROWSE_SORT_LABELS[activeSort]} sort`}
                    onClick={clearSort}
                  >
                    {PLUGIN_BROWSE_SORT_LABELS[activeSort]}
                    <Icon name="X" className="size-3" aria-hidden />
                  </Button>
                </div>
                {hasCategoryDiscovery ? (
                  <CategoryChips
                    shelves={catalogShelves}
                    selectedCategoryId={selectedCategoryId}
                    onSelect={(categoryId) =>
                      setDiscoveryParam("category", categoryId)
                    }
                  />
                ) : null}
              </div>
            )}

            <div className="mt-7 space-y-3">
              {searchQuery.isError && entries.length > 0 ? (
                <p className="text-xs text-warning-text" role="status">
                  Showing cached catalog results because the latest search
                  failed.
                </p>
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
                (selectedCategoryId !== null || legacyEntries.length === 0) ? (
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
                    {selectedCategoryId === null ? (
                      <LegacyPublisherGroups
                        groups={legacyGroups}
                        showHeadings={showLegacyPublisherHeadings}
                        onInstall={onInstall}
                        onOpenPlugin={onOpenPlugin}
                      />
                    ) : null}
                  </div>
                )
              ) : selectedCategoryId === null ? (
                <div className="space-y-5">
                  {hasCategoryDiscovery ? (
                    <BrowseShelf
                      label="New & notable"
                      entries={notableEntries}
                      onInstall={onInstall}
                      onOpenPlugin={onOpenPlugin}
                    />
                  ) : null}
                  {shelves.map((shelf) => (
                    <BrowseShelf
                      key={shelf.id}
                      label={shelf.label}
                      count={shelf.entries.length}
                      entries={shelf.entries}
                      onViewAll={() => setDiscoveryParam("category", shelf.id)}
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
                      onClick={() => setDiscoveryParam("category", null)}
                    >
                      <Icon name="ChevronLeft" className="size-3" />
                      Browse plugins
                    </ResourceShelfAction>
                    <h2 className="text-base font-semibold text-foreground">
                      {selectedCategoryLabel}
                      <span className="ml-1.5 text-xs font-normal text-subtle-foreground">
                        · {filteredCategoryEntries.length} plugins
                      </span>
                    </h2>
                  </div>
                  {filteredCategoryEntries.length === 0 ? (
                    <ResourceListState
                      state="empty"
                      message="No plugins match this category and search."
                    />
                  ) : (
                    <PluginCatalogGrid
                      entries={filteredCategoryEntries}
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
  showCategory = false,
  onInstall,
  onOpenPlugin,
}: {
  entries: readonly PluginCatalogSearchEntry[];
  showCategory?: boolean;
  onInstall: (initial: AddPluginInitial) => void;
  onOpenPlugin: (pluginId: string) => void;
}) {
  return (
    <ResourceBrowseGrid className="grid-cols-[repeat(auto-fill,minmax(min(100%,18rem),1fr))] gap-2">
      {entries.map((entry) => (
        <PluginCatalogCard
          key={`${entry.marketplace}/${entry.entryId}`}
          entry={entry}
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
  count,
  entries,
  onViewAll,
  onInstall,
  onOpenPlugin,
}: {
  label: string;
  count?: number;
  entries: readonly PluginCatalogSearchEntry[];
  onViewAll?: () => void;
  onInstall: (initial: AddPluginInitial) => void;
  onOpenPlugin: (pluginId: string) => void;
}) {
  if (entries.length === 0) return null;
  return (
    <ResourceSourceShelf
      label={label}
      attribution={count === undefined ? undefined : `· ${count}`}
      browseAction={
        onViewAll === undefined ? undefined : (
          <ResourceShelfAction type="button" onClick={onViewAll}>
            View all
            <Icon name="ChevronRight" className="size-3" aria-hidden />
          </ResourceShelfAction>
        )
      }
    >
      {entries.map((entry) => (
        <ResourceSourceItem key={`${entry.marketplace}/${entry.entryId}`}>
          <PluginCatalogCard
            entry={entry}
            installedPluginId={entry.installed ? entry.pluginId : null}
            onInstall={onInstall}
            onOpenPlugin={onOpenPlugin}
          />
        </ResourceSourceItem>
      ))}
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

function CategoryChips({
  shelves,
  selectedCategoryId,
  onSelect,
}: {
  shelves: readonly PluginCategoryShelf[];
  selectedCategoryId: string | null;
  onSelect: (categoryId: string | null) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const allMeasureRef = useRef<HTMLButtonElement>(null);
  const categoryMeasureRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const overflowMeasureRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const [visibleCount, setVisibleCount] = useState(shelves.length);

  useLayoutEffect(() => {
    const container = containerRef.current;
    const all = allMeasureRef.current;
    if (container === null || all === null) return;

    const measure = () => {
      const categoryWidths = shelves.map(
        (_shelf, index) => categoryMeasureRefs.current[index]?.offsetWidth ?? 0,
      );
      if (
        container.clientWidth === 0 ||
        categoryWidths.some((width) => width === 0)
      ) {
        return;
      }
      setVisibleCount(
        visibleCategoryChipCount({
          containerWidth: container.clientWidth,
          allWidth: all.offsetWidth,
          categoryWidths,
          overflowWidthsByHiddenCount: overflowMeasureRefs.current.map(
            (element) => element?.offsetWidth ?? 0,
          ),
          gap: 8,
        }),
      );
    };

    measure();
    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", measure);
      return () => window.removeEventListener("resize", measure);
    }
    const observer = new ResizeObserver(measure);
    observer.observe(container);
    return () => observer.disconnect();
  }, [shelves]);

  const visibleShelves = shelves.slice(0, visibleCount);
  const hiddenShelves = shelves.slice(visibleCount);
  const chipClassName =
    "h-7 shrink-0 rounded-full px-3 font-normal aria-pressed:bg-state-active aria-pressed:text-foreground";

  return (
    <div className="relative min-w-0">
      <div
        ref={containerRef}
        role="radiogroup"
        aria-label="Filter plugins by category"
        className="flex min-w-0 items-center gap-2 overflow-hidden"
      >
        <Button
          type="button"
          variant="outline"
          size="sm"
          className={chipClassName}
          role="radio"
          aria-checked={selectedCategoryId === null}
          aria-pressed={selectedCategoryId === null}
          onClick={() => onSelect(null)}
        >
          All
        </Button>
        {visibleShelves.map((shelf) => (
          <Button
            key={shelf.id}
            type="button"
            variant="outline"
            size="sm"
            className={chipClassName}
            role="radio"
            aria-checked={selectedCategoryId === shelf.id}
            aria-pressed={selectedCategoryId === shelf.id}
            onClick={() => onSelect(shelf.id)}
          >
            {shelf.label}
          </Button>
        ))}
        {hiddenShelves.length > 0 ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className={chipClassName}
                aria-label={`Show ${hiddenShelves.length} more categories`}
                aria-pressed={hiddenShelves.some(
                  (shelf) => shelf.id === selectedCategoryId,
                )}
              >
                +{hiddenShelves.length} more
                <Icon name="ChevronDown" className="size-3" aria-hidden />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-48">
              {hiddenShelves.map((shelf) => (
                <DropdownMenuItem
                  key={shelf.id}
                  onSelect={() => onSelect(shelf.id)}
                  className="flex items-center justify-between gap-3"
                >
                  {shelf.label}
                  <Icon
                    name="Check"
                    aria-hidden
                    className={cn(
                      "size-4",
                      shelf.id === selectedCategoryId
                        ? "opacity-100"
                        : "opacity-0",
                    )}
                  />
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </div>

      <div
        aria-hidden
        className="pointer-events-none invisible absolute left-0 top-0 flex w-full items-center gap-2 overflow-hidden"
      >
        <Button
          ref={allMeasureRef}
          type="button"
          variant="outline"
          size="sm"
          className={chipClassName}
          tabIndex={-1}
        >
          All
        </Button>
        {shelves.map((shelf, index) => (
          <Button
            key={shelf.id}
            ref={(element) => {
              categoryMeasureRefs.current[index] = element;
            }}
            type="button"
            variant="outline"
            size="sm"
            className={chipClassName}
            tabIndex={-1}
          >
            {shelf.label}
          </Button>
        ))}
        {Array.from({ length: shelves.length + 1 }, (_unused, hiddenCount) =>
          hiddenCount === 0 ? null : (
            <Button
              key={hiddenCount}
              ref={(element) => {
                overflowMeasureRefs.current[hiddenCount] = element;
              }}
              type="button"
              variant="outline"
              size="sm"
              className={chipClassName}
              tabIndex={-1}
            >
              +{hiddenCount} more
              <Icon name="ChevronDown" className="size-3" aria-hidden />
            </Button>
          ),
        )}
      </div>
    </div>
  );
}

export function PluginCatalogCard({
  entry,
  installedPluginId,
  showCategory = false,
  onInstall,
  onOpenPlugin,
}: {
  entry: PluginCatalogSearchEntry;
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

  const leading = <CatalogEntryIcon entry={entry} className="size-6" />;
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
        By: {entry.author.name}
      </Link>
    );
  const byline =
    showCategory && entry.category !== undefined ? (
      <span className="flex min-w-0 items-center gap-1.5">
        <span className="shrink-0 rounded bg-surface-recessed px-1.5 py-0.5 text-2xs text-muted-foreground">
          {entry.category}
        </span>
        {authorByline}
      </span>
    ) : (
      authorByline
    );
  // The publisher label, not the marketplace's raw display name: a third-party
  // manifest names itself, and the raw name would print a reserved BB label on
  // the card that the server already refused to grant.
  // The repository link sits with the publisher label: both say where the
  // plugin comes from. The card footer ignores pointer events so clicks fall
  // through to the open button; the link opts back in to take its own click.
  const repositoryLink =
    entry.repositoryUrl === null ? null : (
      <a
        href={entry.repositoryUrl}
        target="_blank"
        rel="noreferrer"
        aria-label={`Open ${entry.displayName} repository`}
        className="pointer-events-auto inline-flex items-center gap-0.5 leading-none underline underline-offset-2 hover:text-foreground"
      >
        repo
        {/* Optical nudge: centered against the line box, the glyph sits a
            pixel above the x-height of the lowercase label beside it. */}
        <Icon
          name="ExternalLink"
          className="size-2.5 shrink-0 translate-y-px"
          aria-hidden
        />
      </a>
    );
  const hasStats =
    entry.installCount !== undefined || entry.updatedAt !== undefined;
  // Compact cards prioritize the two registry trust signals when they exist.
  // Keep the actionable repository link beside them; the marketplace label
  // remains on cards with no stats (or when there is no link to show).
  const showPublisherLabel =
    !entry.official && (!hasStats || repositoryLink === null);
  const originMeta =
    !showPublisherLabel && repositoryLink === null ? undefined : (
      <span className="min-w-0 truncate text-2xs text-subtle-foreground">
        {showPublisherLabel ? entry.publisherLabel : null}
        {showPublisherLabel && repositoryLink !== null ? " · " : null}
        {repositoryLink}
      </span>
    );
  const updatedRelativeTime =
    entry.updatedAt === undefined
      ? null
      : formatRelativeTime({
          timestamp: Date.parse(entry.updatedAt),
          now: Date.now(),
        });
  const stats = (
    <>
      {entry.installCount === undefined ? null : (
        <ResourceCardStat
          icon="Download"
          accessibleLabel={`${entry.installCount.toLocaleString()} installs`}
        >
          {formatInstallCount(entry.installCount)}
        </ResourceCardStat>
      )}
      {updatedRelativeTime === null ? null : (
        <ResourceCardStat
          icon="Clock"
          accessibleLabel={`Updated ${updatedRelativeTime}`}
        >
          {updatedRelativeTime}
        </ResourceCardStat>
      )}
    </>
  );
  const footerMeta =
    originMeta === undefined && !hasStats ? undefined : (
      <span className="flex min-w-0 items-center gap-1.5">
        {originMeta}
        {originMeta !== undefined && hasStats ? (
          <span aria-hidden className="text-subtle-foreground">
            ·
          </span>
        ) : null}
        {stats}
      </span>
    );
  const headerAction =
    installedPluginId !== null ? (
      <ResourceInstallControl
        accessibleLabel={`Uninstall ${entry.displayName}`}
        icon="Check"
        pending={uninstall.isPending}
        presentation="icon"
        tooltip={`Installed — uninstall ${entry.displayName}`}
        className="border-transparent bg-transparent text-[color:color-mix(in_oklab,var(--success)_72%,var(--ink))] shadow-none hover:border-transparent hover:bg-transparent hover:text-[color:color-mix(in_oklab,var(--success)_72%,var(--ink))] focus-visible:border-transparent focus-visible:bg-transparent focus-visible:text-[color:color-mix(in_oklab,var(--success)_72%,var(--ink))]"
        onAction={() => setConfirmingUninstall(true)}
      />
    ) : (
      <ResourceInstallControl
        accessibleLabel={`Install ${entry.displayName}`}
        disabled={!entry.compatible}
        presentation="icon"
        tooltip={`Install ${entry.displayName}`}
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

  return (
    <>
      <ResourceBrowseCard
        className="min-h-20 grid-cols-[minmax(0,1fr)_fit-content(10rem)] gap-x-2 gap-y-1.5 p-2.5"
        leading={leading}
        title={entry.displayName}
        description={descriptionArea}
        byline={byline}
        footerMeta={footerMeta}
        headerAction={headerAction}
        openLabel={`Open ${entry.displayName} details`}
        onOpen={() => onOpenPlugin(entry.pluginId)}
      />
      <ConfirmDeleteDialog
        open={confirmingUninstall}
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
    </>
  );
}

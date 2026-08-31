import { useEffect, useState, type MouseEvent, type ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import { useDebounceValue } from "usehooks-ts";
import {
  PLUGIN_CATALOG_CATEGORIES,
  defaultPluginDiscoverySortDirection,
} from "@bb/domain";
import {
  ResourceBrowseCard,
  ResourceBrowseGrid,
  ResourceCollectionViewport,
  ResourceListState,
  ResourceShelfAction,
  ResourceSourceShelf,
  ResourceSortMenu,
  ResourceToolbar,
} from "@bb/shared-ui/resource-list";
import { Button } from "@bb/shared-ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@bb/shared-ui/dropdown-menu";
import { Icon } from "@bb/shared-ui/icon";
import { cn } from "@bb/shared-ui/lib/utils";
import { TOOLS_PAGE_BAND_CLASSES } from "@/components/tools/tools-navigation";
import { BrowseArchetypeCards } from "@/components/plugin/browse-hero/BrowseArchetypeCards";
import { nextComposerRequestNonce } from "@/components/plugin/browse-hero/browse-hero-archetypes";
import { BrowseHeroCarousel } from "@/components/plugin/browse-hero/BrowseHeroCarousel";
import {
  usePluginCatalogSearch,
  type PluginCatalogSearchEntry,
} from "@/hooks/queries/plugin-catalog-queries";
import { formatInstallCount } from "@/lib/skills-registry";
import type { AddPluginInitial } from "./AddPluginDialog";
import {
  categoryShelves,
  newAndNotableEntries,
  publisherGroups,
  sortPluginEntries,
  type PluginBrowseSort,
  type PluginPublisherGroup,
} from "./plugin-browse-discovery";
import {
  PluginBrowseCategoryFilter,
  pluginBrowseSort,
  pluginBrowseSortDirection,
  pluginBrowseSortOptions,
  type PluginBrowseCategoryOption,
} from "./PluginBrowseControls";
import { PluginCatalogInstallControl } from "./PluginCatalogInstallControl";
import {
  CatalogEntryIconChip,
  PluginCategoryLabel,
  pluginCatalogCategoryAccentStyle,
  pluginCatalogCategoryMutedAccentStyle,
  pluginCatalogCategoryPillStyle,
} from "./plugin-ui";
import { pluginMarketplaceAuthorId } from "./plugin-marketplace-author";
import { PluginAuthorLink } from "./PluginAuthorLink";

const NEW_AND_NOTABLE_ICON_SPARKLES = [
  { left: 0, top: 0, size: 8 },
  { left: 11, top: 1, size: 5 },
  { left: 8, top: 9, size: 7 },
  { left: 1, top: 12, size: 4 },
] as const;

const NEW_AND_NOTABLE_SPARKLE_CLIP_PATH =
  "polygon(50% 0, 62% 38%, 100% 50%, 62% 62%, 50% 100%, 38% 62%, 0 50%, 38% 38%)";

function NewAndNotableIcon({
  entries,
}: {
  entries: readonly PluginCatalogSearchEntry[];
}) {
  return (
    <span className="relative size-4 shrink-0" aria-hidden>
      {NEW_AND_NOTABLE_ICON_SPARKLES.map((sparkle, index) => {
        const accentStyle = pluginCatalogCategoryMutedAccentStyle(
          entries[index]?.categoryId,
        );
        return (
          <span
            key={index}
            data-new-notable-accent={index}
            className="absolute"
            style={{
              background:
                accentStyle?.background ?? "var(--muted-foreground)",
              left: sparkle.left,
              top: sparkle.top,
              width: sparkle.size,
              height: sparkle.size,
              clipPath: NEW_AND_NOTABLE_SPARKLE_CLIP_PATH,
            }}
          />
        );
      })}
    </span>
  );
}

function scrollShelfToTop(event: MouseEvent<HTMLButtonElement>) {
  const shelf = event.currentTarget.closest("section");
  if (shelf === null) return;
  const scrollContainer = shelf.closest<HTMLElement>(
    '[data-resource-collection-scroll="true"]',
  );
  if (scrollContainer === null) return;
  const targetTop =
    scrollContainer.scrollTop +
    shelf.getBoundingClientRect().top -
    scrollContainer.getBoundingClientRect().top;
  const shelfList = shelf.closest<HTMLElement>("[data-plugin-shelf-list]");
  const missingEndSpace = Math.max(
    0,
    targetTop - (scrollContainer.scrollHeight - scrollContainer.clientHeight),
  );
  if (shelfList !== null && missingEndSpace > 0) {
    const currentEndSpace = Number.parseFloat(shelfList.style.paddingBottom) || 0;
    shelfList.style.paddingBottom = `${Math.ceil(
      currentEndSpace + missingEndSpace,
    )}px`;
    shelfList.getBoundingClientRect();
  }
  scrollContainer.scrollTo({
    top: Math.max(0, targetTop),
    behavior: "auto",
  });
}

export function BrowsePluginsTab({
  onInstall,
  onOpenPlugin,
  onInstallFromSource,
}: {
  onInstall: (initial: AddPluginInitial) => void;
  onOpenPlugin: (pluginId: string) => void;
  onInstallFromSource: () => void;
}) {
  const [query, setQuery] = useState("");
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
  if (requestedCreationView !== creationViewActive) {
    setRequestedCreationView(creationViewActive);
    setHeroRequest({
      nonce: nextComposerRequestNonce(),
      ...(creationViewActive ? {} : { close: true }),
    });
  }
  useEffect(() => {
    if (heroRequest === null) return;
    const viewport = document.getElementById("plugins-browse-results");
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
  const catalogEntries = (catalogQuery.data ?? []).filter(
    (entry) => entry.compatible,
  );
  const entries = (searchQuery.data ?? []).filter((entry) => entry.compatible);
  const shelves = categoryShelves(entries);
  const catalogShelves = categoryShelves(catalogEntries);
  const hasCategoryDiscovery = catalogShelves.length > 0;
  const selectedCategoryIds = hasCategoryDiscovery
    ? [...new Set(searchParams.getAll("category").filter(Boolean))]
    : [];
  const selectedCategoryId =
    selectedCategoryIds.length === 1 ? (selectedCategoryIds[0] ?? null) : null;
  const selectedCategory =
    selectedCategoryId === null
      ? undefined
      : PLUGIN_CATALOG_CATEGORIES.find(
          (category) => category.id === selectedCategoryId,
        );
  const selectedCategoryLabel =
    selectedCategoryIds.length === 0
      ? "All categories"
      : selectedCategoryIds.length === 1
        ? (selectedCategory?.displayName ?? selectedCategoryId ?? "Category")
        : `${selectedCategoryIds.length} categories`;
  const hasInstallCounts = catalogEntries.some(
    (entry) => entry.installs !== null,
  );
  const requestedSort = pluginBrowseSort(searchParams.get("sort"));
  const usableRequestedSort =
    requestedSort === "most-installed" && !hasInstallCounts
      ? null
      : requestedSort;
  const activeSort = usableRequestedSort;
  const activeDirection =
    activeSort === null
      ? "desc"
      : (pluginBrowseSortDirection(searchParams.get("direction")) ??
        defaultPluginDiscoverySortDirection(activeSort));
  const sortOptions = pluginBrowseSortOptions(hasInstallCounts);
  const catalogCategoryCounts = new Map(
    catalogShelves.map((shelf) => [shelf.id, shelf.entries.length]),
  );
  const categoryOptions: PluginBrowseCategoryOption[] =
    PLUGIN_CATALOG_CATEGORIES.map((category) => ({
      id: category.id,
      label: category.displayName,
      count: catalogCategoryCounts.get(category.id) ?? 0,
    }));
  for (const categoryId of selectedCategoryIds) {
    if (
      PLUGIN_CATALOG_CATEGORIES.some(
        (category) => category.id === categoryId,
      )
    ) {
      continue;
    }
    categoryOptions.push({ id: categoryId, label: categoryId, count: 0 });
  }
  const dropdownCategoryOptions = [...categoryOptions].sort(
    (left, right) =>
      right.count - left.count || left.label.localeCompare(right.label),
  );
  const categorizedEntries = shelves.flatMap((shelf) => shelf.entries);
  const selectedCategorySet = new Set(selectedCategoryIds);
  const selectedShelves = shelves.filter((shelf) =>
    selectedCategorySet.has(shelf.id),
  );
  const legacyEntries = entries.filter(
    (entry) => entry.categoryId === undefined || entry.category === undefined,
  );
  const scopedEntries = categorizedEntries.filter((entry) => {
    if (selectedCategorySet.size > 0) {
      return selectedCategorySet.has(entry.categoryId);
    }
    return true;
  });
  const flatEntries =
    activeSort === null
      ? scopedEntries
      : sortPluginEntries(scopedEntries, activeSort, activeDirection);
  const notableEntries = newAndNotableEntries(categorizedEntries);
  const legacyGroups = publisherGroups(legacyEntries).map((group) => ({
    ...group,
    entries: sortPluginEntries(
      group.entries,
      activeSort ?? "name",
      activeSort === null ? "asc" : activeDirection,
    ),
  }));
  const showLegacyPublisherHeadings =
    hasCategoryDiscovery || legacyGroups.length > 1;

  function setCategories(categoryIds: readonly string[]) {
    const nextSearchParams = new URLSearchParams(searchParams);
    nextSearchParams.delete("shelf");
    nextSearchParams.delete("category");
    for (const categoryId of categoryIds) {
      nextSearchParams.append("category", categoryId);
    }
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

  return (
    <ResourceCollectionViewport
      scrollId="plugins-browse-results"
      contentClassName="[&>div]:!block [&>div]:!min-w-0 [&>div]:!w-full"
    >
      {
}
      <div className={cn("space-y-7", TOOLS_PAGE_BAND_CLASSES)}>
        {}
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
          <BrowseArchetypeCards onCreate={openComposer} />
        ) : (
          <section>
            <div
              className={cn(
                "w-full",
                activeSort === null &&
                  selectedCategoryIds.length !== 1 &&
                  "px-[var(--resource-source-shelf-inset)]",
              )}
            >
              <ResourceToolbar
                searchValue={query}
                searchPlaceholder="Search plugins"
                onSearchChange={setQuery}
                controls={
                  <>
                    {sortOptions.length > 0 ? (
                      <ResourceSortMenu
                        value={activeSort}
                        direction={activeDirection}
                        options={sortOptions}
                        compact
                        placeholderLabel="Sort plugins"
                        onClear={clearSort}
                        onChange={(value) => {
                          const sort = pluginBrowseSort(value);
                          if (sort !== null) setSort(sort);
                        }}
                      />
                    ) : null}
                    {hasCategoryDiscovery ? (
                      <PluginBrowseCategoryFilter
                        selectionMode="multiple"
                        value={selectedCategoryIds}
                        options={dropdownCategoryOptions}
                        onChange={setCategories}
                      />
                    ) : null}
                  </>
                }
              />
            </div>

            <div className="mt-7 space-y-3">
              {searchQuery.isError && entries.length > 0 ? (
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
                (selectedCategoryIds.length > 0 ||
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
                    {selectedCategoryIds.length === 0 ? (
                      <LegacyPublisherGroups
                        groups={legacyGroups}
                        showHeadings={showLegacyPublisherHeadings}
                        onInstall={onInstall}
                        onOpenPlugin={onOpenPlugin}
                      />
                    ) : null}
                  </div>
                )
              ) : selectedCategoryIds.length === 0 ? (
                <div
                  key={debouncedQuery}
                  data-plugin-shelf-list
                  className="space-y-9 [&>*+*]:border-t [&>*+*]:border-border-seam/60 [&>*+*]:pt-9"
                >
                  {hasCategoryDiscovery ? (
                    <BrowseShelf
                      label="New & notable"
                      entries={notableEntries}
                      showCategory
                      leading={<NewAndNotableIcon entries={notableEntries} />}
                      onInstall={onInstall}
                      onOpenPlugin={onOpenPlugin}
                    />
                  ) : null}
                  {shelves.map((shelf) => (
                    <BrowseShelf
                      key={shelf.id}
                      categoryId={shelf.id}
                      label={shelf.label}
                      description={shelf.description}
                      entries={shelf.entries.slice(0, 6)}
                      onViewAll={() => setCategories([shelf.id])}
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
              ) : selectedCategoryIds.length > 1 ? (
                selectedShelves.length === 0 ? (
                  <ResourceListState
                    state="empty"
                    message="No plugins match this browse selection and search."
                  />
                ) : (
                  <div
                    key={debouncedQuery}
                    data-plugin-shelf-list
                    className="space-y-9 [&>*+*]:border-t [&>*+*]:border-border-seam/60 [&>*+*]:pt-9"
                  >
                    {selectedShelves.map((shelf) => (
                      <BrowseShelf
                        key={shelf.id}
                        categoryId={shelf.id}
                        label={shelf.label}
                        description={shelf.description}
                        entries={shelf.entries.slice(0, 6)}
                        onViewAll={() => setCategories([shelf.id])}
                        onInstall={onInstall}
                        onOpenPlugin={onOpenPlugin}
                      />
                    ))}
                  </div>
                )
              ) : (
                <section className="space-y-3">
                  <div data-plugin-list-header>
                    <ResourceShelfAction
                      type="button"
                      className="-ml-2"
                      onClick={clearDiscoveryScope}
                    >
                      <Icon name="ChevronLeft" className="size-3" />
                      Browse plugins
                    </ResourceShelfAction>
                    <h2 className="flex flex-wrap items-center gap-2 text-base font-semibold text-foreground">
                      <span>{selectedCategoryLabel}</span>
                      <span
                        className="rounded-md px-2 py-1 text-2xs font-medium tabular-nums"
                        style={pluginCatalogCategoryPillStyle(
                          selectedCategoryId ?? undefined,
                        )}
                      >
                        {scopedEntries.length.toLocaleString()}{" "}
                        {scopedEntries.length === 1 ? "plugin" : "plugins"}
                      </span>
                    </h2>
                    {selectedCategory?.description ? (
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
  preview = false,
  showCategory = false,
  onInstall,
  onOpenPlugin,
}: {
  entries: readonly PluginCatalogSearchEntry[];
  preview?: boolean;
  showCategory?: boolean;
  onInstall: (initial: AddPluginInitial) => void;
  onOpenPlugin: (pluginId: string) => void;
}) {
  const cards = entries.map((entry) => (
    <PluginCatalogCard
      key={`${entry.marketplace}/${entry.entryId}`}
      entry={entry}
      installed={entry.installed}
      showCategory={showCategory}
      onInstall={onInstall}
      onOpenPlugin={onOpenPlugin}
    />
  ));
  if (preview) {
    return (
      <div data-plugin-shelf>
        <div data-plugin-shelf-grid className="grid gap-2">
          {cards}
        </div>
      </div>
    );
  }
  return (
    <ResourceBrowseGrid className="grid-cols-[repeat(auto-fill,minmax(min(100%,16rem),1fr))] gap-2">
      {cards}
    </ResourceBrowseGrid>
  );
}

function BrowseShelf({
  categoryId,
  label,
  description,
  leading,
  entries,
  showCategory = false,
  onViewAll,
  onInstall,
  onOpenPlugin,
}: {
  categoryId?: string;
  label: string;
  description?: string;
  leading?: ReactNode;
  entries: readonly PluginCatalogSearchEntry[];
  showCategory?: boolean;
  onViewAll?: () => void;
  onInstall: (initial: AddPluginInitial) => void;
  onOpenPlugin: (pluginId: string) => void;
}) {
  if (entries.length === 0) return null;
  const accentStyle = pluginCatalogCategoryMutedAccentStyle(categoryId);
  const focusAccentStyle = pluginCatalogCategoryAccentStyle(categoryId);
  const shelfLabel = (
    <button
      type="button"
      data-plugin-shelf-title
      aria-label={`Scroll ${label} shelf to top`}
      className="group inline-flex max-w-full cursor-pointer items-center gap-2 rounded-sm text-left font-semibold text-foreground outline-none transition-colors hover:text-muted-foreground"
      onMouseDown={(event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        event.currentTarget.focus({ preventScroll: true });
      }}
      onClick={scrollShelfToTop}
    >
      {accentStyle === undefined ? null : (
        <span
          data-plugin-category-accent={categoryId}
          className="relative block h-4 w-0.5 shrink-0 overflow-hidden rounded-full"
          style={accentStyle}
          aria-hidden
        >
          <span
            className="absolute inset-0 opacity-0 transition-opacity group-focus-visible:opacity-100"
            style={focusAccentStyle}
          />
        </span>
      )}
      <span className="truncate">{label}</span>
    </button>
  );
  return (
    <ResourceSourceShelf
      label={shelfLabel}
      leading={leading}
      description={description}
      contentMode="panel"
      contentSurface="plain"
      browseAction={
        onViewAll === undefined ? undefined : (
          <ResourceShelfAction
            type="button"
            onClick={onViewAll}
            className="group gap-1 font-medium text-subtle-foreground"
          >
            View all
            { }
            {
}
            <Icon
              name="ChevronRight"
              className="size-3"
              aria-hidden
            />
          </ResourceShelfAction>
        )
      }
    >
      <PluginCatalogGrid
        entries={entries}
        preview
        showCategory={showCategory}
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
  installed,
  showCategory = false,
  onInstall,
  onOpenPlugin,
}: {
  entry: PluginCatalogSearchEntry;
  className?: string;
  installed: boolean;
  showCategory?: boolean;
  onInstall: (initial: AddPluginInitial) => void;
  onOpenPlugin: (pluginId: string) => void;
}) {
  const leading = <CatalogEntryIconChip entry={entry} />;
  const description =
    entry.description.length > 0 ? entry.description : undefined;
  const descriptionArea = (
    <span className="block min-h-[2lh]">{description}</span>
  );
  const authorId = pluginMarketplaceAuthorId(entry);
  const authorByline =
    entry.author === null || authorId === null ? undefined : (
      <PluginAuthorLink
        authorId={authorId}
        className="pointer-events-auto relative rounded-sm underline-offset-2 hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
      >
        <span className="text-2xs text-subtle-foreground">By:</span>{" "}
        <span className="text-xs text-foreground/80">{entry.author.name}</span>
      </PluginAuthorLink>
    );
  const categoryLabel =
    showCategory && entry.category !== undefined ? (
      <PluginCategoryLabel
        categoryId={entry.categoryId}
        label={entry.category}
      />
    ) : undefined;
  const installCount =
    entry.installs === null
      ? undefined
      : {
          display: formatInstallCount(entry.installs),
          accessibleLabel: `${entry.installs.toLocaleString()} installs`,
        };
  const installInitial: AddPluginInitial = {
    entryId: entry.entryId,
    marketplace: entry.marketplace,
    publisherLabel: entry.publisherLabel,
    displayName: entry.displayName,
    icon: entry.icon,
    iconUrl: entry.iconUrl,
    iconTinted: entry.iconTinted,
    source: entry.source,
  };
  const headerAction =
    installed ? (
      <PluginCatalogInstallControl
        displayName={entry.displayName}
        installed
        count={installCount}
      />
    ) : (
      <PluginCatalogInstallControl
        displayName={entry.displayName}
        installed={false}
        disabled={!entry.compatible}
        count={installCount}
        onInstall={() => onInstall(installInitial)}
      />
    );

  return (
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
      byline={authorByline}
      headerAction={headerAction}
      footerMeta={categoryLabel}
      openLabel={`Open ${entry.displayName} details`}
      onOpen={() => onOpenPlugin(entry.pluginId)}
    />
  );
}

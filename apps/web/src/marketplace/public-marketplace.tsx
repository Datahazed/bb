import { visiblePluginCategoryChipCount } from "@bb/domain";
import {
  ArrowDown01Icon,
  ArrowRight01Icon,
  Cancel01Icon,
  Clock01Icon,
  Copy01Icon,
  Download01Icon,
  GithubIcon,
  LinkSquare01Icon,
  PackageIcon,
  PuzzleIcon,
  Search01Icon,
  Tick02Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Link } from "@tanstack/react-router";
import { useLayoutEffect, useRef, useState, type CSSProperties } from "react";

import { SiteFooter, SiteNav } from "../landing/site-chrome.js";
import type {
  MarketplaceCategoryId,
  MarketplaceV2Entry,
  MarketplaceV2Manifest,
} from "./marketplace-v2.js";
import {
  marketplaceEntryInstalls,
  type MarketplaceStats,
} from "./marketplace-stats.js";
import {
  attemptMarketplaceInstall,
  filterMarketplaceEntries,
  formatInstalls,
  formatMarketplaceDate,
  marketplaceAssetUrl,
  marketplaceCategory,
  MARKETPLACE_CATEGORIES,
  marketplaceInstallCommand,
  marketplaceRepositoryUrl,
  marketplaceShelves,
  newAndNotableEntries,
  sortMarketplaceEntries,
  type MarketplaceShelf,
  type MarketplaceSort,
} from "./marketplace-view-model.js";

const SORT_LABELS: Record<MarketplaceSort, string> = {
  "recently-added": "Recently added",
  "most-installed": "Most installed",
  name: "Name",
};

export interface MarketplaceIndexState {
  category?: MarketplaceCategoryId;
  sort?: MarketplaceSort;
}

function PluginArtwork({ entry }: { entry: MarketplaceV2Entry }) {
  if (typeof entry.icon === "string") {
    return (
      <span className="marketplace-card-icon" aria-hidden>
        <HugeiconsIcon icon={PuzzleIcon} />
      </span>
    );
  }
  const source = marketplaceAssetUrl(entry.icon.url);
  if (
    new URL(source, "https://getbb.app").pathname.toLowerCase().endsWith(".svg")
  ) {
    const style = {
      WebkitMaskImage: `url(${JSON.stringify(source)})`,
      maskImage: `url(${JSON.stringify(source)})`,
    } as CSSProperties;
    return (
      <span
        className="marketplace-card-icon marketplace-icon-mask"
        style={style}
        aria-hidden
      />
    );
  }
  return (
    <span className="marketplace-card-icon" aria-hidden>
      <img src={source} alt="" />
    </span>
  );
}

function PluginStats({
  entry,
  stats,
}: {
  entry: MarketplaceV2Entry;
  stats: MarketplaceStats | null;
}) {
  const installTotal = marketplaceEntryInstalls(entry, stats);
  const installs = formatInstalls(installTotal);
  const updated = formatMarketplaceDate(entry.updatedAt);
  if (installs === null && updated === null) return null;
  return (
    <span className="marketplace-card-stats">
      {installs === null ? null : (
        <span aria-label={`${installTotal!.toLocaleString("en-US")} installs`}>
          <HugeiconsIcon icon={Download01Icon} aria-hidden />
          {installs}
        </span>
      )}
      {updated === null ? null : (
        <span>
          <HugeiconsIcon icon={Clock01Icon} aria-hidden />
          {updated}
        </span>
      )}
    </span>
  );
}

function PluginCard({
  entry,
  stats,
  showCategory = false,
}: {
  entry: MarketplaceV2Entry;
  stats: MarketplaceStats | null;
  showCategory?: boolean;
}) {
  return (
    <article className="marketplace-card">
      <Link
        className="marketplace-card-link"
        to="/marketplace/$pluginId"
        params={{ pluginId: entry.id }}
        aria-label={`Open ${entry.displayName} details`}
      >
        <span className="marketplace-card-title">
          <PluginArtwork entry={entry} />
          <strong>{entry.displayName}</strong>
        </span>
        <span className="marketplace-card-description">
          {entry.description}
        </span>
      </Link>
      <span className="marketplace-card-byline">
        {showCategory ? (
          <span className="marketplace-category-label">
            {marketplaceCategory(entry.category).label}
          </span>
        ) : null}
        <span>By {entry.author.name}</span>
      </span>
      <PluginStats entry={entry} stats={stats} />
    </article>
  );
}

function PluginGrid({
  entries,
  stats,
  showCategory = false,
}: {
  entries: readonly MarketplaceV2Entry[];
  stats: MarketplaceStats | null;
  showCategory?: boolean;
}) {
  return (
    <div className="marketplace-grid">
      {entries.map((entry) => (
        <PluginCard
          key={entry.id}
          entry={entry}
          stats={stats}
          showCategory={showCategory}
        />
      ))}
    </div>
  );
}

function Shelf({
  shelf,
  stats,
}: {
  shelf: MarketplaceShelf;
  stats: MarketplaceStats | null;
}) {
  return (
    <section className="marketplace-shelf">
      <div className="marketplace-section-head">
        <h2>
          {shelf.category.label}
          <span>· {shelf.entries.length}</span>
        </h2>
        <Link
          to="/marketplace"
          search={{ category: shelf.category.id }}
          className="marketplace-view-all"
        >
          View all
          <HugeiconsIcon icon={ArrowRight01Icon} aria-hidden />
        </Link>
      </div>
      <PluginGrid entries={shelf.entries.slice(0, 3)} stats={stats} />
    </section>
  );
}

function CategoryChips({
  shelves,
  selected,
  onSelect,
}: {
  shelves: readonly MarketplaceShelf[];
  selected: MarketplaceCategoryId | undefined;
  onSelect: (category: MarketplaceCategoryId | undefined) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const allRef = useRef<HTMLButtonElement>(null);
  const chipRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const overflowRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const [visibleCount, setVisibleCount] = useState(shelves.length);

  useLayoutEffect(() => {
    const container = containerRef.current;
    const all = allRef.current;
    if (container === null || all === null) return;
    const measure = () => {
      const chipWidths = shelves.map(
        (_shelf, index) => chipRefs.current[index]?.offsetWidth ?? 0,
      );
      if (
        container.clientWidth === 0 ||
        chipWidths.some((width) => width === 0)
      ) {
        return;
      }
      setVisibleCount(
        visiblePluginCategoryChipCount({
          containerWidth: container.clientWidth,
          allWidth: all.offsetWidth,
          categoryWidths: chipWidths,
          overflowWidthsByHiddenCount: overflowRefs.current.map(
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

  const visible = shelves.slice(0, visibleCount);
  const hidden = shelves.slice(visibleCount);
  return (
    <div className="marketplace-chip-measure-wrap">
      <div
        ref={containerRef}
        className="marketplace-chips"
        role="radiogroup"
        aria-label="Filter plugins by category"
      >
        <button
          type="button"
          className="marketplace-chip"
          aria-pressed={selected === undefined}
          role="radio"
          aria-checked={selected === undefined}
          onClick={() => onSelect(undefined)}
        >
          All
        </button>
        {visible.map((shelf) => (
          <button
            key={shelf.category.id}
            type="button"
            className="marketplace-chip"
            aria-pressed={selected === shelf.category.id}
            role="radio"
            aria-checked={selected === shelf.category.id}
            onClick={() => onSelect(shelf.category.id)}
          >
            {shelf.category.label}
          </button>
        ))}
        {hidden.length > 0 ? (
          <details className="marketplace-chip-overflow">
            <summary className="marketplace-chip">
              +{hidden.length} more
              <HugeiconsIcon icon={ArrowDown01Icon} aria-hidden />
            </summary>
            <div className="marketplace-chip-menu">
              {hidden.map((shelf) => (
                <button
                  key={shelf.category.id}
                  type="button"
                  aria-pressed={selected === shelf.category.id}
                  onClick={(event) => {
                    onSelect(shelf.category.id);
                    event.currentTarget
                      .closest("details")
                      ?.removeAttribute("open");
                  }}
                >
                  {shelf.category.label}
                  {selected === shelf.category.id ? (
                    <HugeiconsIcon icon={Tick02Icon} aria-hidden />
                  ) : null}
                </button>
              ))}
            </div>
          </details>
        ) : null}
      </div>
      <div className="marketplace-chip-measure" aria-hidden>
        <button
          ref={allRef}
          type="button"
          className="marketplace-chip"
          tabIndex={-1}
        >
          All
        </button>
        {shelves.map((shelf, index) => (
          <button
            key={shelf.category.id}
            ref={(element) => {
              chipRefs.current[index] = element;
            }}
            type="button"
            className="marketplace-chip"
            tabIndex={-1}
          >
            {shelf.category.label}
          </button>
        ))}
        {shelves.map((_shelf, index) => {
          const hiddenCount = shelves.length - index;
          return (
            <button
              key={hiddenCount}
              ref={(element) => {
                overflowRefs.current[hiddenCount] = element;
              }}
              type="button"
              className="marketplace-chip"
              tabIndex={-1}
            >
              +{hiddenCount} more
              <HugeiconsIcon icon={ArrowDown01Icon} aria-hidden />
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function PublicMarketplacePage({
  manifest,
  stats,
  state,
  onStateChange,
}: {
  manifest: MarketplaceV2Manifest;
  stats: MarketplaceStats | null;
  state: MarketplaceIndexState;
  onStateChange: (state: MarketplaceIndexState) => void;
}) {
  const [query, setQuery] = useState("");
  const allShelves = marketplaceShelves(manifest.plugins);
  const hasInstallCounts = manifest.plugins.some(
    (entry) => marketplaceEntryInstalls(entry, stats) !== undefined,
  );
  const activeSort =
    state.sort === "most-installed" && !hasInstallCounts
      ? undefined
      : state.sort;
  const searched = filterMarketplaceEntries(manifest.plugins, query);
  const filtered =
    state.category === undefined
      ? searched
      : searched.filter((entry) => entry.category === state.category);
  const searchedShelves = marketplaceShelves(searched);
  const category =
    state.category === undefined
      ? undefined
      : marketplaceCategory(state.category);
  const showSearchResults = query.trim().length > 0;
  const sorted =
    activeSort === undefined
      ? filtered
      : sortMarketplaceEntries(filtered, activeSort, stats);

  return (
    <div className="wrap marketplace-wrap">
      <SiteNav current="marketplace" />
      <main className="marketplace-main">
        <header className="marketplace-hero">
          <p className="marketplace-eyebrow">BB Community</p>
          <h1>Plugin marketplace</h1>
          <p>
            Find trusted extensions for the way you work in bb. Browse publicly,
            then install in the app or from your terminal.
          </p>
        </header>

        <section aria-label="Browse plugins">
          <div className="marketplace-toolbar">
            <label className="marketplace-search">
              <HugeiconsIcon icon={Search01Icon} aria-hidden />
              <span className="marketplace-visually-hidden">
                Search plugins
              </span>
              <input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.currentTarget.value)}
                placeholder="Search plugins"
              />
              {query.length > 0 ? (
                <button
                  type="button"
                  aria-label="Clear search"
                  onClick={() => setQuery("")}
                >
                  <HugeiconsIcon icon={Cancel01Icon} aria-hidden />
                </button>
              ) : null}
            </label>
            <label className="marketplace-sort">
              <span className="marketplace-visually-hidden">Sort plugins</span>
              <select
                value={activeSort ?? ""}
                onChange={(event) => {
                  const value = event.currentTarget.value;
                  onStateChange({
                    category: state.category,
                    sort: isMarketplaceSort(value) ? value : undefined,
                  });
                }}
              >
                <option value="">Featured</option>
                <option value="recently-added">Recently added</option>
                {hasInstallCounts ? (
                  <option value="most-installed">Most installed</option>
                ) : null}
                <option value="name">Name</option>
              </select>
              <HugeiconsIcon icon={ArrowDown01Icon} aria-hidden />
            </label>
          </div>

          {activeSort === undefined && !showSearchResults ? null : (
            <CategoryChips
              shelves={allShelves}
              selected={state.category}
              onSelect={(nextCategory) =>
                onStateChange({ category: nextCategory, sort: activeSort })
              }
            />
          )}

          <div className="marketplace-results" aria-live="polite">
            {filtered.length === 0 ? (
              <div className="marketplace-empty">
                <HugeiconsIcon icon={PackageIcon} aria-hidden />
                <h2>No plugins found</h2>
                <p>Try a different search or category.</p>
              </div>
            ) : showSearchResults ? (
              <section className="marketplace-flat-section">
                <div className="marketplace-section-head">
                  <h2>
                    Search results <span>· {filtered.length}</span>
                  </h2>
                </div>
                <PluginGrid
                  entries={activeSort === undefined ? filtered : sorted}
                  stats={stats}
                  showCategory
                />
              </section>
            ) : activeSort !== undefined ? (
              <section className="marketplace-flat-section">
                <div className="marketplace-section-head">
                  <h2>
                    {SORT_LABELS[activeSort]}
                    {category === undefined ? null : ` in ${category.label}`}
                    <span>· {sorted.length}</span>
                  </h2>
                  <button
                    type="button"
                    className="marketplace-view-all"
                    onClick={() => onStateChange({ category: state.category })}
                  >
                    Clear sort
                    <HugeiconsIcon icon={Cancel01Icon} aria-hidden />
                  </button>
                </div>
                <PluginGrid
                  entries={sorted}
                  stats={stats}
                  showCategory={category === undefined}
                />
              </section>
            ) : category !== undefined ? (
              <section className="marketplace-flat-section">
                <Link to="/marketplace" className="marketplace-back-link">
                  ← Browse plugins
                </Link>
                <div className="marketplace-category-head">
                  <h2>
                    {category.label} <span>· {filtered.length}</span>
                  </h2>
                  <p>{category.description}</p>
                </div>
                <PluginGrid entries={filtered} stats={stats} />
              </section>
            ) : (
              <>
                <section className="marketplace-shelf marketplace-notable">
                  <div className="marketplace-section-head">
                    <h2>New &amp; notable</h2>
                  </div>
                  <PluginGrid
                    entries={newAndNotableEntries(manifest).slice(0, 3)}
                    stats={stats}
                  />
                </section>
                {searchedShelves.map((shelf) => (
                  <Shelf key={shelf.category.id} shelf={shelf} stats={stats} />
                ))}
              </>
            )}
          </div>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}

function InstallAction({ entry }: { entry: MarketplaceV2Entry }) {
  const [fallback, setFallback] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const command = fallback ?? marketplaceInstallCommand(entry.id);
  const install = () => {
    attemptMarketplaceInstall({
      entryId: entry.id,
      openDeepLink: (href) => {
        window.location.href = href;
      },
      revealFallback: setFallback,
    });
  };
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(command);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };
  return (
    <div className="marketplace-install">
      <button type="button" className="btn btn-primary" onClick={install}>
        Install in bb
      </button>
      {fallback === null ? (
        <p>Opens bb. A terminal command will appear here if you need it.</p>
      ) : (
        <div className="marketplace-install-fallback" role="status">
          <span>If bb didn&rsquo;t open, run:</span>
          <div>
            <code>{fallback}</code>
            <button
              type="button"
              onClick={() => void copy()}
              aria-label={`Copy ${fallback}`}
            >
              <HugeiconsIcon
                icon={copied ? Tick02Icon : Copy01Icon}
                aria-hidden
              />
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export function PublicMarketplaceDetailPage({
  manifest,
  entry,
  stats,
}: {
  manifest: MarketplaceV2Manifest;
  entry: MarketplaceV2Entry;
  stats: MarketplaceStats | null;
}) {
  const category = marketplaceCategory(entry.category);
  const installTotal = marketplaceEntryInstalls(entry, stats);
  const installs = formatInstalls(installTotal);
  const published = formatMarketplaceDate(entry.publishedAt);
  const updated = formatMarketplaceDate(entry.updatedAt);
  const repository = marketplaceRepositoryUrl(entry);
  const moreFromAuthor = manifest.plugins.filter(
    (candidate) =>
      candidate.id !== entry.id &&
      candidate.author.name.toLocaleLowerCase() ===
        entry.author.name.toLocaleLowerCase(),
  );
  return (
    <div className="wrap marketplace-wrap">
      <SiteNav current="marketplace" />
      <main className="marketplace-detail-main">
        <Link to="/marketplace" className="marketplace-back-link">
          ← Marketplace
        </Link>
        <div className="marketplace-detail-layout">
          <article className="marketplace-detail-copy">
            <header className="marketplace-detail-head">
              <PluginArtwork entry={entry} />
              <div>
                <p className="marketplace-eyebrow">{category.label}</p>
                <h1>{entry.displayName}</h1>
                <p>
                  By{" "}
                  {entry.author.github === undefined ? (
                    entry.author.name
                  ) : (
                    <a
                      href={`https://github.com/${entry.author.github}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {entry.author.name}
                      <HugeiconsIcon icon={GithubIcon} aria-hidden />
                    </a>
                  )}
                </p>
              </div>
            </header>
            <p className="marketplace-detail-description">
              {entry.description}
            </p>

            {entry.screenshots === undefined ||
            entry.screenshots.length === 0 ? null : (
              <section className="marketplace-detail-section">
                <h2>Screenshots</h2>
                <div className="marketplace-screenshots">
                  {entry.screenshots.map((screenshot, index) => (
                    <img
                      key={screenshot}
                      src={marketplaceAssetUrl(screenshot)}
                      alt={`${entry.displayName} screenshot ${index + 1}`}
                    />
                  ))}
                </div>
              </section>
            )}

            {moreFromAuthor.length === 0 ? null : (
              <section className="marketplace-detail-section">
                <h2>More from {entry.author.name}</h2>
                <PluginGrid
                  entries={moreFromAuthor}
                  stats={stats}
                  showCategory
                />
              </section>
            )}
          </article>

          <aside className="marketplace-detail-aside">
            <InstallAction entry={entry} />
            <dl>
              <div>
                <dt>Category</dt>
                <dd>{category.label}</dd>
              </div>
              {installs === null ? null : (
                <div>
                  <dt>Installs</dt>
                  <dd>{installTotal!.toLocaleString("en-US")}</dd>
                </div>
              )}
              {published === null ? null : (
                <div>
                  <dt>Published</dt>
                  <dd>{published}</dd>
                </div>
              )}
              {updated === null ? null : (
                <div>
                  <dt>Updated</dt>
                  <dd>{updated}</dd>
                </div>
              )}
            </dl>
            {repository === null ? null : (
              <a
                href={repository}
                target="_blank"
                rel="noreferrer"
                className="marketplace-repository-link"
              >
                <HugeiconsIcon icon={LinkSquare01Icon} aria-hidden />
                View source
              </a>
            )}
          </aside>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}

export function isMarketplaceCategoryId(
  value: unknown,
): value is MarketplaceCategoryId {
  return (
    typeof value === "string" &&
    MARKETPLACE_CATEGORIES.some((category) => category.id === value)
  );
}

export function isMarketplaceSort(value: unknown): value is MarketplaceSort {
  return (
    value === "recently-added" || value === "most-installed" || value === "name"
  );
}

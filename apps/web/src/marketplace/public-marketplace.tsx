import {
  AiContentGenerator01Icon,
  AlertCircleIcon,
  Archive03Icon,
  ArrowDown01Icon,
  Cancel01Icon,
  ChartColumnIcon,
  CheckListIcon,
  Clock01Icon,
  CloudIcon,
  ComputerTerminal01Icon,
  Copy01Icon,
  Download01Icon,
  File01Icon,
  Folder02Icon,
  FolderGitTwoIcon,
  GithubIcon,
  GitBranchIcon,
  Layers01Icon,
  LinkSquare01Icon,
  LockIcon,
  Mail02Icon,
  PackageIcon,
  PuzzleIcon,
  Search01Icon,
  SidebarLeftIcon,
  SlidersHorizontalIcon,
  Tick02Icon,
  WorkflowCircle03Icon,
  ZapIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react";
import { useEffect, useState } from "react";

import { initAnalytics } from "../landing/analytics.js";
import { SiteFooter, SiteNav } from "../landing/site-chrome.js";
import { copyPlainText } from "../lib/copy-plain-text.js";
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

const PLUGIN_ICONS: Readonly<Record<string, IconSvgElement | undefined>> = {
  AiContentGenerator01: AiContentGenerator01Icon,
  AlertCircle: AlertCircleIcon,
  Archive: Archive03Icon,
  ChartColumn: ChartColumnIcon,
  ClipboardCheck: CheckListIcon,
  Clock: Clock01Icon,
  Cloud: CloudIcon,
  Copy: Copy01Icon,
  FileText: File01Icon,
  FolderGit: FolderGitTwoIcon,
  FolderOpen: Folder02Icon,
  GitBranch: GitBranchIcon,
  Layers: Layers01Icon,
  Lock: LockIcon,
  Mail: Mail02Icon,
  PanelLeft: SidebarLeftIcon,
  Puzzle: PuzzleIcon,
  SlidersHorizontal: SlidersHorizontalIcon,
  Terminal: ComputerTerminal01Icon,
  Workflow: WorkflowCircle03Icon,
  Zap: ZapIcon,
};

export interface MarketplaceIndexState {
  category?: MarketplaceCategoryId;
  sort?: MarketplaceSort;
}

function PluginArtwork({
  entry,
  large = false,
}: {
  entry: MarketplaceV2Entry;
  large?: boolean;
}) {
  if (typeof entry.icon === "string") {
    return (
      <span
        className={
          large ? "marketplace-artwork is-large" : "marketplace-artwork"
        }
        aria-hidden
      >
        <HugeiconsIcon icon={PLUGIN_ICONS[entry.icon] ?? PuzzleIcon} />
      </span>
    );
  }
  return (
    <span
      className={large ? "marketplace-artwork is-large" : "marketplace-artwork"}
    >
      <img src={marketplaceAssetUrl(entry.icon.url)} alt="" />
    </span>
  );
}

function InstallCount({
  entry,
  stats,
}: {
  entry: MarketplaceV2Entry;
  stats: MarketplaceStats | null;
}) {
  const total = marketplaceEntryInstalls(entry, stats);
  if (total === undefined) return null;
  const formatted = formatInstalls(total) ?? total.toLocaleString("en-US");
  return (
    <span
      className="marketplace-card-installs"
      aria-label={`${total.toLocaleString("en-US")} installs`}
    >
      <HugeiconsIcon icon={Download01Icon} aria-hidden />
      {formatted}
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
      <a
        className="marketplace-card-link"
        href={`/marketplace/${encodeURIComponent(entry.id)}`}
      >
        <span className="marketplace-card-topline">
          <PluginArtwork entry={entry} />
          <strong>{entry.displayName}</strong>
        </span>
        <span className="marketplace-card-description">
          {entry.description}
        </span>
        <span className="marketplace-card-meta">
          <span className="marketplace-card-author">
            By {entry.author.name}
          </span>
          <span className="marketplace-card-secondary">
            {showCategory ? (
              <span className="marketplace-category-pill">
                {marketplaceCategory(entry.category).label}
              </span>
            ) : null}
            <InstallCount entry={entry} stats={stats} />
          </span>
        </span>
      </a>
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
  onSelect,
}: {
  shelf: MarketplaceShelf;
  stats: MarketplaceStats | null;
  onSelect: (category: MarketplaceCategoryId) => void;
}) {
  const href = `/marketplace?category=${encodeURIComponent(shelf.category.id)}`;
  return (
    <section className="marketplace-shelf">
      <div className="marketplace-section-head">
        <div>
          <h2>{shelf.category.label}</h2>
          <span>{shelf.entries.length} plugins</span>
        </div>
        <a
          href={href}
          onClick={(event) => {
            event.preventDefault();
            onSelect(shelf.category.id);
          }}
        >
          View all
        </a>
      </div>
      <PluginGrid entries={shelf.entries.slice(0, 3)} stats={stats} />
    </section>
  );
}

function MarketplaceState({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div className="marketplace-state" role="status">
      <span aria-hidden>
        <HugeiconsIcon icon={PackageIcon} />
      </span>
      <h2>{title}</h2>
      <p>{description}</p>
    </div>
  );
}

export function PublicMarketplaceUnavailablePage() {
  useEffect(() => {
    initAnalytics();
  }, []);
  return (
    <div className="wrap plugin-pages-wrap">
      <SiteNav current="plugins" />
      <main className="marketplace-main">
        <header className="plugin-page-head marketplace-page-head">
          <h1>Plugin Marketplace</h1>
          <p>Discover extensions that add new capabilities to bb.</p>
        </header>
        <MarketplaceState
          title="The Marketplace is temporarily unavailable"
          description="The catalog could not be loaded. Try again in a little while."
        />
        <aside className="marketplace-cross-link">
          <span>Want to build your own plugin?</span>
          <a href="/docs">Read the Plugin Guide</a>
        </aside>
      </main>
      <SiteFooter />
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
  useEffect(() => {
    initAnalytics();
  }, []);

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
  const category =
    state.category === undefined
      ? undefined
      : marketplaceCategory(state.category);
  const isFlat =
    query.trim().length > 0 ||
    activeSort !== undefined ||
    category !== undefined;
  const displayed =
    activeSort === undefined
      ? filtered
      : sortMarketplaceEntries(filtered, activeSort, stats);

  const changeState = (next: MarketplaceIndexState) => {
    onStateChange(next);
  };

  return (
    <div className="wrap plugin-pages-wrap">
      <SiteNav current="plugins" />
      <main className="marketplace-main">
        <header className="plugin-page-head marketplace-page-head">
          <h1>Plugin Marketplace</h1>
          <p>
            Discover extensions that add new capabilities to bb, built by bb and
            the community.
          </p>
        </header>

        {manifest.plugins.length === 0 ? (
          <MarketplaceState
            title="No plugins are published yet"
            description="The Marketplace is ready. Published plugins will appear here."
          />
        ) : (
          <section className="marketplace-browser" aria-label="Browse plugins">
            <div className="marketplace-toolbar">
              <label className="marketplace-search">
                <span className="marketplace-visually-hidden">
                  Search plugins
                </span>
                <HugeiconsIcon icon={Search01Icon} aria-hidden />
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

              <label className="marketplace-select">
                <span className="marketplace-visually-hidden">Category</span>
                <select
                  value={state.category ?? ""}
                  onChange={(event) => {
                    const value = event.currentTarget.value;
                    changeState({
                      category: isMarketplaceCategoryId(value)
                        ? value
                        : undefined,
                      sort: activeSort,
                    });
                  }}
                >
                  <option value="">All categories</option>
                  {allShelves.map((shelf) => (
                    <option key={shelf.category.id} value={shelf.category.id}>
                      {shelf.category.label}
                    </option>
                  ))}
                </select>
                <HugeiconsIcon icon={ArrowDown01Icon} aria-hidden />
              </label>

              <label className="marketplace-select">
                <span className="marketplace-visually-hidden">
                  Sort plugins
                </span>
                <select
                  value={activeSort ?? ""}
                  onChange={(event) => {
                    const value = event.currentTarget.value;
                    changeState({
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

            <div className="marketplace-results" aria-live="polite">
              {displayed.length === 0 ? (
                <MarketplaceState
                  title="No plugins found"
                  description="Try a different search or category."
                />
              ) : isFlat ? (
                <section className="marketplace-flat-results">
                  <div className="marketplace-section-head">
                    <div>
                      <h2>
                        {query.trim().length > 0
                          ? "Search results"
                          : activeSort === undefined
                            ? category?.label
                            : SORT_LABELS[activeSort]}
                      </h2>
                      <span>{displayed.length} plugins</span>
                    </div>
                    {category !== undefined ? (
                      <p>{category.description}</p>
                    ) : null}
                  </div>
                  <PluginGrid
                    entries={displayed}
                    stats={stats}
                    showCategory={category === undefined}
                  />
                </section>
              ) : (
                <>
                  <section className="marketplace-shelf marketplace-notable">
                    <div className="marketplace-section-head">
                      <div>
                        <h2>New &amp; notable</h2>
                        <span>Selected from the latest additions</span>
                      </div>
                    </div>
                    <PluginGrid
                      entries={newAndNotableEntries(manifest).slice(0, 3)}
                      stats={stats}
                      showCategory
                    />
                  </section>
                  {allShelves.map((shelf) => (
                    <Shelf
                      key={shelf.category.id}
                      shelf={shelf}
                      stats={stats}
                      onSelect={(nextCategory) =>
                        changeState({ category: nextCategory })
                      }
                    />
                  ))}
                </>
              )}
            </div>
          </section>
        )}

        <aside className="marketplace-cross-link">
          <span>Want to build your own plugin?</span>
          <a href="/docs">Read the Plugin Guide</a>
        </aside>
      </main>
      <SiteFooter />
    </div>
  );
}

function InstallCommand({ entry }: { entry: MarketplaceV2Entry }) {
  const [status, setStatus] = useState<CopyStatus>("idle");
  const command = marketplaceInstallCommand(entry.id);
  const copy = async () => {
    setStatus((await copyPlainText(command)) ? "copied" : "failed");
  };
  return (
    <div className="marketplace-install-command">
      <span>Install from your terminal</span>
      <div>
        <code>{command}</code>
        <button
          type="button"
          onClick={() => void copy()}
          aria-label={`Copy ${command}`}
        >
          <HugeiconsIcon
            icon={status === "copied" ? Tick02Icon : Copy01Icon}
            aria-hidden
          />
          {status === "copied"
            ? "Copied"
            : status === "failed"
              ? "Copy failed"
              : "Copy"}
        </button>
      </div>
    </div>
  );
}

type CopyStatus = "idle" | "copied" | "failed";

export function PublicMarketplaceDetailPage({
  manifest,
  entry,
  stats,
}: {
  manifest: MarketplaceV2Manifest;
  entry: MarketplaceV2Entry;
  stats: MarketplaceStats | null;
}) {
  useEffect(() => {
    initAnalytics();
  }, []);
  const category = marketplaceCategory(entry.category);
  const installs = marketplaceEntryInstalls(entry, stats);
  const published = formatMarketplaceDate(entry.publishedAt);
  const updated = formatMarketplaceDate(entry.updatedAt);
  const repository = marketplaceRepositoryUrl(entry);
  const moreFromAuthor = manifest.plugins.filter(
    (candidate) =>
      candidate.id !== entry.id &&
      candidate.author.name.toLocaleLowerCase() ===
        entry.author.name.toLocaleLowerCase(),
  );
  const authorUrl =
    entry.author.url ??
    (entry.author.github === undefined
      ? undefined
      : `https://github.com/${entry.author.github}`);

  return (
    <div className="wrap plugin-pages-wrap">
      <SiteNav current="plugins" />
      <main className="marketplace-detail-main">
        <a className="marketplace-back-link" href="/marketplace">
          Marketplace
        </a>
        <div className="marketplace-detail-layout">
          <article className="marketplace-detail-content">
            <header className="marketplace-detail-head">
              <PluginArtwork entry={entry} large />
              <div>
                <span className="marketplace-category-pill">
                  {category.label}
                </span>
                <h1>{entry.displayName}</h1>
                <p>
                  By{" "}
                  {authorUrl === undefined ? (
                    entry.author.name
                  ) : (
                    <a href={authorUrl} target="_blank" rel="noreferrer">
                      {entry.author.name}
                      {entry.author.github === undefined ? null : (
                        <HugeiconsIcon icon={GithubIcon} aria-hidden />
                      )}
                    </a>
                  )}
                </p>
              </div>
            </header>

            <p className="marketplace-detail-description">
              {entry.description}
            </p>

            {entry.screenshots?.length ? (
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
            ) : null}

            {moreFromAuthor.length > 0 ? (
              <section className="marketplace-detail-section">
                <h2>More from {entry.author.name}</h2>
                <PluginGrid
                  entries={moreFromAuthor}
                  stats={stats}
                  showCategory
                />
              </section>
            ) : null}
          </article>

          <aside className="marketplace-detail-aside">
            <InstallCommand entry={entry} />
            <dl>
              <div>
                <dt>Category</dt>
                <dd>{category.label}</dd>
              </div>
              {installs === undefined ? null : (
                <div>
                  <dt>Installs</dt>
                  <dd>{installs.toLocaleString("en-US")}</dd>
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
                className="marketplace-source-link"
                href={repository}
                target="_blank"
                rel="noreferrer"
              >
                <HugeiconsIcon icon={LinkSquare01Icon} aria-hidden />
                View source
              </a>
            )}
          </aside>
        </div>

        <aside className="marketplace-cross-link">
          <span>Building a plugin?</span>
          <a href="/docs">Read the Plugin Guide</a>
        </aside>
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

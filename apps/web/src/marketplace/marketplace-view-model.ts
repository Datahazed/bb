import type {
  MarketplaceCategoryId,
  MarketplaceV2Entry,
  MarketplaceV2Manifest,
} from "./marketplace-v2.js";

export type MarketplaceSort = "recently-added" | "most-installed" | "name";

export const MARKETPLACE_CATEGORIES: ReadonlyArray<{
  id: MarketplaceCategoryId;
  label: string;
  description: string;
}> = [
  {
    id: "themes-and-appearance",
    label: "Themes & Appearance",
    description: "Palettes, typography, and visual customization for bb.",
  },
  {
    id: "thread-lists-and-navigation",
    label: "Thread Lists & Navigation",
    description: "Organize thread lists and move through your work.",
  },
  {
    id: "thread-messages-and-timelines",
    label: "Thread Messages & Timelines",
    description: "Render and augment what appears inside a thread.",
  },
  {
    id: "composer-and-prompts",
    label: "Composer & Prompts",
    description: "Change what you type and how prompts are sent.",
  },
  {
    id: "memory-and-context",
    label: "Memory & Context",
    description: "Shape what agents know before they start.",
  },
  {
    id: "agent-tools",
    label: "Agent Tools",
    description: "Give agents new capabilities and focused helpers.",
  },
  {
    id: "security",
    label: "Security",
    description: "Protect credentials, code, and sensitive workflows.",
  },
  {
    id: "agents-and-providers",
    label: "Agents & Providers",
    description: "Add agents, providers, and session handoffs.",
  },
  {
    id: "token-usage-and-cost",
    label: "Token Usage & Cost",
    description: "Understand model spend, limits, and context budget.",
  },
  {
    id: "notifications-and-attention",
    label: "Notifications & Attention",
    description: "Know when work finishes or needs your attention.",
  },
  {
    id: "code-and-reviews",
    label: "Code & Reviews",
    description: "Work with repositories, pull requests, checks, and reviews.",
  },
  {
    id: "files-and-viewers",
    label: "Files & Viewers",
    description: "Open, preview, and edit files inside bb.",
  },
  {
    id: "machines-and-hosts",
    label: "Machines & Hosts",
    description: "Work with terminals, remote machines, and storage.",
  },
  {
    id: "plugin-development",
    label: "Plugin Development",
    description: "Inspect bb and build plugins against its public surfaces.",
  },
  {
    id: "task-tracking",
    label: "Task Tracking",
    description: "Track work with boards, lists, and checklists.",
  },
  {
    id: "automation",
    label: "Automation",
    description: "Run schedules, triggers, and agent pipelines.",
  },
];

const CATEGORY_BY_ID = new Map(
  MARKETPLACE_CATEGORIES.map((category) => [category.id, category]),
);
const CATEGORY_ORDER = new Map(
  MARKETPLACE_CATEGORIES.map((category, index) => [category.id, index]),
);

export interface MarketplaceShelf {
  category: (typeof MARKETPLACE_CATEGORIES)[number];
  entries: MarketplaceV2Entry[];
}

export function marketplaceCategory(
  id: MarketplaceCategoryId,
): (typeof MARKETPLACE_CATEGORIES)[number] {
  const category = CATEGORY_BY_ID.get(id);
  if (category === undefined) {
    throw new Error(`unknown marketplace category ${JSON.stringify(id)}`);
  }
  return category;
}

export function marketplaceShelves(
  entries: readonly MarketplaceV2Entry[],
): MarketplaceShelf[] {
  const shelves = new Map<MarketplaceCategoryId, MarketplaceV2Entry[]>();
  for (const entry of entries) {
    const group = shelves.get(entry.category);
    if (group === undefined) shelves.set(entry.category, [entry]);
    else group.push(entry);
  }

  return [...shelves.entries()]
    .map(([categoryId, categoryEntries]) => ({
      category: marketplaceCategory(categoryId),
      entries: [...categoryEntries].sort(compareNames),
    }))
    .sort(
      (left, right) =>
        right.entries.length - left.entries.length ||
        (CATEGORY_ORDER.get(left.category.id) ??
          MARKETPLACE_CATEGORIES.length) -
          (CATEGORY_ORDER.get(right.category.id) ??
            MARKETPLACE_CATEGORIES.length),
    );
}

export function newAndNotableEntries(
  manifest: MarketplaceV2Manifest,
): MarketplaceV2Entry[] {
  const entries = new Map(manifest.plugins.map((entry) => [entry.id, entry]));
  const curated = manifest.newAndNotable
    .map((id) => entries.get(id))
    .filter((entry) => entry !== undefined);
  if (curated.length > 0) return curated;
  return sortMarketplaceEntries(manifest.plugins, "recently-added").slice(0, 6);
}

export function filterMarketplaceEntries(
  entries: readonly MarketplaceV2Entry[],
  query: string,
): MarketplaceV2Entry[] {
  const normalized = query.trim().toLocaleLowerCase();
  if (normalized.length === 0) return [...entries];
  return entries.filter((entry) => {
    const category = marketplaceCategory(entry.category);
    return [
      entry.displayName,
      entry.description,
      entry.id,
      entry.category,
      entry.author.name,
      entry.author.github,
      category.label,
      ...(entry.tags ?? []),
    ]
      .filter((value) => value !== undefined)
      .some((value) => value.toLocaleLowerCase().includes(normalized));
  });
}

export function sortMarketplaceEntries(
  entries: readonly MarketplaceV2Entry[],
  sort: MarketplaceSort,
): MarketplaceV2Entry[] {
  return [...entries].sort((left, right) => {
    if (sort === "name") return compareNames(left, right);
    if (sort === "most-installed") {
      return (
        compareOptionalNumbersDescending(
          left.installCount,
          right.installCount,
        ) || compareNames(left, right)
      );
    }
    return (
      compareOptionalNumbersDescending(
        timestamp(left.publishedAt),
        timestamp(right.publishedAt),
      ) || compareNames(left, right)
    );
  });
}

function timestamp(value: string | undefined): number | undefined {
  return value === undefined ? undefined : Date.parse(value);
}

function compareOptionalNumbersDescending(
  left: number | undefined,
  right: number | undefined,
): number {
  if (left === undefined) return right === undefined ? 0 : 1;
  if (right === undefined) return -1;
  return right - left;
}

function compareNames(
  left: MarketplaceV2Entry,
  right: MarketplaceV2Entry,
): number {
  return (
    left.displayName.localeCompare(right.displayName) ||
    left.id.localeCompare(right.id)
  );
}

export function marketplaceDetailPath(entryId: string): string {
  return `/marketplace/${encodeURIComponent(entryId)}`;
}

export function marketplaceAssetUrl(declared: string): string {
  if (/^[A-Za-z][A-Za-z0-9+.-]*:/u.test(declared)) return declared;
  return new URL(declared, "https://getbb.app/marketplace/v2/marketplace.json")
    .pathname;
}

export function marketplaceInstallCommand(entryId: string): string {
  return `bb plugin install ${entryId}`;
}

export function marketplaceInstallDeepLink(entryId: string): string {
  return `bb://extensions/plugins/${encodeURIComponent(entryId)}?install=1`;
}

export function marketplaceRepositoryUrl(
  entry: MarketplaceV2Entry,
): string | null {
  if ("npm" in entry.source) {
    return entry.source.npm.registry === undefined
      ? `https://www.npmjs.com/package/${entry.source.npm.package}`
      : null;
  }
  return entry.source.git.url.replace(/\.git$/u, "");
}

/**
 * Keep the user-visible fallback deterministic and prove the deeplink is the
 * first attempted side effect. Callers inject the browser operations so the
 * sequencing is directly testable without launching another application.
 */
export function attemptMarketplaceInstall(args: {
  entryId: string;
  openDeepLink: (href: string) => void;
  revealFallback: (command: string) => void;
}): void {
  args.openDeepLink(marketplaceInstallDeepLink(args.entryId));
  args.revealFallback(marketplaceInstallCommand(args.entryId));
}

export function formatInstallCount(value: number | undefined): string | null {
  if (value === undefined) return null;
  return new Intl.NumberFormat("en-US", { notation: "compact" }).format(value);
}

export function formatMarketplaceDate(
  value: string | undefined,
): string | null {
  if (value === undefined) return null;
  return new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(value));
}

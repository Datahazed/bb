import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  Carousel,
  CarouselContent,
  CarouselItem,
  CarouselNext,
  CarouselPrevious,
  type CarouselApi,
} from "@bb/shared-ui/carousel";
import { Icon } from "@bb/shared-ui/icon";
import {
  ResourceBrowseCard,
  ResourceDefinitionSection,
  ResourceDetailOverviewSection,
  ResourceMeta,
} from "@bb/shared-ui/resource-list";
import { cn } from "@bb/shared-ui/lib/utils";
import type { PluginCatalogSearchEntry } from "@/hooks/queries/plugin-catalog-queries";
import { formatRelativeTime } from "@/lib/relative-time";
import { getPluginAuthorRoutePath } from "@/lib/route-paths";
import { CatalogEntryIconChip } from "./plugin-ui";
import {
  entriesByMarketplaceAuthor,
  pluginMarketplaceAuthorId,
} from "./plugin-marketplace-author";
import { pluginInstalls } from "./plugin-browse-discovery";

function repositoryLinkLabel(url: string): string {
  return url.replace(/^https?:\/\//u, "").replace(/\/+$/u, "");
}

export function PluginMarketplaceMetadata({
  entry,
}: {
  entry: PluginCatalogSearchEntry;
}) {
  const authorId = pluginMarketplaceAuthorId(entry);
  const author =
    entry.author === null || authorId === null
      ? null
      : { id: authorId, name: entry.author.name };
  const updatedRelativeTime =
    entry.updatedAt === undefined
      ? null
      : formatRelativeTime({
          timestamp: Date.parse(entry.updatedAt),
          now: Date.now(),
        });
  const installs = pluginInstalls(entry);
  // One metadata run, in the order a reader needs it: what kind of thing it
  // is, who made it, how many took it, when it last moved, where it lives.
  // ResourceMeta owns the separators — the previous hand-rolled version had to
  // re-test every preceding field to decide whether to print a dot, which is a
  // condition that grows with each field added.
  return (
    <ResourceMeta
      items={[
        entry.category,
        author === null ? null : (
          <span>
            By{" "}
            <Link
              to={getPluginAuthorRoutePath({ authorId: author.id })}
              className="rounded-sm underline underline-offset-2 hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            >
              {author.name}
            </Link>
          </span>
        ),
        installs === undefined
          ? null
          : `${installs.toLocaleString()} installs`,
        // The card no longer carries this, so the detail page is where a
        // reader finds out how current a listing is.
        updatedRelativeTime === null ? null : `updated ${updatedRelativeTime}`,
        entry.repositoryUrl === null ? null : (
          <a
            href={entry.repositoryUrl}
            target="_blank"
            rel="noreferrer"
            className="rounded-sm underline underline-offset-2 hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          >
            {repositoryLinkLabel(entry.repositoryUrl)}
            <Icon
              name="ExternalLink"
              className="ml-0.5 inline size-3"
              aria-hidden
            />
          </a>
        ),
      ]}
    />
  );
}

/**
 * The listing image contract, shared by the gallery and by the capture
 * guidance authors follow.
 *
 * Plugins do not occupy one shape. Roughly six in ten sit on a full page or
 * the whole window, but the sidebar rail is portrait and the composer, an
 * inline message row, and a footer gauge are all short and wide. Normalising
 * the ratio would letterbox four in ten listings, so the row normalises
 * *height* and lets each image keep its own width — a rail shot and a
 * full-page shot then read at the same scale, side by side.
 */
const PLUGIN_SCREENSHOT_ROW_HEIGHT = 420;
/**
 * Width ceiling, as a multiple of the row height. A true 4:1 composer strip
 * at full row height would be wider than the panel and could never be seen
 * whole, so anything past this scales down instead of overrunning.
 */
const PLUGIN_SCREENSHOT_MAX_ASPECT = 2;

function PluginScreenshotGallery({
  entry,
}: {
  entry: PluginCatalogSearchEntry;
}) {
  const [api, setApi] = useState<CarouselApi>();
  const [selectedIndex, setSelectedIndex] = useState(0);

  useEffect(() => {
    if (api === undefined) return;
    const updateSelection = () => setSelectedIndex(api.selectedScrollSnap());
    updateSelection();
    api.on("select", updateSelection);
    api.on("reInit", updateSelection);
    return () => {
      api.off("select", updateSelection);
      api.off("reInit", updateSelection);
    };
  }, [api]);

  if (entry.screenshots.length === 0) return null;
  return (
    <ResourceDefinitionSection label="Screenshots">
      {/* Each image sizes itself to the row height, so several narrow shots
          share a row while one wide shot fills it. The arrows live in a
          gutter beside the strip rather than on top of it — a control sitting
          over the artwork hides the thing the reader came to see. */}
      <Carousel
        setApi={setApi}
        opts={{ align: "start", containScroll: "trimSnaps" }}
        aria-label={`${entry.displayName} screenshots`}
        className={cn("w-full", entry.screenshots.length > 1 && "px-11")}
      >
        <CarouselContent
          className="-ml-3 items-center"
          style={{ minHeight: `${PLUGIN_SCREENSHOT_ROW_HEIGHT}px` }}
        >
          {entry.screenshots.map((screenshot, index) => (
            <CarouselItem key={screenshot} className="basis-auto pl-3">
              {/* Height and width are both ceilings, never fixed: an image
                  fills the row unless it is wider than the clamp, in which
                  case it gets shorter rather than growing letterbox bars. */}
              <img
                src={screenshot}
                alt={`${entry.displayName} screenshot ${index + 1}`}
                className="h-auto w-auto rounded-md border border-border object-contain"
                style={{
                  maxHeight: `${PLUGIN_SCREENSHOT_ROW_HEIGHT}px`,
                  maxWidth: `${PLUGIN_SCREENSHOT_ROW_HEIGHT * PLUGIN_SCREENSHOT_MAX_ASPECT}px`,
                }}
              />
            </CarouselItem>
          ))}
        </CarouselContent>
        {entry.screenshots.length > 1 ? (
          <>
            <CarouselPrevious className="-left-0 size-8" />
            <CarouselNext className="-right-0 size-8" />
          </>
        ) : null}
      </Carousel>
      {entry.screenshots.length > 1 ? (
        <div
          className="flex justify-center gap-1.5"
          aria-label={`Screenshot ${selectedIndex + 1} of ${entry.screenshots.length}`}
          role="status"
        >
          {entry.screenshots.map((screenshot, index) => (
            <span
              key={screenshot}
              aria-hidden
              className={cn(
                "h-1 rounded-full transition-[width,background-color]",
                index === selectedIndex
                  ? "w-4 bg-foreground/70"
                  : "w-2 bg-border",
              )}
            />
          ))}
        </div>
      ) : null}
    </ResourceDefinitionSection>
  );
}

/**
 * The last section on a plugin's page, wherever that page is composed.
 *
 * It points at other plugins, so anything about the one being read has to come
 * first — on an installed plugin that includes its configuration, release,
 * errors, services and schedules. Exported separately from the listing
 * sections so a page cannot accidentally sandwich it between two of its own.
 */
export function PluginMoreFromAuthorSection({
  entry,
  catalogEntries,
  onOpenPlugin,
}: {
  entry: PluginCatalogSearchEntry;
  catalogEntries: readonly PluginCatalogSearchEntry[];
  onOpenPlugin: (pluginId: string) => void;
}) {
  const authorId = pluginMarketplaceAuthorId(entry);
  const moreEntries = useMemo(
    () =>
      authorId === null
        ? []
        : entriesByMarketplaceAuthor(catalogEntries, authorId)
            .filter((candidate) => candidate.pluginId !== entry.pluginId)
            .sort((left, right) =>
              left.displayName.localeCompare(right.displayName),
            ),
    [authorId, catalogEntries, entry.pluginId],
  );
  if (entry.author === null || authorId === null || moreEntries.length === 0) {
    return null;
  }
  const authorName = entry.author.name;
  return (
    <ResourceDefinitionSection
      label="More from this author"
      actions={
        <Link
          to={getPluginAuthorRoutePath({ authorId })}
          className="rounded-sm text-xs text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        >
          View all
        </Link>
      }
    >
      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
        {moreEntries.slice(0, 3).map((candidate) => (
          <ResourceBrowseCard
            key={`${candidate.marketplace}/${candidate.entryId}`}
            className="min-h-24 gap-1.5 border-border bg-background p-2.5 shadow-none"
            leading={<CatalogEntryIconChip entry={candidate} />}
            title={candidate.displayName}
            description={candidate.description || undefined}
            byline={
              <Link
                to={getPluginAuthorRoutePath({ authorId })}
                className="pointer-events-auto relative rounded-sm hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              >
                By: {authorName}
              </Link>
            }
            openLabel={`Open ${candidate.displayName} details`}
            onOpen={() => onOpenPlugin(candidate.pluginId)}
          />
        ))}
      </div>
    </ResourceDefinitionSection>
  );
}

/**
 * What the listing says about *this* plugin: what it looks like, then what it
 * is. Deliberately excludes "More from this author", which is a way out of the
 * page rather than part of it — see {@link PluginMoreFromAuthorSection}.
 */
export function PluginMarketplaceListingSections({
  entry,
}: {
  entry: PluginCatalogSearchEntry;
}) {
  return (
    <>
      <PluginScreenshotGallery entry={entry} />
      {entry.description.length === 0 ? null : (
        <ResourceDetailOverviewSection label="About">
          <p className="max-w-none text-sm leading-relaxed text-muted-foreground">
            {entry.description}
          </p>
        </ResourceDetailOverviewSection>
      )}
    </>
  );
}

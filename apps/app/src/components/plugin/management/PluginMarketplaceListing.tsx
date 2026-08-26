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
} from "@bb/shared-ui/resource-list";
import { cn } from "@bb/shared-ui/lib/utils";
import type { PluginCatalogSearchEntry } from "@/hooks/queries/plugin-catalog-queries";
import { formatRelativeTime } from "@/lib/relative-time";
import { getPluginAuthorRoutePath } from "@/lib/route-paths";
import { CatalogEntryIcon } from "./plugin-ui";
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
  return (
    <span className="inline-flex min-w-0 flex-wrap items-center gap-x-1">
      {entry.category === undefined ? null : <span>{entry.category}</span>}
      {author === null ? null : (
        <>
          {entry.category === undefined ? null : <span aria-hidden>·</span>}
          <span>
            By{" "}
            <Link
              to={getPluginAuthorRoutePath({ authorId: author.id })}
              className="rounded-sm underline underline-offset-2 hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            >
              {author.name}
            </Link>
          </span>
        </>
      )}
      {installs === undefined ? null : (
        <>
          {entry.category === undefined && author === null ? null : (
            <span aria-hidden>·</span>
          )}
          <span>{installs.toLocaleString()} installs</span>
        </>
      )}
      {updatedRelativeTime === null ? null : (
        <>
          {entry.category === undefined &&
          author === null &&
          installs === undefined ? null : (
            <span aria-hidden>·</span>
          )}
          <span>updated {updatedRelativeTime}</span>
        </>
      )}
      {entry.repositoryUrl === null ? null : (
        <>
          {entry.category === undefined &&
          author === null &&
          installs === undefined &&
          updatedRelativeTime === null ? null : (
            <span aria-hidden>·</span>
          )}
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
        </>
      )}
    </span>
  );
}

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
      <Carousel
        setApi={setApi}
        opts={{ align: "start", containScroll: "trimSnaps" }}
        aria-label={`${entry.displayName} screenshots`}
        className="px-1"
      >
        <CarouselContent className="-ml-2">
          {entry.screenshots.map((screenshot, index) => (
            <CarouselItem
              key={screenshot}
              className="basis-[88%] pl-2 sm:basis-[72%]"
            >
              <div className="aspect-video overflow-hidden rounded-md border border-border bg-surface-recessed">
                <img
                  src={screenshot}
                  alt={`${entry.displayName} screenshot ${index + 1}`}
                  className="size-full object-contain"
                />
              </div>
            </CarouselItem>
          ))}
        </CarouselContent>
        {entry.screenshots.length > 1 ? (
          <>
            <CarouselPrevious className="left-2 size-7" />
            <CarouselNext className="right-2 size-7" />
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

function MoreFromAuthor({
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
      <div className="grid gap-2">
        {moreEntries.slice(0, 3).map((candidate) => (
          <ResourceBrowseCard
            key={`${candidate.marketplace}/${candidate.entryId}`}
            className="min-h-20 gap-1.5 p-2.5"
            leading={<CatalogEntryIcon entry={candidate} className="size-5" />}
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

export function PluginMarketplaceListingSections({
  entry,
  catalogEntries,
  onOpenPlugin,
}: {
  entry: PluginCatalogSearchEntry;
  catalogEntries: readonly PluginCatalogSearchEntry[];
  onOpenPlugin: (pluginId: string) => void;
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
      <MoreFromAuthor
        entry={entry}
        catalogEntries={catalogEntries}
        onOpenPlugin={onOpenPlugin}
      />
    </>
  );
}

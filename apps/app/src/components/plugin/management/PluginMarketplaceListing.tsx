import { useEffect, useMemo, useState, type ReactNode } from "react";
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
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@bb/shared-ui/tooltip";
import {
  ResourceBrowseCard,
  ResourceDefinitionSection,
  ResourceShelfAction,
} from "@bb/shared-ui/resource-list";
import { cn } from "@bb/shared-ui/lib/utils";
import {
  getWrappedImageIndex,
  ImageLightbox,
} from "@/components/ui/image-lightbox";
import type { PluginCatalogSearchEntry } from "@/hooks/queries/plugin-catalog-queries";
import { formatRelativeTime } from "@/lib/relative-time";
import {
  CatalogEntryIconChip,
  formatAbsoluteDate,
  PluginCategoryLabel,
} from "./plugin-ui";
import {
  entriesByMarketplaceAuthor,
  pluginMarketplaceAuthorId,
} from "./plugin-marketplace-author";
import { PluginAuthorLink } from "./PluginAuthorLink";
import { PluginAuthorAvatar } from "./PluginAuthorAvatar";

function repositoryLinkLabel(url: string): string {
  return url.replace(/^https?:\/\//u, "").replace(/\/+$/u, "");
}

export function PluginMarketplaceHeaderMetadata({
  entry,
}: {
  entry: PluginCatalogSearchEntry;
}) {
  const authorId = pluginMarketplaceAuthorId(entry);
  if (entry.author === null || authorId === null) return null;
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5">
      <PluginAuthorAvatar
        name={entry.author.name}
        github={entry.author.github}
        size="detail"
      />
      <PluginAuthorLink
        authorId={authorId}
        className="min-w-0 truncate rounded-sm underline underline-offset-2 hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
      >
        {entry.author.name}
      </PluginAuthorLink>
    </span>
  );
}

export function PluginMarketplaceCategoryPill({
  entry,
}: {
  entry: PluginCatalogSearchEntry;
}) {
  return entry.category === undefined ? null : (
    <PluginCategoryLabel categoryId={entry.categoryId} label={entry.category} />
  );
}

export function PluginDetailMetadataItem({
  label,
  children,
  className,
}: {
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("min-w-0 space-y-1", className)}>
      <dt className="text-2xs font-medium text-subtle-foreground">{label}</dt>
      <dd className="min-w-0 text-xs text-muted-foreground">{children}</dd>
    </div>
  );
}

export function PluginMarketplaceDetails({
  entry,
  children,
}: {
  entry: PluginCatalogSearchEntry;
  children?: ReactNode;
}) {
  const updatedAt = entry.updatedAt;
  const updatedTimestamp =
    updatedAt === undefined ? null : Date.parse(updatedAt);
  const updatedRelativeTime =
    updatedTimestamp === null
      ? null
      : formatRelativeTime({ timestamp: updatedTimestamp, now: Date.now() });
  const updatedAbsoluteTime =
    updatedTimestamp === null ? null : formatAbsoluteDate(updatedTimestamp);
  return (
    <ResourceDefinitionSection label="Details">
      <dl className="grid gap-x-6 gap-y-4 sm:grid-cols-2">
        {updatedAt === undefined ||
        updatedRelativeTime === null ||
        updatedAbsoluteTime === null ? null : (
          <PluginDetailMetadataItem label="Last updated">
            <TooltipProvider delayDuration={250}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <time
                    dateTime={updatedAt}
                    tabIndex={0}
                    aria-label={`Updated ${updatedAbsoluteTime}`}
                    className="rounded-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  >
                    {updatedRelativeTime}
                  </time>
                </TooltipTrigger>
                <TooltipContent>{updatedAbsoluteTime}</TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </PluginDetailMetadataItem>
        )}
        {children}
        <PluginDetailMetadataItem label="Marketplace">
          {entry.publisherLabel}
        </PluginDetailMetadataItem>
      </dl>
    </ResourceDefinitionSection>
  );
}

function PluginMarketplaceSource({
  entry,
}: {
  entry: PluginCatalogSearchEntry;
}) {
  if (entry.repositoryUrl === null) return null;
  const githubSource = isGitHubUrl(entry.repositoryUrl);
  return (
    <ResourceDefinitionSection label="Source">
      <a
        href={entry.repositoryUrl}
        target="_blank"
        rel="noreferrer"
        className="inline-flex max-w-full items-center gap-1.5 rounded-sm text-sm text-muted-foreground underline underline-offset-2 hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
      >
        {githubSource ? (
          <Icon
            name="GithubFilled"
            className="size-4.5 shrink-0 fill-current [&_*]:stroke-0"
            aria-hidden
          />
        ) : null}
        <span className="truncate">
          {repositoryLinkLabel(entry.repositoryUrl)}
        </span>
        <Icon name="ExternalLink" className="size-3.5 shrink-0" aria-hidden />
        <span className="sr-only">Opens in a new tab</span>
      </a>
    </ResourceDefinitionSection>
  );
}

function isGitHubUrl(url: string): boolean {
  try {
    const hostname = new URL(url).hostname.toLocaleLowerCase();
    return hostname === "github.com" || hostname === "www.github.com";
  } catch {
    return false;
  }
}

const PLUGIN_SCREENSHOT_ROW_HEIGHT = 420;
const PLUGIN_SCREENSHOT_MIN_ROW_HEIGHT = 176;

function PluginScreenshotGallery({
  entry,
}: {
  entry: PluginCatalogSearchEntry;
}) {
  const [api, setApi] = useState<CarouselApi>();
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);

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

  const showLightboxImage = (index: number) => {
    setLightboxIndex(index);
    api?.scrollTo(index);
  };

  const moveLightbox = (direction: "next" | "previous") => {
    if (lightboxIndex === null) return;
    showLightboxImage(
      getWrappedImageIndex({
        currentIndex: lightboxIndex,
        direction,
        itemCount: entry.screenshots.length,
      }),
    );
  };

  if (entry.screenshots.length === 0) return null;
  return (
    <>
      <Carousel
        setApi={setApi}
        opts={{ align: "start", containScroll: "trimSnaps" }}
        aria-label={`${entry.displayName} screenshots`}
        className={cn("w-full", entry.screenshots.length > 1 && "px-11")}
        style={{ containerType: "inline-size" }}
      >
        <CarouselContent className="-ml-3 items-center">
          {entry.screenshots.map((screenshot, index) => (
            <CarouselItem key={screenshot} className="pl-3">
              <button
                type="button"
                aria-label={`Open ${entry.displayName} screenshot ${index + 1} full size`}
                className="flex w-full cursor-zoom-in items-center justify-center rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                style={{
                  height: `clamp(${PLUGIN_SCREENSHOT_MIN_ROW_HEIGHT}px, 50cqw, ${PLUGIN_SCREENSHOT_ROW_HEIGHT}px)`,
                }}
                onClick={() => showLightboxImage(index)}
              >
                <img
                  src={screenshot}
                  alt={`${entry.displayName} screenshot ${index + 1}`}
                  className="h-auto w-auto max-h-full max-w-full rounded-md border border-border object-contain"
                />
              </button>
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
      <ImageLightbox
        imageSrc={
          lightboxIndex === null
            ? null
            : (entry.screenshots[lightboxIndex] ?? null)
        }
        imageAlt={
          lightboxIndex === null
            ? ""
            : `${entry.displayName} screenshot ${lightboxIndex + 1}`
        }
        title={
          lightboxIndex === null
            ? `${entry.displayName} screenshot`
            : `${entry.displayName} screenshot ${lightboxIndex + 1} of ${entry.screenshots.length}`
        }
        hasMultipleImages={entry.screenshots.length > 1}
        onPrevious={() => moveLightbox("previous")}
        onNext={() => moveLightbox("next")}
        onClose={() => setLightboxIndex(null)}
      />
    </>
  );
}

function PluginMarketplaceOverview({
  entry,
}: {
  entry: PluginCatalogSearchEntry;
}) {
  if (entry.screenshots.length === 0 && entry.description.length === 0) {
    return null;
  }
  return (
    <section
      className="space-y-6"
      data-resource-detail-section="overview"
      data-plugin-marketplace-overview
    >
      <PluginScreenshotGallery entry={entry} />
      {entry.description.length === 0 ? null : (
        <div className="space-y-3">
          <h2 className="text-sm font-medium text-foreground">About</h2>
          <p className="max-w-none text-sm leading-relaxed text-muted-foreground">
            {entry.description}
          </p>
        </div>
      )}
    </section>
  );
}

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
  return (
    <ResourceDefinitionSection
      label="More from this author"
      actions={
        <ResourceShelfAction
          asChild
          className="group gap-1 font-medium text-subtle-foreground"
        >
          <PluginAuthorLink authorId={authorId}>
            View all
            <Icon name="ChevronRight" className="size-3" aria-hidden />
          </PluginAuthorLink>
        </ResourceShelfAction>
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
              candidate.category === undefined ? undefined : (
                <PluginCategoryLabel
                  categoryId={candidate.categoryId}
                  label={candidate.category}
                />
              )
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
  sourceSection,
  beforeDetails,
  details,
}: {
  entry: PluginCatalogSearchEntry;
  sourceSection?: ReactNode;
  beforeDetails?: ReactNode;
  details?: ReactNode;
}) {
  return (
    <>
      <PluginMarketplaceOverview entry={entry} />
      {sourceSection === undefined ? (
        <PluginMarketplaceSource entry={entry} />
      ) : (
        sourceSection
      )}
      {beforeDetails}
      <PluginMarketplaceDetails entry={entry}>
        {details}
      </PluginMarketplaceDetails>
    </>
  );
}

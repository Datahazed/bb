/**
 * The whole product map: one annotated skeleton of the bb UI at a time, panned
 * through with the arrows, with a click on any numbered annotation opening its
 * card in the nearest gutter (or directly below the diagram when no gutter
 * fits).
 *
 * Slides are the surface groups, in order, so the data file decides both what
 * a slide contains and what number each marker gets. The last group has no
 * pixels to point at, so it renders as a conventional docs capability grid:
 * named sections of icon + title + description cards.
 *
 * Rendered identically by the docs site and by the bb plugin; inside bb the
 * plugin hands in the host's real composer, which replaces the mock one on
 * the slides that show a composer.
 */
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import type { IconSvgElement } from "@hugeicons/react";
import {
  ApiIcon,
  ArrowLeft01Icon,
  ArrowRight01Icon,
  Clock01Icon,
  ComputerIcon,
  DatabaseIcon,
  Layers01Icon,
  SourceCodeIcon,
  SparklesIcon,
  TerminalIcon,
  TestTubeIcon,
  ZapIcon,
} from "@hugeicons/core-free-icons";

import { cn } from "./cn";
import { GutterCard, useGutterCard } from "./gutter-card";
import {
  SURFACE_GROUPS,
  SURFACES_BY_ID,
  type PluginSurface,
  type SurfaceGroup,
} from "./surfaces";
import { ExperimentalBadge } from "./annotation";
import {
  AppShellWireframe,
  ComposerWireframe,
  ComposeScreenWireframe,
  RealComposerAnnotated,
  SettingsWireframe,
  SurfaceMapContext,
  useSurfaceMap,
} from "./wireframes";

/**
 * Marker numbers restart per slide, matching each skeleton's own markers.
 * "The platform" is absent on purpose: it has no skeleton, so a number there
 * would point at nothing.
 */
export const SURFACE_NUMBERS: ReadonlyMap<string, number> = new Map(
  SURFACE_GROUPS.filter((group) => group.id !== "headless").flatMap((group) =>
    group.surfaces.map((surface, index) => [surface.id, index + 1] as const),
  ),
);

/** Icons for the platform capability cards, one per pixel-less surface. */
const PLATFORM_SURFACE_ICONS: Record<string, IconSvgElement> = {
  cli: TerminalIcon,
  "agent-tools": SparklesIcon,
  background: Clock01Icon,
  wire: ApiIcon,
  storage: DatabaseIcon,
  "thread-events": ZapIcon,
  "host-workers": ComputerIcon,
  "bb-sdk": SourceCodeIcon,
  "host-components": Layers01Icon,
  testing: TestTubeIcon,
};

/**
 * One capability row in the platform grid: icon, title, one-line tagline.
 * The prose lives in the detail card a click opens, so the grid stays
 * scannable. Same anchor as a skeleton marker, same measurement path.
 */
function PlatformCard({ surface }: { surface: PluginSurface }) {
  const { activeId, setActiveId, expandedId, onSelect } = useSurfaceMap();
  const selected = activeId === surface.id || expandedId === surface.id;
  const icon = PLATFORM_SURFACE_ICONS[surface.id];
  return (
    <a
      href={`#surface-${surface.id}`}
      aria-label={`${surface.title} — jump to details`}
      onClick={
        onSelect
          ? (event) => {
              event.preventDefault();
              onSelect(surface.id);
            }
          : undefined
      }
      onMouseEnter={() => setActiveId(surface.id)}
      onMouseLeave={() => setActiveId(null)}
      className={cn(
        "flex h-full items-center gap-3 rounded-lg border px-3.5 py-2.5 transition-colors",
        selected
          ? "border-border bg-surface-selected"
          : "border-border-hairline hover:border-border hover:bg-state-hover",
      )}
    >
      {icon ? (
        <HugeiconsIcon
          icon={icon}
          className={cn(
            "size-4 shrink-0",
            selected ? "text-file-accent" : "text-foreground",
          )}
        />
      ) : null}
      <span className="min-w-0">
        <span className="flex items-center gap-2">
          <span className="min-w-0 truncate text-sm font-medium text-foreground">
            {surface.title}
          </span>
          {surface.experimental ? <ExperimentalBadge /> : null}
        </span>
        <span className="block truncate text-xs text-muted-foreground">
          {surface.tagline ?? surface.summary}
        </span>
      </span>
    </a>
  );
}

/**
 * The pixel-less slide: small section eyebrows chunking a two-column grid
 * of uniform one-line rows, so the ten capabilities scan in one pass.
 */
function PlatformSlide({ group }: { group: SurfaceGroup }) {
  return (
    <div className="space-y-6">
      {(group.sections ?? []).map((section) => {
        const surfaces = section.surfaceIds
          .map((id) => SURFACES_BY_ID.get(id))
          .filter((surface): surface is PluginSurface => Boolean(surface));
        return (
          <section key={section.title} aria-label={section.title}>
            <h3 className="text-2xs font-medium uppercase tracking-wide text-subtle-foreground">
              {section.title}
            </h3>
            <ul className="mt-2 grid gap-2 sm:grid-cols-2">
              {surfaces.map((surface) => (
                <li key={surface.id} className="min-w-0">
                  <PlatformCard surface={surface} />
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

function Slide({
  group,
  realComposer,
}: {
  group: SurfaceGroup;
  realComposer?: ReactNode;
  /**
   * Resolves a shipped plugin's page in the running bb, or null when this
   * host has no page for it. Only the in-app copy can answer that, so the
   * docs website omits it and the "Used by" names render as plain text.
   */
  pluginPageHref?: (displayName: string) => string | null;
}) {
  switch (group.id) {
    case "app-shell":
      return <AppShellWireframe />;
    case "composer":
      // Inside bb the diagram IS the real composer, annotated in place.
      return realComposer ? (
        <RealComposerAnnotated composer={realComposer} />
      ) : (
        <ComposerWireframe />
      );
    case "home":
      return <ComposeScreenWireframe composer={realComposer} />;
    case "settings":
      return <SettingsWireframe />;
    case "headless":
      return <PlatformSlide group={group} />;
  }
}

function PanButton({
  direction,
  disabled,
  onClick,
}: {
  direction: "previous" | "next";
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={`${direction === "previous" ? "Previous" : "Next"} surface`}
      // Borderless: the hit area, hover fill, and focus ring carry the
      // affordance, so the outline is chrome the row does not need.
      className="inline-flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-state-hover hover:text-foreground disabled:cursor-default disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-muted-foreground"
    >
      <HugeiconsIcon
        icon={direction === "previous" ? ArrowLeft01Icon : ArrowRight01Icon}
        className="size-3.5"
      />
    </button>
  );
}

/**
 * Keeps the stage exactly as tall as the slide on show, so a short skeleton
 * does not leave the tallest one's empty space below it.
 */
function useStageHeight(
  index: number,
  slideRefs: React.RefObject<Array<HTMLDivElement | null>>,
): number | null {
  const [height, setHeight] = useState<number | null>(null);
  useEffect(() => {
    const slide = slideRefs.current[index];
    if (!slide) {
      return;
    }
    const measure = () => setHeight(slide.getBoundingClientRect().height);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(slide);
    return () => observer.disconnect();
  }, [index, slideRefs]);
  return height;
}

export function ProductMap({
  header,
  realComposer,
  pluginPageHref,
  tone = "primary",
}: {
  /** Page copy above the diagrams; omitted inside compact plugin panels. */
  header?: ReactNode;
  /**
   * The host's real composer (experimental_NewThreadComposer), supplied by
   * the bb plugin. It replaces the mock composer in the skeletons, so the
   * diagram is the actual product. Surfaces with no bb behind them omit it
   * and get the mock.
   */
  realComposer?: ReactNode;
  /**
   * Resolves a shipped plugin's page in the running bb, or null when this
   * host has no page for it. Only the in-app copy can answer that, so the
   * docs website omits it and the "Used by" names render as plain text.
   */
  pluginPageHref?: (displayName: string) => string | null;
  /**
   * "supporting" steps the per-slide heading and blurb down a level, for
   * pages where the map explains the docs rather than leading them. Behavior,
   * markers, and card content are identical either way.
   */
  tone?: "primary" | "supporting";
}) {
  const slides = SURFACE_GROUPS;
  const containerRef = useRef<HTMLDivElement>(null);
  const slideRefs = useRef<Array<HTMLDivElement | null>>([]);
  const card = useGutterCard(containerRef);
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [index, setIndex] = useState(0);
  const stageHeight = useStageHeight(index, slideRefs);

  const openSurface = card.openId ? SURFACES_BY_ID.get(card.openId) : undefined;

  // Panning away from a card's marker would strand the card, so it closes.
  const show = (next: number) => {
    if (next < 0 || next >= slides.length) {
      return;
    }
    card.close();
    setHoverId(null);
    setIndex(next);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === "ArrowRight") {
      event.preventDefault();
      show(index + 1);
    } else if (event.key === "ArrowLeft") {
      event.preventDefault();
      show(index - 1);
    }
  };

  const mapState = useMemo(
    () => ({
      activeId: hoverId,
      setActiveId: setHoverId,
      // The open card is the selection, so its marker stays lit.
      expandedId: card.openId,
      numberOf: (id: string) => SURFACE_NUMBERS.get(id) ?? null,
      onSelect: card.open,
      pluginPageHref,
    }),
    // `card.open` is rebuilt each render by design: it reads live geometry.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [hoverId, card.openId, pluginPageHref],
  );

  const cardNode = openSurface ? (
    <GutterCard
      surface={openSurface}
      number={SURFACE_NUMBERS.get(openSurface.id) ?? null}
      placement={card.placement}
      onDismiss={card.close}
    />
  ) : null;
  // No gutter fits: the card renders in flow, directly below the diagram.
  const cardBelow = card.placement.side === "below";

  return (
    <SurfaceMapContext.Provider value={mapState}>
      <div ref={containerRef} className="relative">
        <div data-map-column className="mx-auto max-w-4xl">
          {header}

          <section
            aria-roledescription="carousel"
            aria-label="bb surfaces a plugin can extend"
            onKeyDown={onKeyDown}
            className="mt-8"
          >
            <div
              className="overflow-hidden transition-[height] duration-300 ease-out"
              style={stageHeight === null ? undefined : { height: stageHeight }}
            >
              <div
                className="flex transition-transform duration-300 ease-out"
                style={{ transform: `translateX(-${index * 100}%)` }}
              >
                {slides.map((entry, slideIndex) => (
                  <div
                    key={entry.id}
                    data-map-section={entry.id}
                    ref={(element) => {
                      slideRefs.current[slideIndex] = element;
                    }}
                    // Off-stage slides stay out of the tab order and out of
                    // the accessibility tree until they are panned to.
                    inert={slideIndex !== index}
                    // Markers sit slightly outside their region; the padding
                    // keeps them inside the stage's clip.
                    className="w-full shrink-0 self-start px-1 py-2"
                  >
                    <div className="mb-4">
                      {tone === "supporting" ? (
                        <h3 className="text-sm font-medium">{entry.title}</h3>
                      ) : (
                        <h2 className="text-base font-semibold">
                          {entry.title}
                        </h2>
                      )}
                      <p className="mt-1 max-w-2xl text-xs leading-relaxed text-subtle-foreground/75">
                        {entry.blurb}
                      </p>
                    </div>
                    <Slide group={entry} realComposer={realComposer} />
                  </div>
                ))}
              </div>
            </div>

            {/* The detail card, when no gutter can hold it: in flow, always
                directly below the diagram, never covering it. */}
            {cardBelow ? <div className="mt-4">{cardNode}</div> : null}

            {/* One navigation row: arrows flanking the named slides. */}
            <div className="mt-4 flex items-center justify-center gap-2">
              <PanButton
                direction="previous"
                disabled={index === 0}
                onClick={() => show(index - 1)}
              />
              <ul className="flex flex-wrap items-center justify-center gap-1">
                {slides.map((entry, slideIndex) => (
                  <li key={entry.id}>
                    <button
                      type="button"
                      onClick={() => show(slideIndex)}
                      aria-current={slideIndex === index ? "true" : undefined}
                      className={cn(
                        "cursor-pointer rounded-md px-2 py-1 text-2xs transition-colors",
                        slideIndex === index
                          ? "bg-surface-selected text-foreground"
                          : "text-subtle-foreground hover:bg-state-hover hover:text-foreground",
                      )}
                    >
                      {entry.title}
                    </button>
                  </li>
                ))}
              </ul>
              <PanButton
                direction="next"
                disabled={index === slides.length - 1}
                onClick={() => show(index + 1)}
              />
            </div>
          </section>
        </div>

        {cardBelow ? null : cardNode}
      </div>
    </SurfaceMapContext.Provider>
  );
}

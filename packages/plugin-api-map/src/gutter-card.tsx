/**
 * The product map's annotation card: click a numbered marker and its details
 * open in whichever page gutter is closer, hugging the diagram's edge so the
 * card stays beside the region it describes however wide the page gets.
 * When no gutter can hold it — narrow windows, in-app panels — the card
 * renders in flow directly below the diagram instead, so it is always
 * visible and never covers the region it describes.
 */
import { useCallback, useContext, useEffect, useRef, useState } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { Cancel01Icon } from "@hugeicons/core-free-icons";

import { cn } from "./cn";
import { type PluginSurface } from "./surfaces";
import { annotationChipClass, ExperimentalBadge } from "./annotation";
import { pluginIcon } from "./plugin-icons";
import { SurfaceMapContext } from "./wireframes";

/** Width the card needs before a gutter can hold it. */
export const GUTTER_CARD_WIDTH = 264;
/** Breathing room between the card and the skeleton it annotates. */
export const GUTTER_CARD_MARGIN = 12;

export type CardPlacement =
  | {
      side: "left" | "right";
      /** Offsets from the positioning container's top-left corner, in px. */
      top: number;
      left: number;
      width: number;
    }
  | {
      /** No gutter fits: render in flow, directly below the diagram. */
      side: "below";
    };

/**
 * Places the card against the nearer gutter, tight to the diagram's edge.
 *
 * The card hugs the column rather than the container, so widening the page
 * (or collapsing the app's panels around an in-app map) opens up empty space
 * beyond the card instead of dragging it away from its marker.
 *
 * With no gutter wide enough — narrow viewports, in-app panels — it reports
 * "below" and the map renders the card in flow under the diagram.
 */
export function chooseCardPlacement({
  markerCenterX,
  markerTop,
  contentLeft,
  contentRight,
  containerWidth,
}: {
  /** Marker centre, relative to the positioning container. */
  markerCenterX: number;
  /** Marker top, relative to the positioning container. */
  markerTop: number;
  /** Left edge of the readable column, relative to the container. */
  contentLeft: number;
  /** Right edge of the readable column, relative to the container. */
  contentRight: number;
  containerWidth: number;
}): CardPlacement {
  const needed = GUTTER_CARD_WIDTH + GUTTER_CARD_MARGIN;
  const leftFits = contentLeft >= needed;
  const rightFits = containerWidth - contentRight >= needed;
  const nearerLeft =
    markerCenterX - contentLeft <= contentRight - markerCenterX;
  const top = Math.max(0, markerTop - 12);

  if (leftFits && (nearerLeft || !rightFits)) {
    return {
      side: "left",
      top,
      left: contentLeft - needed,
      width: GUTTER_CARD_WIDTH,
    };
  }
  if (rightFits) {
    return {
      side: "right",
      top,
      left: contentRight + GUTTER_CARD_MARGIN,
      width: GUTTER_CARD_WIDTH,
    };
  }
  return { side: "below" };
}

export function GutterCard({
  surface,
  number,
  placement,
  onDismiss,
}: {
  surface: PluginSurface;
  /** Marker number, so the card reads as the same annotation. */
  number: number | null;
  placement: CardPlacement;
  onDismiss: () => void;
}) {
  const cardRef = useRef<HTMLDivElement>(null);
  // Null outside a map (the reference sidebar renders cards standalone), and
  // without a resolver the names render as plain text rather than as links
  // that would dead-end on "Plugin not found".
  const pluginPageHref = useContext(SurfaceMapContext)?.pluginPageHref;

  // Escape closes; so does a click anywhere outside the card.
  //
  // Dismissal listens for `click`, not `pointerdown`. Closing on pointerdown
  // unmounts an in-flow card and reflows the page under the finger, so the
  // click that completes the same tap lands somewhere else: bottom-nav taps
  // were swallowed, and every second marker tap opened nothing. Waiting for
  // the click lets that tap reach its target first, then dismisses.
  //
  // Markers are the exception: their own handler opens the next card during
  // this very click, so dismissing after it would close what just opened.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onDismiss();
    };
    const onClick = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (cardRef.current?.contains(target ?? null)) return;
      if (target?.closest('a[href^="#surface-"]')) return;
      onDismiss();
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("click", onClick);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("click", onClick);
    };
  }, [onDismiss, surface.id]);

  // Below the diagram, the card can land past the fold on a short screen.
  // Gutter cards sit beside the marker you just clicked, so they need no help.
  const below = placement.side === "below";
  useEffect(() => {
    if (below) {
      cardRef.current?.scrollIntoView({ block: "nearest" });
    }
  }, [below, surface.id]);

  return (
    <div
      ref={cardRef}
      role="dialog"
      aria-label={surface.title}
      style={
        placement.side === "below"
          ? undefined
          : {
              top: placement.top,
              left: placement.left,
              width: placement.width,
            }
      }
      className={cn(
        "z-30 rounded-lg border border-border bg-popover p-3.5 shadow-lg",
        placement.side === "below" ? "w-full" : "absolute",
      )}
    >
      <div className="flex items-start gap-2">
        {number === null ? null : (
          <span aria-hidden className={annotationChipClass(true, "mt-0.5")}>
            {number}
          </span>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-medium text-foreground">
              {surface.title}
            </h3>
            {surface.experimental ? <ExperimentalBadge /> : null}
          </div>
        </div>
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Close"
          className="-mr-1 -mt-1 inline-flex size-6 shrink-0 cursor-pointer items-center justify-center rounded text-muted-foreground transition-colors hover:bg-state-hover hover:text-foreground"
        >
          <HugeiconsIcon icon={Cancel01Icon} className="size-3.5" />
        </button>
      </div>

      <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
        {surface.summary}
      </p>

      {surface.firstParty && surface.firstParty.length > 0 ? (
        // A footnote, not a second subject: the label recedes to an eyebrow
        // above the border so the surface copy stays the card's content.
        <div className="mt-3 flex items-baseline gap-x-2 border-t border-border-hairline pt-2.5">
          {/* Inline lead-in, not a stacked heading: the label shares the
              first baseline with the list, and the list keeps its own
              wrapping column so a long one reflows under itself. */}
          <p className="shrink-0 text-2xs text-subtle-foreground">Used by</p>
          <ul className="flex min-w-0 flex-1 flex-wrap gap-x-3 gap-y-1">
            {surface.firstParty.map((plugin) => {
              const icon = pluginIcon(plugin);
              const href = pluginPageHref?.(plugin) ?? null;
              const body = (
                <>
                  {icon ? (
                    <HugeiconsIcon
                      icon={icon}
                      className="size-3 shrink-0 text-subtle-foreground"
                    />
                  ) : null}
                  {plugin}
                </>
              );
              return (
                <li key={plugin}>
                  {href ? (
                    <a
                      href={href}
                      className="flex items-center gap-1 text-2xs text-muted-foreground underline decoration-border underline-offset-2 hover:text-foreground hover:decoration-foreground"
                    >
                      {body}
                    </a>
                  ) : (
                    <span className="flex items-center gap-1 text-2xs text-muted-foreground">
                      {body}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

/** Tracks which surface's card is open plus where it should sit. */
export function useGutterCard(
  containerRef: React.RefObject<HTMLElement | null>,
) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [placement, setPlacement] = useState<CardPlacement>({ side: "below" });

  const measure = useCallback(
    (id: string) => {
      const container = containerRef.current;
      const marker = container?.querySelector<HTMLElement>(
        `a[href="#surface-${id}"]`,
      );
      const content =
        container?.querySelector<HTMLElement>("[data-map-column]");
      if (!container || !marker || !content) {
        return;
      }
      const base = container.getBoundingClientRect();
      const markerRect = marker.getBoundingClientRect();
      const contentRect = content.getBoundingClientRect();
      setPlacement(
        chooseCardPlacement({
          markerCenterX: markerRect.left + markerRect.width / 2 - base.left,
          markerTop: markerRect.top - base.top,
          contentLeft: contentRect.left - base.left,
          contentRight: contentRect.right - base.left,
          containerWidth: base.width,
        }),
      );
    },
    [containerRef],
  );

  // An open card has to follow its marker when the space around the map
  // changes: a window resize, or an app panel collapsing beside an in-app map.
  useEffect(() => {
    const container = containerRef.current;
    if (!openId || !container) {
      return;
    }
    const update = () => measure(openId);
    const observer = new ResizeObserver(update);
    observer.observe(container);
    window.addEventListener("resize", update);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", update);
    };
  }, [openId, containerRef, measure]);

  const open = (id: string) => {
    measure(id);
    setOpenId(id);
  };

  return { openId, placement, open, close: () => setOpenId(null) };
}

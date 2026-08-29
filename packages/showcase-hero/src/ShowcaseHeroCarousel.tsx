import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { usePrefersReducedMotion } from "@bb/shared-ui/hooks/use-media-query";
import { Icon, type IconName } from "@bb/shared-ui/icon";
import { cn } from "@bb/shared-ui/lib/utils";
import { ShowcaseFrame } from "./ShowcaseFrame";
import type {
  ShowcaseArchetype,
  ShowcaseIconRenderer,
  ShowcaseScenes,
} from "./showcase-archetype";
import { accentInk, accentTint, neutral } from "./showcase-tokens";
import "./styles.css";

const SLIDE_MS = 5000;

const ORBIT_POSITIONS: readonly CSSProperties[] = [
  { top: "2%", left: 0 },
  { top: "38%", left: 0 },
  { top: "72%", left: 0 },
  { top: "14%", right: 0 },
  { top: "48%", right: 0 },
  { top: "82%", right: 0 },
];

export interface ShowcaseHeroCopy {
  ariaLabel: string;
  headlineLead: string;
  composingNoun: string;
  description: string;
  tablistLabel: string;
  frameTitlePrefix: string;
  frameBadge: string;
}

export interface ShowcaseHeroCarouselProps {
  archetypes: readonly ShowcaseArchetype[];
  scenes: ShowcaseScenes;
  copy: ShowcaseHeroCopy;
  rail?: readonly IconName[];
  initialIndex?: number;
  autoplay?: boolean;
  composerSlot?: ReactNode;
  renderIcon?: ShowcaseIconRenderer;
}

export function ShowcaseHeroCarousel({
  archetypes,
  scenes,
  copy,
  rail,
  initialIndex = 0,
  autoplay = true,
  composerSlot,
  renderIcon = (name, className) => <Icon name={name} className={className} />,
}: ShowcaseHeroCarouselProps) {
  const reducedMotion = usePrefersReducedMotion();
  const [activeIndex, setActiveIndex] = useState(initialIndex);
  const [interacting, setInteracting] = useState(false);
  const [documentHidden, setDocumentHidden] = useState(false);
  const tabsRef = useRef<HTMLDivElement>(null);

  const composing = composerSlot !== undefined && composerSlot !== null;
  const active = archetypes[activeIndex] ?? archetypes[0];
  const paused =
    !autoplay || reducedMotion || interacting || composing || documentHidden;

  useEffect(() => {
    if (typeof document === "undefined") return;
    const update = () => setDocumentHidden(document.hidden);
    update();
    document.addEventListener("visibilitychange", update);
    return () => document.removeEventListener("visibilitychange", update);
  }, []);

  useEffect(() => {
    if (paused) return;
    const timer = window.setTimeout(() => {
      setActiveIndex((current) => (current + 1) % archetypes.length);
    }, SLIDE_MS);
    return () => window.clearTimeout(timer);
  }, [activeIndex, archetypes.length, paused]);

  const focusTab = useCallback((index: number) => {
    const tabs =
      tabsRef.current?.querySelectorAll<HTMLButtonElement>("[role='tab']");
    tabs?.[index]?.focus();
  }, []);

  const handleTabKeyDown = (event: React.KeyboardEvent) => {
    const last = archetypes.length - 1;
    let next: number | null = null;
    if (event.key === "ArrowRight")
      next = activeIndex === last ? 0 : activeIndex + 1;
    else if (event.key === "ArrowLeft")
      next = activeIndex === 0 ? last : activeIndex - 1;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = last;
    if (next === null) return;
    event.preventDefault();
    setActiveIndex(next);
    focusTab(next);
  };

  if (active === undefined) return null;

  return (
    <section
      aria-roledescription="carousel"
      aria-label={copy.ariaLabel}
      className="flex flex-col items-center pb-4"
      onPointerEnter={() => setInteracting(true)}
      onPointerLeave={() => setInteracting(false)}
      onFocusCapture={() => setInteracting(true)}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          setInteracting(false);
        }
      }}
    >
      <h2 className="text-center text-2xl font-semibold tracking-tight text-foreground">
        {copy.headlineLead}{" "}
        <span
          key={composing ? "composing" : active.id}
          className={cn(
            "inline-block",
            !reducedMotion &&
              "animate-in fade-in slide-in-from-bottom-1 duration-500",
          )}
          style={{
            color: composing
              ? "var(--foreground)"
              : accentInk(active.accentToken, 72),
          }}
        >
          {composing ? copy.composingNoun : active.noun}
        </span>
      </h2>
      <p className="mt-1.5 max-w-prose text-center text-sm text-muted-foreground">
        {copy.description}
      </p>

      {}
      <div className="relative mt-5 grid w-full max-w-[58rem] grid-cols-1 grid-rows-1">
        <div
          className={cn(
            "relative [grid-area:1/1]",
            !reducedMotion &&
              "transition-[opacity,transform,filter] duration-300 ease-out",
            composing
              ? "pointer-events-none scale-[0.97] opacity-0 blur-[2px]"
              : "scale-100 opacity-100 blur-0",
          )}
          aria-hidden={composing}
        >
          {archetypes.map((archetype, index) => {
            const position = ORBIT_POSITIONS[index];
            if (position === undefined) return null;
            const isActive = index === activeIndex;
            return (
              <button
                key={archetype.id}
                type="button"
                tabIndex={-1}
                aria-hidden="true"
                onClick={() => setActiveIndex(index)}
                style={
                  {
                    ...position,
                    "--bb-hero-drift-duration": `${6 + index * 0.7}s`,
                    "--bb-hero-drift-delay": `${index * 0.45}s`,
                    background: isActive
                      ? accentTint(archetype.accentToken, 12)
                      : "var(--canvas)",
                    borderColor: isActive
                      ? accentTint(archetype.accentToken, 40)
                      : neutral(13),
                    color: isActive
                      ? accentInk(archetype.accentToken, 62)
                      : neutral(46),
                  } as CSSProperties
                }
                className={cn(
                  "bb-hero-chip absolute z-10 hidden max-w-[9rem] cursor-pointer items-center gap-1.5",
                  "rounded-lg border px-2 py-1.5 text-2xs font-medium shadow-sm lg:flex",
                  "transition-[opacity,transform,background-color,border-color] duration-500",
                  isActive ? "opacity-100" : "opacity-70 hover:opacity-100",
                )}
              >
                {renderIcon(archetype.icon, "size-3 shrink-0")}
                <span className="truncate">{archetype.title}</span>
              </button>
            );
          })}

          <ShowcaseFrame
            archetypes={archetypes}
            activeIndex={activeIndex}
            scenes={scenes}
            titlePrefix={copy.frameTitlePrefix}
            badge={copy.frameBadge}
            rail={rail}
            reducedMotion={reducedMotion}
            renderIcon={renderIcon}
            className="mx-auto h-[13rem] w-full max-w-[38rem] lg:w-[66%]"
          />
        </div>

        {composing ? (
          <div
            className={cn(
              "z-20 self-center [grid-area:1/1]",
              !reducedMotion &&
                "animate-in fade-in slide-in-from-bottom-2 duration-300",
            )}
          >
            <div className="mx-auto w-full max-w-[44rem]">{composerSlot}</div>
          </div>
        ) : null}
      </div>

      {!composing ? (
        <div className="mt-4 flex min-h-4 flex-col items-center gap-3">
          <div
            ref={tabsRef}
            role="tablist"
            aria-label={copy.tablistLabel}
            className="flex items-center gap-1.5"
            onKeyDown={handleTabKeyDown}
          >
            {archetypes.map((archetype, index) => {
              const isActive = index === activeIndex;
              return (
                <button
                  key={archetype.id}
                  role="tab"
                  type="button"
                  aria-selected={isActive}
                  aria-label={archetype.title}
                  tabIndex={isActive ? 0 : -1}
                  onClick={() => setActiveIndex(index)}
                  className={cn(
                    "group h-4 cursor-pointer rounded-full px-0 focus-visible:ring-1",
                    "focus-visible:ring-ring focus-visible:outline-none",
                  )}
                >
                  <span
                    className={cn(
                      "block h-1 overflow-hidden rounded-full transition-all duration-300",
                      isActive ? "w-10" : "w-4",
                    )}
                    style={{
                      background: isActive
                        ? accentTint(archetype.accentToken, 22)
                        : neutral(14),
                    }}
                  >
                    {isActive ? (
                      <span
                        key={`${archetype.id}-${activeIndex}`}
                        data-paused={paused}
                        className="bb-hero-progress-fill block h-full w-full"
                        style={
                          {
                            "--bb-hero-slide-duration": `${SLIDE_MS}ms`,
                            background: `var(${archetype.accentToken})`,
                          } as CSSProperties
                        }
                      />
                    ) : null}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      ) : null}
    </section>
  );
}

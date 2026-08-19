/**
 * Layout gallery for the product-map restructure. NOT linked from navigation:
 * three candidate layouts rendered with real content so they can be compared
 * side by side. Delete once a direction is chosen.
 */
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createFileRoute } from "@tanstack/react-router";
import { HugeiconsIcon } from "@hugeicons/react";
import { ArrowRight01Icon } from "@hugeicons/core-free-icons";

import { cn } from "@/lib/utils";
import appCss from "../styles.css?url";
import docsCss from "../docs-plugin-api/docs.css?url";
import {
  SURFACE_GROUPS,
  type PluginSurface,
  type SurfaceGroup,
} from "@bb/plugin-api-map";
import { annotationChipClass, ExperimentalBadge } from "../docs-plugin-api/ui";
import {
  AppShellWireframe,
  ComposerWireframe,
  ComposeScreenWireframe,
  SettingsWireframe,
  SurfaceMapContext,
} from "@bb/plugin-api-map";

type Option = "a" | "b" | "c" | "d" | "e";

export const Route = createFileRoute("/docs/plugin-api/layouts")({
  head: () => ({
    meta: [{ title: "Layout options — bb Plugin API" }],
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "stylesheet", href: docsCss },
    ],
  }),
  validateSearch: (search: Record<string, unknown>): { option: Option } => {
    const raw = search.option;
    const options = ["a", "b", "c", "d", "e"];
    return { option: (options.includes(raw as string) ? raw : "a") as Option };
  },
  component: LayoutGallery,
});

const VISUAL_GROUPS = SURFACE_GROUPS.filter((g) => g.id !== "headless");
const NUMBERS = new Map(
  SURFACE_GROUPS.flatMap((g) =>
    g.surfaces.map((s, i) => [s.id, i + 1] as const),
  ),
);

function skeletonFor(groupId: string): ReactNode {
  if (groupId === "app-shell") return <AppShellWireframe />;
  if (groupId === "composer") return <ComposerWireframe />;
  return (
    <div className="space-y-5">
      <ComposeScreenWireframe />
      <SettingsWireframe />
    </div>
  );
}

/* ── shared bits ────────────────────────────────────────────────────── */

function Chip({ id, active }: { id: string; active: boolean }) {
  return (
    <span aria-hidden className={annotationChipClass(active)}>
      {NUMBERS.get(id)}
    </span>
  );
}

function SurfaceCard({
  surface,
  active,
  onHover,
}: {
  surface: PluginSurface;
  active: boolean;
  onHover: (id: string | null) => void;
}) {
  return (
    <article
      onMouseEnter={() => onHover(surface.id)}
      onMouseLeave={() => onHover(null)}
      className={cn(
        "rounded-lg border px-3 py-2.5 transition-colors",
        active
          ? "border-surface-selected-border bg-surface-selected"
          : "border-border bg-card",
      )}
    >
      <div className="flex flex-wrap items-center gap-2">
        <Chip id={surface.id} active={active} />
        <h3 className="text-sm font-medium text-foreground">{surface.title}</h3>
        {surface.experimental ? <ExperimentalBadge /> : null}
      </div>
      <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
        {surface.summary}
      </p>
      <p className="mt-1.5">
        <span className="inline-flex items-center text-xs text-foreground underline decoration-border underline-offset-2">
          View API reference
          <HugeiconsIcon icon={ArrowRight01Icon} className="ml-0.5 size-2.5" />
        </span>
      </p>
      {surface.firstParty?.length ? (
        <ul className="mt-2 flex flex-wrap gap-1">
          {surface.firstParty.slice(0, 4).map((p) => (
            <li
              key={p}
              className="rounded border border-border bg-surface-recessed-solid px-1.5 py-0.5 text-2xs text-foreground"
            >
              {p}
            </li>
          ))}
        </ul>
      ) : null}
    </article>
  );
}

/** A plain, sticky nav rail (options A and B). */
function FlatRail({
  activeId,
  onHover,
}: {
  activeId: string | null;
  onHover: (id: string | null) => void;
}) {
  return (
    <aside className="sticky top-14 hidden h-[calc(100dvh-3.5rem)] w-64 shrink-0 overflow-y-auto border-r border-border-hairline py-6 pr-4 md:block">
      <p className="rounded-md bg-sidebar-accent px-2 py-1 text-sm font-medium">
        Product map
      </p>
      {SURFACE_GROUPS.map((group) => (
        <div key={group.id} className="mt-4">
          <p className="px-2 text-xs text-subtle-foreground/75">
            {group.title}
          </p>
          <ul className="mt-1 space-y-0.5">
            {group.surfaces.map((surface) => (
              <li key={surface.id}>
                <button
                  type="button"
                  onMouseEnter={() => onHover(surface.id)}
                  onMouseLeave={() => onHover(null)}
                  className={cn(
                    "flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-sm",
                    activeId === surface.id
                      ? "bg-surface-selected text-foreground"
                      : "text-muted-foreground hover:bg-state-hover",
                  )}
                >
                  {group.id === "headless" ? (
                    <span
                      aria-hidden
                      className="size-1.5 shrink-0 rounded-full bg-muted"
                    />
                  ) : (
                    <Chip id={surface.id} active={activeId === surface.id} />
                  )}
                  <span className="truncate">{surface.title}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </aside>
  );
}

function GalleryFrame({
  option,
  children,
}: {
  option: Option;
  children: ReactNode;
}) {
  const labels: Record<Option, string> = {
    a: "A · Stacked bands, sticky rail",
    b: "B · Skeleton-first, docked detail",
    c: "C · Aligned with connectors",
    d: "D · Map, then catalog (VS Code / Chrome / Slack)",
    e: "E · Sticky spotlight (Stripe-style scroll)",
  };
  return (
    <div className="min-h-dvh bg-background text-foreground">
      <header className="sticky top-0 z-40 border-b border-border-seam bg-background">
        <div className="mx-auto flex h-14 max-w-[1400px] items-center gap-3 px-4">
          <span className="text-sm font-semibold">Plugin API</span>
          <span className="text-subtle-foreground">/</span>
          <span className="text-sm text-muted-foreground">
            {labels[option]}
          </span>
          <nav className="ml-auto flex gap-1">
            {(["a", "b", "c", "d", "e"] as const).map((key) => (
              <a
                key={key}
                href={`/docs/plugin-api/layouts?option=${key}`}
                className={cn(
                  "flex size-7 items-center justify-center rounded-md text-xs font-medium uppercase",
                  key === option
                    ? "bg-foreground text-background"
                    : "border border-border text-muted-foreground hover:bg-state-hover",
                )}
              >
                {key}
              </a>
            ))}
          </nav>
        </div>
      </header>
      {children}
    </div>
  );
}

/* ── A · stacked bands ──────────────────────────────────────────────── */

function OptionA({
  activeId,
  onHover,
}: {
  activeId: string | null;
  onHover: (id: string | null) => void;
}) {
  return (
    <div className="mx-auto flex max-w-[1400px] px-4">
      <FlatRail activeId={activeId} onHover={onHover} />
      <main className="min-w-0 flex-1 py-8 md:pl-8">
        <h1 className="text-xl font-semibold">What can a bb plugin do?</h1>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
          Every numbered region is a surface your plugin can own.
        </p>
        {VISUAL_GROUPS.map((group) => (
          <section
            key={group.id}
            className="mt-10 border-t border-border-hairline pt-6"
          >
            <h2 className="text-base font-semibold">{group.title}</h2>
            <p className="mt-1 text-xs text-subtle-foreground/75">
              {group.blurb}
            </p>
            <div className="mt-4 grid gap-6 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
              <div className="min-w-0">{skeletonFor(group.id)}</div>
              <div className="min-w-0 space-y-2">
                {group.surfaces.map((surface) => (
                  <SurfaceCard
                    key={surface.id}
                    surface={surface}
                    active={activeId === surface.id}
                    onHover={onHover}
                  />
                ))}
              </div>
            </div>
          </section>
        ))}
      </main>
    </div>
  );
}

/* ── B · skeleton-first, docked detail ──────────────────────────────── */

function OptionB({
  activeId,
  selectedId,
  onHover,
  onSelect,
}: {
  activeId: string | null;
  selectedId: string | null;
  onHover: (id: string | null) => void;
  onSelect: (id: string) => void;
}) {
  const selected = SURFACE_GROUPS.flatMap((g) => g.surfaces).find(
    (s) => s.id === selectedId,
  );
  return (
    <div className="mx-auto flex max-w-[1400px] px-4">
      <FlatRail activeId={activeId} onHover={onHover} />
      <main className="min-w-0 flex-1 py-8 md:pl-8">
        <h1 className="text-xl font-semibold">What can a bb plugin do?</h1>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
          Click any numbered marker to read what it does.
        </p>
        <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
          <div className="min-w-0 space-y-10">
            {VISUAL_GROUPS.map((group) => (
              <section key={group.id}>
                <h2 className="text-base font-semibold">{group.title}</h2>
                <div className="mt-3">{skeletonFor(group.id)}</div>
              </section>
            ))}
          </div>
          <aside className="sticky top-20 hidden h-fit rounded-lg border border-border bg-card p-4 xl:block">
            {selected ? (
              <>
                <div className="flex flex-wrap items-center gap-2">
                  <Chip id={selected.id} active />
                  <h3 className="text-sm font-medium">{selected.title}</h3>
                  {selected.experimental ? <ExperimentalBadge /> : null}
                </div>
                <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                  {selected.summary}
                </p>
                <p className="mt-2.5">
                  <span className="inline-flex items-center text-xs text-foreground underline decoration-border underline-offset-2">
                    View API reference
                    <HugeiconsIcon
                      icon={ArrowRight01Icon}
                      className="ml-0.5 size-2.5"
                    />
                  </span>
                </p>
                {selected.firstParty?.length ? (
                  <div className="mt-3">
                    <p className="text-2xs font-medium text-muted-foreground">
                      Used by BB Official plugins
                    </p>
                    <ul className="mt-1.5 flex flex-wrap gap-1">
                      {selected.firstParty.map((p) => (
                        <li
                          key={p}
                          className="rounded border border-border bg-surface-recessed-solid px-1.5 py-0.5 text-2xs text-foreground"
                        >
                          {p}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </>
            ) : (
              <p className="text-xs text-subtle-foreground">
                Select a numbered marker on a diagram to see what a plugin can
                do there.
              </p>
            )}
          </aside>
        </div>
      </main>
      <span className="hidden" data-select-proxy onClick={() => onSelect("")} />
    </div>
  );
}

/* ── C · aligned with connectors ────────────────────────────────────── */

interface Line {
  id: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

function OptionC({
  activeId,
  onHover,
}: {
  activeId: string | null;
  onHover: (id: string | null) => void;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [lines, setLines] = useState<Line[]>([]);

  useLayoutEffect(() => {
    const measure = () => {
      const wrap = wrapRef.current;
      if (!wrap) return;
      const base = wrap.getBoundingClientRect();
      const next: Line[] = [];
      for (const group of VISUAL_GROUPS) {
        const from = wrap.querySelector(`[data-nav-group="${group.id}"]`);
        const to = wrap.querySelector(`[data-canvas-group="${group.id}"]`);
        if (!from || !to) continue;
        const f = from.getBoundingClientRect();
        const t = to.getBoundingClientRect();
        next.push({
          id: group.id,
          x1: f.right - base.left,
          y1: f.top + f.height / 2 - base.top,
          x2: t.left - base.left,
          y2: t.top + 10 - base.top,
        });
      }
      setLines(next);
    };
    measure();
    const observer = new ResizeObserver(measure);
    if (wrapRef.current) observer.observe(wrapRef.current);
    window.addEventListener("resize", measure);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, []);

  return (
    <div
      ref={wrapRef}
      className="relative mx-auto flex max-w-[1400px] gap-8 px-4 py-8"
    >
      <svg
        aria-hidden
        className="pointer-events-none absolute inset-0 z-0 size-full overflow-visible"
      >
        {lines.map((line) => (
          <path
            key={line.id}
            d={`M ${line.x1} ${line.y1} C ${line.x1 + 40} ${line.y1}, ${line.x2 - 40} ${line.y2}, ${line.x2} ${line.y2}`}
            className="fill-none stroke-border"
            strokeWidth={1}
            strokeDasharray="3 3"
          />
        ))}
      </svg>

      <div className="relative z-10 hidden w-64 shrink-0 md:block">
        <p className="rounded-md bg-sidebar-accent px-2 py-1 text-sm font-medium">
          Product map
        </p>
        {SURFACE_GROUPS.map((group) => (
          <div
            key={group.id}
            data-nav-group={group.id}
            className="mt-5 rounded-md bg-background"
          >
            <p className="px-2 text-xs text-subtle-foreground/75">
              {group.title}
            </p>
            <ul className="mt-1 space-y-0.5">
              {group.surfaces.map((surface) => (
                <li key={surface.id}>
                  <button
                    type="button"
                    onMouseEnter={() => onHover(surface.id)}
                    onMouseLeave={() => onHover(null)}
                    className={cn(
                      "flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-sm",
                      activeId === surface.id
                        ? "bg-surface-selected text-foreground"
                        : "text-muted-foreground hover:bg-state-hover",
                    )}
                  >
                    {group.id === "headless" ? (
                      <span
                        aria-hidden
                        className="size-1.5 shrink-0 rounded-full bg-muted"
                      />
                    ) : (
                      <Chip id={surface.id} active={activeId === surface.id} />
                    )}
                    <span className="truncate">{surface.title}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      <main className="relative z-10 min-w-0 flex-1">
        <h1 className="text-xl font-semibold">What can a bb plugin do?</h1>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
          Every numbered region is a surface your plugin can own.
        </p>
        {VISUAL_GROUPS.map((group) => (
          <section
            key={group.id}
            data-canvas-group={group.id}
            className="mt-10"
          >
            <h2 className="text-base font-semibold">{group.title}</h2>
            <div className="mt-3">{skeletonFor(group.id)}</div>
          </section>
        ))}
      </main>
    </div>
  );
}

/* ── D · map, then catalog ──────────────────────────────────────────── */

/** One catalog entry: prose left, the group skeleton spotlit on that surface. */
function CatalogEntry({
  surface,
  groupId,
  spotlight,
}: {
  surface: PluginSurface;
  groupId: string;
  spotlight: (id: string) => ReactNode;
}) {
  return (
    <section
      id={`surface-${surface.id}`}
      className="scroll-mt-20 border-t border-border-hairline pt-6"
    >
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Chip id={surface.id} active />
            <h3 className="text-base font-medium text-foreground">
              {surface.title}
            </h3>
            {surface.experimental ? <ExperimentalBadge /> : null}
          </div>
          <p className="mt-2 max-w-prose text-sm leading-relaxed text-muted-foreground">
            {surface.summary}
          </p>
          <p className="mt-2.5">
            <span className="inline-flex items-center text-xs text-foreground underline decoration-border underline-offset-2">
              View API reference
              <HugeiconsIcon
                icon={ArrowRight01Icon}
                className="ml-0.5 size-2.5"
              />
            </span>
          </p>
          {surface.firstParty?.length ? (
            <div className="mt-3">
              <p className="text-2xs font-medium text-muted-foreground">
                Used by BB Official plugins
              </p>
              <ul className="mt-1.5 flex flex-wrap gap-1">
                {surface.firstParty.map((p) => (
                  <li
                    key={p}
                    className="rounded border border-border bg-surface-recessed-solid px-1.5 py-0.5 text-2xs text-foreground"
                  >
                    {p}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
        <div className="min-w-0">{spotlight(surface.id)}</div>
      </div>
    </section>
  );
}

function OptionD({
  activeId,
  onHover,
  setSpotlight,
}: {
  activeId: string | null;
  onHover: (id: string | null) => void;
  setSpotlight: (id: string | null) => ReactNode;
}) {
  const group = VISUAL_GROUPS[0];
  return (
    <div className="mx-auto flex max-w-[1400px] px-4">
      <FlatRail activeId={activeId} onHover={onHover} />
      <main className="min-w-0 flex-1 py-8 md:pl-8">
        <h1 className="text-xl font-semibold">What can a bb plugin do?</h1>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
          The map below is the index. Every numbered region has a section under
          it.
        </p>
        <div className="mt-6">{setSpotlight(null)}</div>
        <h2 className="mt-12 text-base font-semibold">{group.title}</h2>
        <div className="mt-4 space-y-8">
          {group.surfaces.map((surface) => (
            <CatalogEntry
              key={surface.id}
              surface={surface}
              groupId={group.id}
              spotlight={setSpotlight}
            />
          ))}
        </div>
      </main>
    </div>
  );
}

/* ── E · sticky spotlight ───────────────────────────────────────────── */

function OptionE({
  activeId,
  onHover,
  spotlightId,
  setSpotlightId,
  renderSkeleton,
}: {
  activeId: string | null;
  onHover: (id: string | null) => void;
  spotlightId: string | null;
  setSpotlightId: (id: string | null) => void;
  renderSkeleton: () => ReactNode;
}) {
  const group = VISUAL_GROUPS[0];
  const stepRefs = useRef(new Map<string, HTMLElement>());

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort(
            (a, b) => a.boundingClientRect.top - b.boundingClientRect.top,
          )[0];
        if (visible) {
          setSpotlightId(visible.target.getAttribute("data-step") ?? null);
        }
      },
      { rootMargin: "-45% 0px -45% 0px" },
    );
    for (const element of stepRefs.current.values()) observer.observe(element);
    return () => observer.disconnect();
  }, [setSpotlightId]);

  return (
    <div className="mx-auto flex max-w-[1400px] px-4">
      <FlatRail activeId={activeId} onHover={onHover} />
      <main className="min-w-0 flex-1 py-8 md:pl-8">
        <h1 className="text-xl font-semibold">What can a bb plugin do?</h1>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
          Scroll the list; the diagram follows and lights up the region.
        </p>
        <h2 className="mt-8 text-base font-semibold">{group.title}</h2>
        <div className="mt-4 grid gap-8 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
          <div className="min-w-0">
            <div className="sticky top-20">{renderSkeleton()}</div>
          </div>
          <div className="min-w-0 space-y-4 pb-[40vh]">
            {group.surfaces.map((surface) => (
              <section
                key={surface.id}
                data-step={surface.id}
                ref={(element) => {
                  if (element) stepRefs.current.set(surface.id, element);
                }}
                className={cn(
                  "rounded-lg border px-4 py-3.5 transition-colors",
                  spotlightId === surface.id
                    ? "border-surface-selected-border bg-surface-selected"
                    : "border-border bg-card",
                )}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <Chip id={surface.id} active={spotlightId === surface.id} />
                  <h3 className="text-sm font-medium text-foreground">
                    {surface.title}
                  </h3>
                  {surface.experimental ? <ExperimentalBadge /> : null}
                </div>
                <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                  {surface.summary}
                </p>
                <p className="mt-2">
                  <span className="inline-flex items-center text-xs text-foreground underline decoration-border underline-offset-2">
                    View API reference
                    <HugeiconsIcon
                      icon={ArrowRight01Icon}
                      className="ml-0.5 size-2.5"
                    />
                  </span>
                </p>
                {surface.firstParty?.length ? (
                  <ul className="mt-2.5 flex flex-wrap gap-1">
                    {surface.firstParty.map((p) => (
                      <li
                        key={p}
                        className="rounded border border-border bg-surface-recessed-solid px-1.5 py-0.5 text-2xs text-foreground"
                      >
                        {p}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </section>
            ))}
          </div>
        </div>
      </main>
    </div>
  );
}

/* ── gallery ────────────────────────────────────────────────────────── */

function LayoutGallery() {
  const { option } = Route.useSearch();
  const [activeId, setActiveId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(
    "message-directives",
  );
  const [spotlightId, setSpotlightId] = useState<string | null>(null);

  const onSelect = useCallback((id: string) => {
    if (id) setSelectedId(id);
  }, []);

  const mapState = useMemo(
    () => ({
      activeId,
      setActiveId,
      expandedId: option === "b" ? selectedId : null,
      spotlightId: option === "e" ? spotlightId : null,
      numberOf: (id: string) => NUMBERS.get(id) ?? null,
      onSelect: option === "b" ? onSelect : undefined,
    }),
    [activeId, option, selectedId, spotlightId, onSelect],
  );

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [option]);

  return (
    <SurfaceMapContext.Provider value={mapState}>
      <GalleryFrame option={option}>
        {option === "a" ? (
          <OptionA activeId={activeId} onHover={setActiveId} />
        ) : option === "b" ? (
          <OptionB
            activeId={activeId}
            selectedId={selectedId}
            onHover={setActiveId}
            onSelect={onSelect}
          />
        ) : option === "c" ? (
          <OptionC activeId={activeId} onHover={setActiveId} />
        ) : option === "d" ? (
          <OptionD
            activeId={activeId}
            onHover={setActiveId}
            setSpotlight={(id) => (
              <SurfaceMapContext.Provider
                value={{
                  activeId: null,
                  setActiveId: () => {},
                  spotlightId: id,
                  numberOf: (key: string) => NUMBERS.get(key) ?? null,
                }}
              >
                {skeletonFor(VISUAL_GROUPS[0].id)}
              </SurfaceMapContext.Provider>
            )}
          />
        ) : (
          <OptionE
            activeId={activeId}
            onHover={setActiveId}
            spotlightId={spotlightId}
            setSpotlightId={setSpotlightId}
            renderSkeleton={() => skeletonFor(VISUAL_GROUPS[0].id)}
          />
        )}
      </GalleryFrame>
    </SurfaceMapContext.Provider>
  );
}

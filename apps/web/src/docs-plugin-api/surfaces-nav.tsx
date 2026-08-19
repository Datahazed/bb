/**
 * The reference sidebar. One group per product-map slide, numbered to match
 * that slide's markers, each row expanding in place to the same capability
 * summary and reference links its annotation card shows.
 */
import { useEffect, useRef } from "react";
import { Link, useLocation } from "@tanstack/react-router";
import { HugeiconsIcon } from "@hugeicons/react";
import { ArrowRight01Icon } from "@hugeicons/core-free-icons";

import { cn } from "@/lib/utils";
import {
  pluginIcon,
  SURFACE_GROUPS,
  SURFACE_NUMBERS,
  surfaceHref,
  type PluginSurface,
  type SurfaceGroup,
} from "@bb/plugin-api-map";
import { annotationChipClass, ExperimentalBadge } from "./ui";

export interface SurfacesNavState {
  activeId: string | null;
  setActiveId: (id: string | null) => void;
  expandedId: string | null;
  setExpandedId: (id: string | null) => void;
}

function SurfaceRow({
  surface,
  number,
  state,
}: {
  surface: PluginSurface;
  /** Marker number within the group; null for groups without a skeleton. */
  number: number | null;
  state: SurfacesNavState;
}) {
  const { activeId, setActiveId, expandedId, setExpandedId } = state;
  const active = activeId === surface.id;
  const expanded = expandedId === surface.id;
  const rowRef = useRef<HTMLLIElement>(null);

  // Expanding a row far down the list should not push its own detail out of
  // sight, so keep it in view inside the sidebar's scroll area.
  useEffect(() => {
    const row = rowRef.current;
    const scroller = row?.closest("aside");
    if (!expanded || !row || !scroller) {
      return;
    }
    if (scroller.scrollHeight > scroller.clientHeight) {
      row.scrollIntoView({ block: "nearest" });
    }
  }, [expanded]);

  return (
    <li ref={rowRef} id={`surface-${surface.id}`}>
      <button
        type="button"
        aria-expanded={expanded}
        onClick={() => setExpandedId(expanded ? null : surface.id)}
        onMouseEnter={() => setActiveId(surface.id)}
        onMouseLeave={() => setActiveId(null)}
        onFocus={() => setActiveId(surface.id)}
        onBlur={() => setActiveId(null)}
        className={cn(
          "flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1 text-left text-sm transition-colors",
          expanded
            ? "text-foreground"
            : "text-muted-foreground hover:text-foreground",
          active || expanded ? "bg-surface-selected" : "hover:bg-state-hover",
        )}
      >
        {number !== null ? (
          <span aria-hidden className={annotationChipClass(active || expanded)}>
            {number}
          </span>
        ) : (
          <span
            aria-hidden
            className={cn(
              "size-1.5 shrink-0 rounded-full",
              active || expanded ? "bg-foreground" : "bg-muted",
            )}
          />
        )}
        <span className="min-w-0 truncate">{surface.title}</span>
        {surface.experimental ? <ExperimentalBadge /> : null}
        <HugeiconsIcon
          icon={ArrowRight01Icon}
          className={cn(
            "ml-auto size-3 shrink-0 text-subtle-foreground transition-transform",
            expanded && "rotate-90",
          )}
        />
      </button>

      {expanded ? (
        <div className="mb-2 ml-4 space-y-3 border-l border-border-hairline py-2.5 pl-4 pr-1">
          {/* Description and drill-down are separate lines: the link is an
              action, not part of the sentence. Both gaps come from the
              spacing scale (space-y-2 inside, space-y-3 between blocks). */}
          <div className="space-y-2">
            <p className="text-xs leading-relaxed text-muted-foreground">
              {surface.summary}
            </p>
            <div className="flex flex-wrap gap-x-3 gap-y-1">
              {surface.links.map((link) => (
                <Link
                  key={`${link.sectionId}-${link.anchor ?? ""}`}
                  to={surfaceHref(link)}
                  className="inline-flex items-center whitespace-nowrap text-xs text-foreground underline decoration-border underline-offset-2 hover:decoration-foreground"
                >
                  {link.label}
                  <HugeiconsIcon
                    icon={ArrowRight01Icon}
                    className="ml-0.5 size-2.5"
                  />
                </Link>
              ))}
            </div>
          </div>
          {/* Shipped plugins are the most useful thing here: they are working
              code to read, so they get named chips rather than a dim,
              truncated sentence. */}
          {surface.firstParty && surface.firstParty.length > 0 ? (
            <div className="flex items-baseline gap-x-2">
              <p className="shrink-0 text-2xs text-subtle-foreground">
                Used by
              </p>
              <ul className="flex min-w-0 flex-1 flex-wrap gap-x-3 gap-y-1">
                {surface.firstParty.map((plugin) => {
                  const icon = pluginIcon(plugin);
                  return (
                    <li
                      key={plugin}
                      className="flex items-center gap-1 text-2xs text-muted-foreground"
                    >
                      {icon ? (
                        <HugeiconsIcon
                          icon={icon}
                          className="size-3 shrink-0 text-subtle-foreground"
                        />
                      ) : null}
                      {plugin}
                    </li>
                  );
                })}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}

function SurfaceNavGroup({
  group,
  state,
}: {
  group: SurfaceGroup;
  state: SurfacesNavState;
}) {
  return (
    <div>
      <p className="px-2 text-xs font-normal leading-5 text-subtle-foreground/75">
        {group.title}
      </p>
      <ul className="mt-1 space-y-0.5">
        {group.surfaces.map((surface) => (
          <SurfaceRow
            key={surface.id}
            surface={surface}
            // The map's own numbering, so a row and its marker always agree.
            number={SURFACE_NUMBERS.get(surface.id) ?? null}
            state={state}
          />
        ))}
      </ul>
    </div>
  );
}

export function SurfacesNav({
  state,
  onNavigate,
}: {
  state: SurfacesNavState;
  onNavigate?: () => void;
}) {
  const pathname = useLocation({
    select: (location) => location.pathname,
  }).replace(/\/$/, "");

  return (
    <nav aria-label="Plugin API" className="space-y-4">
      <ul className="space-y-0.5">
        {[{ to: "/docs/plugin-api", title: "Product map" }].map((link) => {
          const isActive = pathname === link.to;
          return (
            <li key={link.to}>
              <Link
                to={link.to}
                onClick={onNavigate}
                aria-current={isActive ? "page" : undefined}
                className={cn(
                  "block rounded-md px-2 py-1 text-sm transition-colors",
                  isActive
                    ? "bg-sidebar-accent font-medium text-sidebar-foreground"
                    : "text-muted-foreground hover:bg-state-hover hover:text-foreground",
                )}
              >
                {link.title}
              </Link>
            </li>
          );
        })}
      </ul>

      {/* One group per map slide, in the same order the map pans through. */}
      {SURFACE_GROUPS.map((group) => (
        <SurfaceNavGroup key={group.id} group={group} state={state} />
      ))}
    </nav>
  );
}

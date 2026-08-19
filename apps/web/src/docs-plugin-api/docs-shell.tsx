import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  ArrowLeft01Icon,
  Cancel01Icon,
  GithubIcon,
  Menu01Icon,
  Moon02Icon,
  Search01Icon,
  Sun01Icon,
} from "@hugeicons/core-free-icons";

import bbIcon from "../assets/bb-icon.png";
import { cn } from "@/lib/utils";
import { PLUGIN_API_MODEL } from "./api-model.generated";
import { searchDocs, type DocsSearchResult } from "./search";
import { ExperimentalBadge, KindBadge } from "./ui";

/* ── search ─────────────────────────────────────────────────────────── */

function HighlightedTitle({
  title,
  positions,
}: {
  title: string;
  positions: number[];
}) {
  if (positions.length === 0) {
    return <>{title}</>;
  }
  const set = new Set(positions);
  return (
    <>
      {[...title].map((char, index) =>
        set.has(index) ? (
          <mark
            key={index}
            className="bg-transparent font-bold text-foreground"
          >
            {char}
          </mark>
        ) : (
          <span key={index}>{char}</span>
        ),
      )}
    </>
  );
}

function DocsSearch() {
  const navigate = useNavigate();
  const listboxId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [results, setResults] = useState<DocsSearchResult[]>([]);

  // "/" or Cmd/Ctrl+K focuses search from anywhere on the page.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const inEditable =
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable);
      if (
        (event.key === "/" && !inEditable) ||
        (event.key.toLowerCase() === "k" && (event.metaKey || event.ctrlKey))
      ) {
        event.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  // Close when focus or pointer leaves the search region.
  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    window.addEventListener("pointerdown", onPointerDown);
    return () => window.removeEventListener("pointerdown", onPointerDown);
  }, []);

  const runQuery = useCallback((next: string) => {
    setQuery(next);
    const nextResults = searchDocs(next);
    setResults(nextResults);
    setActiveIndex(0);
    setOpen(next.trim().length > 0);
  }, []);

  const go = useCallback(
    (result: DocsSearchResult) => {
      setOpen(false);
      inputRef.current?.blur();
      void navigate({ to: result.entry.href });
    },
    [navigate],
  );

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setOpen(true);
      setActiveIndex((index) => Math.min(index + 1, results.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((index) => Math.max(index - 1, 0));
    } else if (event.key === "Enter") {
      const active = results[activeIndex];
      if (open && active) {
        event.preventDefault();
        go(active);
      }
    } else if (event.key === "Escape") {
      setOpen(false);
      inputRef.current?.blur();
    }
  };

  const showEmpty = open && query.trim().length > 0 && results.length === 0;

  return (
    <div ref={containerRef} className="relative w-full max-w-md">
      <HugeiconsIcon
        icon={Search01Icon}
        className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-subtle-foreground"
      />
      <input
        ref={inputRef}
        type="search"
        role="combobox"
        aria-expanded={open}
        aria-controls={listboxId}
        aria-activedescendant={
          open && results[activeIndex]
            ? `${listboxId}-${activeIndex}`
            : undefined
        }
        aria-label="Search the plugin API"
        placeholder="Search the plugin API…"
        value={query}
        onChange={(event) => runQuery(event.target.value)}
        onFocus={() => {
          if (query.trim()) setOpen(true);
        }}
        onKeyDown={onKeyDown}
        autoComplete="off"
        spellCheck={false}
        className="h-8 w-full rounded-md border border-input bg-background pl-8 pr-12 text-sm text-foreground placeholder:text-subtle-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring [&::-webkit-search-cancel-button]:hidden"
      />
      <kbd className="pointer-events-none absolute right-2.5 top-1/2 hidden -translate-y-1/2 rounded border border-border px-1 font-mono text-2xs text-subtle-foreground sm:block">
        /
      </kbd>

      {open ? (
        <div className="absolute left-0 right-0 top-full z-50 mt-1.5 overflow-hidden rounded-md border border-border bg-popover shadow-lg">
          {showEmpty ? (
            <div className="px-3 py-6 text-center">
              <p className="text-sm font-medium text-foreground">
                No matching APIs
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                Nothing matches “{query.trim()}”. Try a symbol name like{" "}
                <code className="font-mono">registerTool</code> or a topic like{" "}
                <code className="font-mono">composer</code>.
              </p>
            </div>
          ) : (
            <ul
              id={listboxId}
              role="listbox"
              aria-label="Search results"
              className="max-h-96 overflow-y-auto py-1"
            >
              {results.map((result, index) => (
                <li
                  key={result.entry.href}
                  id={`${listboxId}-${index}`}
                  role="option"
                  aria-selected={index === activeIndex}
                >
                  <button
                    type="button"
                    onClick={() => go(result)}
                    onMouseMove={() => setActiveIndex(index)}
                    className={cn(
                      "flex w-full cursor-pointer flex-col gap-0.5 px-3 py-2 text-left",
                      index === activeIndex && "bg-state-hover",
                    )}
                  >
                    <span className="flex flex-wrap items-center gap-2">
                      {result.entry.experimental ? <ExperimentalBadge /> : null}
                      <span
                        className={cn(
                          "text-sm text-foreground",
                          result.entry.kind === "symbol" && "font-mono text-xs",
                        )}
                      >
                        <HighlightedTitle
                          title={result.entry.title}
                          positions={result.titlePositions}
                        />
                      </span>
                      {result.entry.badge ? (
                        <KindBadge kind={result.entry.badge} />
                      ) : null}
                      <span className="ml-auto truncate font-mono text-2xs text-subtle-foreground">
                        {result.entry.subtitle}
                      </span>
                    </span>
                    {result.entry.summary ? (
                      <span className="line-clamp-1 text-xs text-muted-foreground">
                        {result.entry.summary}
                      </span>
                    ) : null}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}

/* ── theme toggle ───────────────────────────────────────────────────── */

function ThemeToggle() {
  const [isDark, setIsDark] = useState<boolean | null>(null);
  useEffect(() => {
    setIsDark(document.documentElement.classList.contains("dark"));
  }, []);

  const toggle = () => {
    const next = !document.documentElement.classList.contains("dark");
    document.documentElement.classList.toggle("dark", next);
    try {
      localStorage.setItem("bb.theme", next ? "dark" : "light");
    } catch {
      // Private mode: theme just won't persist.
    }
    setIsDark(next);
  };

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={isDark ? "Switch to light theme" : "Switch to dark theme"}
      className="inline-flex size-8 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-state-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
    >
      <HugeiconsIcon
        icon={isDark ? Sun01Icon : Moon02Icon}
        className="size-4"
      />
    </button>
  );
}

/* ── resizable sidebar ──────────────────────────────────────────────── */

export const SIDEBAR_MIN_WIDTH = 240;
export const SIDEBAR_MAX_WIDTH = 440;
/** Matches the real app sidebar's default (AppLayout.tsx). */
export const SIDEBAR_DEFAULT_WIDTH = 320;
const SIDEBAR_WIDTH_STORAGE_KEY = "bb.docs.navWidth";

function clampSidebarWidth(width: number): number {
  return Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, width));
}

function useSidebarWidth() {
  const [width, setWidth] = useState(SIDEBAR_DEFAULT_WIDTH);

  useEffect(() => {
    try {
      const stored = Number(localStorage.getItem(SIDEBAR_WIDTH_STORAGE_KEY));
      if (Number.isFinite(stored) && stored > 0) {
        setWidth(clampSidebarWidth(stored));
      }
    } catch {
      // Private mode: the default width is fine.
    }
  }, []);

  const persist = useCallback((next: number) => {
    try {
      localStorage.setItem(SIDEBAR_WIDTH_STORAGE_KEY, String(next));
    } catch {
      // Ignore.
    }
  }, []);

  return { width, setWidth, persist };
}

function SidebarResizeHandle({
  width,
  setWidth,
  persist,
}: {
  width: number;
  setWidth: (width: number) => void;
  persist: (width: number) => void;
}) {
  const latestWidth = useRef(width);
  latestWidth.current = width;

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize sidebar"
      aria-valuenow={Math.round(width)}
      aria-valuemin={SIDEBAR_MIN_WIDTH}
      aria-valuemax={SIDEBAR_MAX_WIDTH}
      tabIndex={0}
      onPointerDown={(event) => {
        event.preventDefault();
        const startX = event.clientX;
        const startWidth = latestWidth.current;
        // Window-level listeners so the drag keeps tracking when the pointer
        // leaves the 8px handle (pointer capture is unreliable here).
        const onMove = (moveEvent: PointerEvent) => {
          setWidth(clampSidebarWidth(startWidth + moveEvent.clientX - startX));
        };
        const onUp = () => {
          window.removeEventListener("pointermove", onMove);
          persist(latestWidth.current);
        };
        window.addEventListener("pointermove", onMove);
        window.addEventListener("pointerup", onUp, { once: true });
      }}
      onKeyDown={(event) => {
        const step =
          event.key === "ArrowLeft" ? -16 : event.key === "ArrowRight" ? 16 : 0;
        if (step !== 0) {
          event.preventDefault();
          const next = clampSidebarWidth(width + step);
          setWidth(next);
          persist(next);
        }
      }}
      className="group absolute -right-1 top-0 z-10 h-full w-2 cursor-col-resize touch-none focus-visible:outline-none"
    >
      <span
        aria-hidden
        className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-transparent transition-colors group-hover:bg-sidebar-border group-focus-visible:bg-ring group-active:bg-sidebar-border"
      />
    </div>
  );
}

/* ── shell ──────────────────────────────────────────────────────────── */

export function DocsShell({
  children,
  renderNav,
  stickyNav = true,
}: {
  children: ReactNode;
  /**
   * The unified sidebar nav, shared by the desktop rail and mobile drawer.
   * `onNavigate` closes the mobile drawer after a link click; `variant`
   * distinguishes the two so only the rail runs canvas-alignment.
   */
  renderNav?: (options: {
    variant: "rail" | "drawer";
    onNavigate?: () => void;
  }) => ReactNode;
  /**
   * False lets the rail scroll with the page, which is what canvas alignment
   * needs: a pinned rail cannot stay level with the content beside it.
   */
  stickyNav?: boolean;
}) {
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const { width, setWidth, persist } = useSidebarWidth();

  return (
    <div className="min-h-dvh bg-background text-foreground">
      <a
        href="#docs-content"
        className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-[60] focus:rounded-md focus:bg-background focus:px-3 focus:py-2 focus:text-sm focus:ring-1 focus:ring-ring"
      >
        Skip to content
      </a>

      <header className="sticky top-0 z-40 border-b border-border-seam bg-background">
        <div className="mx-auto flex h-14 max-w-7xl items-center gap-3 px-4">
          {renderNav ? (
            <button
              type="button"
              onClick={() => setMobileNavOpen((openState) => !openState)}
              aria-expanded={mobileNavOpen}
              aria-controls="docs-mobile-nav"
              aria-label={
                mobileNavOpen ? "Close sections menu" : "Open sections menu"
              }
              className="inline-flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground hover:bg-state-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring md:hidden"
            >
              <HugeiconsIcon
                icon={mobileNavOpen ? Cancel01Icon : Menu01Icon}
                className="size-4"
              />
            </button>
          ) : null}

          {/* The marketing site lives in a different stylesheet world, so
              leaving the docs is always a full page load. */}
          <a href="/" className="flex shrink-0 items-center gap-2">
            <img src={bbIcon} alt="" className="size-6 rounded-md" />
            <span className="text-sm font-semibold">bb</span>
          </a>
          <span aria-hidden className="text-subtle-foreground">
            /
          </span>
          <Link
            to="/docs/plugin-api"
            className="shrink-0 text-sm font-medium text-foreground hover:text-muted-foreground"
          >
            Plugin API
          </Link>
          {/* Reference pages always offer the way back to the diagram, not
              only when the reader arrived from an annotation. */}
          {renderNav ? (
            <Link
              to="/docs/plugin-api"
              className="ml-1 inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md border border-input px-2 text-xs font-medium text-foreground transition-colors hover:bg-state-hover"
            >
              <HugeiconsIcon icon={ArrowLeft01Icon} className="size-3.5" />
              Product map
            </Link>
          ) : null}
          <span className="hidden shrink-0 rounded-full border border-border px-2 py-px font-mono text-2xs text-subtle-foreground sm:block">
            SDK v{PLUGIN_API_MODEL.sdkVersion}
          </span>

          <div className="ml-auto flex min-w-0 flex-1 items-center justify-end gap-2">
            <DocsSearch />
            <a
              href="https://github.com/get-bb/bb"
              target="_blank"
              rel="noreferrer"
              aria-label="bb on GitHub"
              className="hidden size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-state-hover hover:text-foreground sm:inline-flex"
            >
              <HugeiconsIcon icon={GithubIcon} className="size-4" />
            </a>
            <ThemeToggle />
          </div>
        </div>

        {renderNav && mobileNavOpen ? (
          <div
            id="docs-mobile-nav"
            className="max-h-[70dvh] overflow-y-auto border-t border-border-hairline bg-background px-4 py-3 md:hidden"
          >
            {renderNav({
              variant: "drawer",
              onNavigate: () => setMobileNavOpen(false),
            })}
          </div>
        ) : null}
      </header>

      <div
        className={cn(
          "mx-auto flex px-4",
          // The map runs full-bleed: its annotation cards live in the gutters
          // beside the centred diagram column, which a 7xl cap would squeeze.
          renderNav ? "max-w-7xl" : "max-w-none",
        )}
      >
        {renderNav ? (
          <div className="relative hidden shrink-0 md:block" style={{ width }}>
            <aside
              className={cn(
                "border-r border-border-hairline py-6 pr-4",
                stickyNav
                  ? "sticky top-14 h-[calc(100dvh-3.5rem)] overflow-y-auto"
                  : "min-h-full",
              )}
            >
              {renderNav({ variant: "rail" })}
            </aside>
            <SidebarResizeHandle
              width={width}
              setWidth={setWidth}
              persist={persist}
            />
          </div>
        ) : null}
        <main
          id="docs-content"
          // The one seam between persistent chrome and routed content: this
          // is what the page transition animates (see styles.css). The
          // header, sidebar, and shell around it stay put.
          data-page-transition
          className={cn("min-w-0 flex-1 py-8", renderNav && "md:pl-8")}
        >
          {children}
        </main>
      </div>
    </div>
  );
}

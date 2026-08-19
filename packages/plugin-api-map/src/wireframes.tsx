/**
 * Miniature mockups of the real bb UI with every pluggable surface marked.
 * Layout and ordering mirror the real components in apps/app (audited against
 * AppSidebar, ThreadDetailHeader, ConversationMessageContent, MessageActionBar,
 * FollowUpPromptBox/PromptBoxInternal, ThreadSecondaryPanel, RootComposeView,
 * and PluginSettings); plugin contributions render highlighted, in the exact
 * spot the host inserts them.
 *
 * The regions covered by anatomy-manifest.json (sidebar sections, sidebar
 * footer, message action bar) render FROM the manifest, and a test in
 * apps/app renders the real components and asserts the same DOM order, so an
 * app-side reorder fails tests until the manifest, and these skeletons,
 * update.
 *
 * Marks are anchors that expand the matching sidebar row and sync hover state
 * through SurfaceMapContext. The exported *_MARKS arrays are the contract with
 * surfaces.ts: surfaces.test.ts asserts every surface in a visual group is
 * marked exactly once.
 */
import { createContext, Fragment, useContext, type ReactNode } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import type { IconSvgElement } from "@hugeicons/react";
import {
  ArrowLeft01Icon,
  ArrowUp01Icon,
  ArrowRight01Icon,
  Bug01Icon,
  Copy01Icon,
  File01Icon,
  Folder01Icon,
  GitBranchIcon,
  Maximize01Icon,
  Mic01Icon,
  MoreHorizontalIcon,
  PencilEdit01Icon,
  PlusSignIcon,
  ElectricPlugsIcon,
  Search01Icon,
  Settings02Icon,
  SparklesIcon,
  SidebarLeft01Icon,
  SidebarLeftIcon,
  ToolboxIcon,
  TerminalIcon,
} from "@hugeicons/core-free-icons";

import { cn } from "./cn";
import { annotationChipClass } from "./annotation";
import anatomy from "./anatomy-manifest.json";

export interface SurfaceMapState {
  activeId: string | null;
  setActiveId: (id: string | null) => void;
  /**
   * The surface whose sidebar row is open. Markers use it alongside
   * `activeId` so a marker and its row are never in different states.
   */
  expandedId?: string | null;
  /**
   * When set, only this surface's marker stays lit; every other region of the
   * skeleton recedes. Lets one diagram serve as a per-surface illustration
   * instead of shipping a cropped image per surface.
   */
  spotlightId?: string | null;
  numberOf: (id: string) => number | null;
  /**
   * Resolves a shipped plugin's page URL, or null when this host has no page
   * for it. Supplied by the bb plugin, which can ask the running host; the
   * docs website has no host and so supplies nothing.
   */
  pluginPageHref?: (displayName: string) => string | null;
  /**
   * When provided, clicking a marker calls this instead of following the
   * `#surface-<id>` anchor — the sidebar-nav layout uses it to expand the
   * matching nav row in place.
   */
  onSelect?: (id: string) => void;
}

export const SurfaceMapContext = createContext<SurfaceMapState | null>(null);

export function useSurfaceMap(): SurfaceMapState {
  const state = useContext(SurfaceMapContext);
  if (!state) {
    throw new Error("useSurfaceMap must be used inside a SurfaceMapContext");
  }
  return state;
}

export const APP_SHELL_MARKS = [
  "nav-panel",
  "thread-list",
  "sidebar-footer",
  "thread-header",
  "message-directives",
  "message-actions",
  "pending-interaction",
  "thread-panel",
  "file-opener",
  "content-scripts",
] as const;

export const COMPOSER_MARKS = [
  "composer-banners",
  "mention-provider",
  "composer-rich-text",
  "composer-plus-menu",
  "provider-picker",
  "composer-actions",
] as const;

export const COMPOSE_MARKS = ["homepage-section", "new-thread-panel"] as const;

export const SETTINGS_MARKS = [
  "plugin-status",
  "declarative-settings",
  "settings-section",
] as const;

/* ── primitives ─────────────────────────────────────────────────────── */

function Mark({
  id,
  label,
  className,
  chipClassName,
  children,
}: {
  id: string;
  label: string;
  className?: string;
  chipClassName?: string;
  children?: ReactNode;
}) {
  const { activeId, setActiveId, expandedId, spotlightId, numberOf, onSelect } =
    useSurfaceMap();
  const active = activeId === id || expandedId === id || spotlightId === id;
  const dimmed = Boolean(spotlightId) && spotlightId !== id;
  return (
    <a
      href={`#surface-${id}`}
      aria-label={`${label} — jump to details`}
      onClick={
        onSelect
          ? (event) => {
              event.preventDefault();
              onSelect(id);
            }
          : undefined
      }
      onMouseEnter={() => setActiveId(id)}
      onMouseLeave={() => setActiveId(null)}
      onFocus={() => setActiveId(id)}
      onBlur={() => setActiveId(null)}
      className={cn(
        "relative rounded-md ring-1 transition-all",
        active
          ? "bg-surface-selected ring-surface-selected-border"
          : "ring-transparent hover:bg-state-hover",
        dimmed && "opacity-25",
        className,
      )}
    >
      {/* Markers ship in the prominent ink fill so they read as the page's
          interactive layer; the selected one switches to the timeline file
          accent. The ring punches the chip out of the mockup's grey bones. */}
      <span
        aria-hidden
        className={annotationChipClass(
          active,
          // The ring is the only addition: it keeps the chip legible where it
          // overlaps the mockup's own grey bones.
          cn(
            "absolute z-10 ring-2 ring-card",
            chipClassName ?? "-right-2 -top-2",
          ),
        )}
      >
        {numberOf(id)}
      </span>
      {children}
    </a>
  );
}

function MiniIcon({
  icon,
  className,
}: {
  icon: IconSvgElement;
  className?: string;
}) {
  return (
    <HugeiconsIcon
      icon={icon}
      className={cn("size-3.5 shrink-0 text-muted-foreground", className)}
    />
  );
}

/** A plugin-contributed control: electric-plug glyph, drawn in the ink color. */
function PluginGlyph({ className }: { className?: string }) {
  return (
    <HugeiconsIcon
      icon={ElectricPlugsIcon}
      className={cn("size-3.5 shrink-0 text-foreground", className)}
    />
  );
}

function WindowFrame({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "select-none overflow-hidden rounded-lg border border-border bg-card text-xs leading-none text-muted-foreground shadow-sm",
        className,
      )}
    >
      {children}
    </div>
  );
}

function TrafficLights() {
  return (
    <span aria-hidden className="flex items-center gap-1.5">
      <span className="size-2 rounded-full bg-muted" />
      <span className="size-2 rounded-full bg-muted" />
      <span className="size-2 rounded-full bg-muted" />
    </span>
  );
}

/* ── the main app window ────────────────────────────────────────────── */

const SIDEBAR_THREADS: readonly { title: string; glyph?: "spin" | "dot" }[] = [
  { title: "Fix flaky checkout tests", glyph: "spin" },
  { title: "Refactor settings page" },
  { title: "Ship dark mode", glyph: "dot" },
];

/**
 * Sidebar footer icons, in anatomy-manifest order: Settings, then plugin
 * footer actions, then Report a bug (mirrors AppSidebar's SidebarFooter).
 */
const FOOTER_ITEM_RENDERERS: Record<string, () => ReactNode> = {
  settings: () => <MiniIcon icon={Settings02Icon} className="size-4" />,
  "plugin-footer-actions": () => (
    <span className="flex size-5.5 items-center justify-center rounded-md bg-state-hover">
      <PluginGlyph className="size-3" />
    </span>
  ),
  "bug-report": () => <MiniIcon icon={Bug01Icon} className="size-4" />,
};

/**
 * Sidebar sections, in anatomy-manifest order (mirrors AppSidebar.tsx:
 * top-reserve chrome, the New-thread/search block, plugin nav rows, the
 * scrolling thread list, the footer).
 */
const SIDEBAR_SECTION_RENDERERS: Record<string, () => ReactNode> = {
  "top-reserve": () => (
    <div className="flex items-center px-2.5 pt-2">
      <MiniIcon icon={SidebarLeftIcon} />
      <span className="flex-1" />
      <MiniIcon icon={ArrowLeft01Icon} className="size-3" />
      <MiniIcon icon={ArrowRight01Icon} className="ml-1.5 size-3" />
    </div>
  ),
  "primary-actions": () => (
    <div className="flex items-center gap-2 px-2.5 py-2.5">
      <span className="flex h-6.5 flex-1 items-center gap-2 rounded-md px-2 text-foreground">
        <MiniIcon icon={PlusSignIcon} className="text-foreground" />
        New thread
      </span>
      <MiniIcon icon={Search01Icon} />
    </div>
  ),
  "plugin-nav": () => (
    <Mark
      id="nav-panel"
      label="Plugin nav panels, above the thread list"
      className="mx-1.5 px-1.5 pb-2.5 pt-1"
      chipClassName="-top-1 right-0"
    >
      <span className="flex h-6.5 items-center gap-2 rounded-md px-2">
        <MiniIcon icon={ToolboxIcon} />
        Extensions
      </span>
      <span className="flex h-6.5 items-center gap-2 rounded-md bg-state-hover px-2 font-medium text-foreground">
        <PluginGlyph />
        Your panel
      </span>
    </Mark>
  ),
  "thread-list": () => (
    <Mark
      id="thread-list"
      label="The thread list, replaceable by one plugin"
      className="mx-1.5 flex-1 px-1.5 py-1.5"
      chipClassName="-top-1 right-0"
    >
      <span className="block px-2 pb-1 pt-1.5 text-2xs text-subtle-foreground/75">
        Pinned
      </span>
      {SIDEBAR_THREADS.map((thread) => (
        <span
          key={thread.title}
          className="flex h-6.5 items-center gap-2 rounded-md px-2"
        >
          <span className="min-w-0 flex-1 truncate">{thread.title}</span>
          {thread.glyph === "spin" ? (
            <span
              aria-hidden
              className="size-2.5 rounded-full border border-muted-foreground border-t-transparent"
            />
          ) : thread.glyph === "dot" ? (
            <span aria-hidden className="size-2 rounded-full bg-success" />
          ) : null}
        </span>
      ))}
      <span className="block px-2 pb-1 pt-2 text-2xs text-subtle-foreground/75">
        Projects
      </span>
      {["acme-app", "dotfiles"].map((project) => (
        <span
          key={project}
          className="flex h-6.5 items-center gap-1.5 rounded-md px-2"
        >
          <span className="min-w-0 truncate">{project}</span>
          <MiniIcon icon={ArrowRight01Icon} className="size-2.5" />
        </span>
      ))}
    </Mark>
  ),
  footer: () => (
    <Mark
      id="sidebar-footer"
      label="Plugin footer buttons, between Settings and Report a bug"
      className="mx-1.5 mb-1.5 flex w-fit items-center gap-2 px-2.5 py-2"
      chipClassName="-right-2 -top-2"
    >
      {anatomy.sidebarFooter.map((key) => (
        <Fragment key={key}>{FOOTER_ITEM_RENDERERS[key]?.()}</Fragment>
      ))}
    </Mark>
  ),
};

/**
 * Message action bar icons, in anatomy-manifest order: the five host actions,
 * then plugin actions (mirrors MessageActionBar.tsx).
 */
const MESSAGE_ACTION_RENDERERS: Record<string, () => ReactNode> = {
  copy: () => <MiniIcon icon={Copy01Icon} className="size-3" />,
  edit: () => <MiniIcon icon={PencilEdit01Icon} className="size-3" />,
  "add-to-chat": () => <MiniIcon icon={PlusSignIcon} className="size-3" />,
  "send-to-main-thread": () => (
    <MiniIcon icon={ArrowLeft01Icon} className="size-3" />
  ),
  fork: () => <MiniIcon icon={GitBranchIcon} className="size-3" />,
  "plugin-actions": () => <PluginGlyph className="size-3" />,
};

/** Registry coverage, checked against the manifest by surfaces.test.ts. */
export const ANATOMY_RENDERER_KEYS = {
  appSidebar: Object.keys(SIDEBAR_SECTION_RENDERERS),
  sidebarFooter: Object.keys(FOOTER_ITEM_RENDERERS),
  messageActionBar: Object.keys(MESSAGE_ACTION_RENDERERS),
};

export function AppShellWireframe() {
  return (
    // Three fixed-ish columns need ~720px; small windows scroll the mockup
    // horizontally instead of losing the panel and its markers.
    <div className="overflow-x-auto">
      <div className="min-w-[720px]">
        <AppShellWireframeBody />
      </div>
    </div>
  );
}

function AppShellWireframeBody() {
  return (
    <WindowFrame>
      {/* Window chrome. Content scripts run across the whole window. */}
      <Mark
        id="content-scripts"
        label="App-wide plugin behavior, across the whole window"
        className="flex items-center gap-2 border-b border-border-hairline px-3 py-2.5"
        chipClassName="left-1/2 top-1.5 -translate-x-1/2"
      >
        <TrafficLights />
      </Mark>

      <div className="flex">
        {/* ── sidebar, sections in anatomy-manifest order ── */}
        <div className="flex w-[264px] shrink-0 flex-col border-r border-border-hairline bg-sidebar">
          {anatomy.appSidebar.map((key) => (
            <Fragment key={key}>{SIDEBAR_SECTION_RENDERERS[key]?.()}</Fragment>
          ))}
        </div>

        {/* ── thread view ── */}
        <div className="flex min-w-0 flex-1 flex-col">
          {/* header: title left; plugin action leads the right action row */}
          <div className="flex h-10 items-center gap-2 border-b border-border-hairline px-3">
            <span className="truncate text-foreground">
              Fix flaky checkout tests
            </span>
            <MiniIcon icon={MoreHorizontalIcon} className="size-3" />
            <span className="flex-1" />
            <Mark
              id="thread-header"
              label="Plugin thread-header control, left end of the action row"
              className="flex h-6.5 items-center gap-1 px-2"
              chipClassName="-top-2.5 left-1"
            >
              <PluginGlyph className="size-3" />
            </Mark>
            <MiniIcon icon={Folder01Icon} className="size-3" />
            <span className="flex h-5.5 items-center rounded-md border border-border px-1.5 text-2xs">
              Commit
            </span>
            <MiniIcon icon={SidebarLeft01Icon} className="size-3 rotate-180" />
            <MiniIcon icon={Maximize01Icon} className="size-3" />
          </div>

          {/* timeline */}
          <div className="flex-1 space-y-3 overflow-hidden px-3 py-2.5">
            {/* user message: right-aligned bubble */}
            <div className="flex justify-end">
              <span className="max-w-[70%] rounded-xl border border-border-seam bg-surface-recessed px-2.5 py-2 leading-snug text-foreground">
                Fix the flaky checkout tests
              </span>
            </div>

            {/* assistant message: plain prose + directive + action bar */}
            <div className="w-[88%] space-y-2">
              <p className="leading-relaxed">
                The retries cluster in two suites. Failure rate by suite:
              </p>
              <Mark
                id="message-directives"
                label="A plugin component rendered inline by a message directive"
                className="block w-3/5 px-2.5 py-2.5"
                chipClassName="-right-2 top-0"
              >
                <span className="flex items-end gap-1.5" aria-hidden>
                  <span className="h-4 w-3.5 rounded-sm bg-muted" />
                  <span className="h-8 w-3.5 rounded-sm bg-foreground/40" />
                  <span className="h-2.5 w-3.5 rounded-sm bg-muted" />
                  <span className="h-6 w-3.5 rounded-sm bg-muted" />
                  <span className="h-2 w-3.5 rounded-sm bg-muted" />
                </span>
                <span className="mt-1.5 flex items-center gap-1.5">
                  <PluginGlyph className="size-2.5" />
                  ::your-directive
                </span>
              </Mark>
              <p className="leading-relaxed">
                Fixed by isolating the Stripe mock per test.
              </p>
              {/* action bar, icons in anatomy-manifest order */}
              <Mark
                id="message-actions"
                label="Plugin message actions, after the host actions"
                className="inline-flex items-center gap-2 px-2 py-1.5"
              >
                {anatomy.messageActionBar.map((key) => (
                  <Fragment key={key}>
                    {MESSAGE_ACTION_RENDERERS[key]?.()}
                  </Fragment>
                ))}
              </Mark>
            </div>
          </div>

          {/* pending interaction: replaces the prompt box, not the timeline */}
          <div className="space-y-2 border-t border-border-hairline p-2.5">
            <Mark
              id="pending-interaction"
              label="A plugin ask-the-user form, shown in place of the composer"
              className="block border border-border bg-card p-3"
              chipClassName="-top-2 right-1.5"
            >
              <span className="flex items-center gap-1.5 text-foreground">
                <PluginGlyph className="size-3" />
                Pick a release channel
              </span>
              <span className="mt-2 flex gap-1.5" aria-hidden>
                <span className="h-5.5 flex-1 rounded-md border border-border" />
                <span className="flex h-5.5 items-center rounded-md border border-border px-2">
                  Cancel
                </span>
                <span className="flex h-5.5 items-center rounded-md bg-foreground px-2 text-background">
                  Submit
                </span>
              </span>
            </Mark>
            <span
              aria-hidden
              className="block h-8 rounded-md border border-border bg-muted/20"
            />
          </div>
        </div>

        {/* ── right panel (ThreadSecondaryPanel) ── */}
        <div className="flex w-[232px] shrink-0 flex-col border-l border-border-hairline">
          {/* toolbar: Info/Diff pins, then the tab strip, then new-tab */}
          <div className="flex h-10 items-center gap-1.5 border-b border-border-hairline px-2">
            <MiniIcon icon={File01Icon} className="size-3" />
            <MiniIcon icon={GitBranchIcon} className="size-3" />
            <span aria-hidden className="mx-0.5 h-4 w-px bg-border-hairline" />
            <span className="flex h-6 items-center gap-1 rounded-md border border-border px-1.5">
              <MiniIcon icon={TerminalIcon} className="size-2.5" />
              Terminal
            </span>
            <Mark
              id="thread-panel"
              label="A plugin tab in the thread side panel"
              className="flex h-6 items-center gap-1 whitespace-nowrap px-2"
              chipClassName="-top-2.5 -right-1"
            >
              <PluginGlyph className="size-2.5" />
              <span className="text-foreground">Your tab</span>
            </Mark>
            <span className="flex-1" />
            <MiniIcon icon={PlusSignIcon} className="size-3" />
          </div>
          {/* body: a file preview tab owned by a plugin file opener */}
          <Mark
            id="file-opener"
            label="A plugin file viewer, opened for a matching extension"
            className="m-2 flex-1 p-2.5"
            chipClassName="-top-1 right-0"
          >
            <span className="flex items-center gap-1.5 pb-2 text-foreground">
              <MiniIcon icon={File01Icon} className="size-3" />
              notes.md
              <PluginGlyph className="ml-auto size-3" />
            </span>
            <span aria-hidden className="block space-y-1.5">
              <span className="block h-2 w-5/6 rounded-sm bg-muted/60" />
              <span className="block h-2 w-2/3 rounded-sm bg-muted/60" />
              <span className="block h-2 w-3/4 rounded-sm bg-muted/60" />
              <span className="block h-2 w-1/2 rounded-sm bg-muted/60" />
            </span>
          </Mark>
        </div>
      </div>
    </WindowFrame>
  );
}

/* ── the composer, close up (FollowUpPromptBox order) ───────────────── */

export function ComposerWireframe() {
  return (
    <div className="mx-auto w-full max-w-xl select-none space-y-2.5 text-xs leading-none text-muted-foreground">
      {/* banners: plugin banners render first, above the card */}
      <Mark
        id="composer-banners"
        label="Plugin composer banners, above the prompt box"
        className="flex items-center gap-2 border border-border-hairline bg-surface-raised px-3 py-2.5"
      >
        <PluginGlyph className="size-3" />
        <span className="text-foreground">Your banner</span>
      </Mark>
      <div
        aria-hidden
        className="flex items-center gap-2 rounded-md border border-border-hairline px-2.5 py-2"
      >
        <MiniIcon icon={GitBranchIcon} className="size-3" />
        Uncommitted · 3 files
      </div>

      {/* mention menu: opens above the input in the follow-up composer */}
      <Mark
        id="mention-provider"
        label="Plugin mention results in the @ typeahead"
        className="relative z-10 -mb-1 ml-4 block w-56 rounded-md border border-border bg-popover p-2 shadow-md"
        chipClassName="-right-2 -top-2"
      >
        <span className="block px-1.5 pb-1 text-2xs text-subtle-foreground/75">
          Your plugin
        </span>
        <span className="flex h-6 items-center gap-1.5 rounded bg-state-hover px-1.5 text-foreground">
          <PluginGlyph className="size-2.5" />
          release-notes
        </span>
        <span className="flex h-6 items-center gap-1.5 px-1.5">
          <PluginGlyph className="size-2.5 opacity-60" />
          roadmap
        </span>
      </Mark>

      {/* the prompt card */}
      <div className="rounded-xl border border-border bg-card p-2.5 shadow-sm">
        <p className="px-1 pt-1 leading-relaxed">
          Summarize{" "}
          <span className="rounded-full border border-surface-selected-border bg-surface-selected px-1.5 py-0.5 text-foreground">
            @release-notes
          </span>{" "}
          and fix the{" "}
          <Mark
            id="composer-rich-text"
            label="A draft range painted by a plugin rich-text effect"
            className="inline-block px-1 py-0.5"
            chipClassName="-right-2.5 -top-2.5"
          >
            <span className="rounded bg-warning/25 px-1 py-0.5 text-foreground ring-1 ring-warning/40">
              TODO
            </span>
          </Mark>{" "}
          in checkout
        </p>

        {/* bottom row: + menu, model picker; then plugin actions, mic, send */}
        <div className="mt-3 flex items-center gap-2 px-0.5">
          <Mark
            id="composer-plus-menu"
            label="Plugin rows in the composer's + menu"
            className="p-1"
            chipClassName="-left-2.5 -top-2.5"
          >
            <span className="flex size-6 items-center justify-center rounded-md border border-border">
              <MiniIcon icon={PlusSignIcon} className="size-3" />
            </span>
          </Mark>
          <Mark
            id="provider-picker"
            label="Your agent provider in the model picker"
            className="p-1"
          >
            <span className="flex h-6 items-center gap-1.5 rounded-md px-1.5">
              <PluginGlyph className="size-3" />
              <span className="text-foreground">Your model</span>
              <span className="text-subtle-foreground">High</span>
            </span>
          </Mark>
          <span className="flex-1" />
          <Mark
            id="composer-actions"
            label="Plugin composer actions, before voice and send"
            className="p-1"
            chipClassName="-top-2.5 -left-2.5"
          >
            <span className="flex size-6 items-center justify-center rounded-md bg-state-hover">
              <PluginGlyph className="size-3" />
            </span>
          </Mark>
          <MiniIcon icon={Mic01Icon} className="size-3" />
          <span className="flex size-6 items-center justify-center rounded-md bg-foreground">
            <HugeiconsIcon
              icon={ArrowRight01Icon}
              className="size-3 -rotate-90 text-background"
            />
          </span>
        </div>
      </div>

      {/* the strip below the card: environment left, permission mode right */}
      <div className="flex items-center justify-between px-2.5" aria-hidden>
        <span className="flex items-center gap-1.5">
          <MiniIcon icon={Folder01Icon} className="size-3" />
          acme-app · worktree
        </span>
        <span>Full Access</span>
      </div>
    </div>
  );
}

/* ── the new-thread screen (RootComposeView order) ──────────────────── */

export function ComposeScreenWireframe({
  composer,
}: {
  /** The host's real composer, when available; replaces the mock one. */
  composer?: ReactNode;
} = {}) {
  return (
    <div className="overflow-x-auto">
      <div className="min-w-[560px]">
        <ComposeScreenWireframeBody composer={composer} />
      </div>
    </div>
  );
}

function ComposeScreenWireframeBody({ composer }: { composer?: ReactNode }) {
  return (
    <WindowFrame>
      <div className="flex items-center gap-2 border-b border-border-hairline px-3 py-2">
        <TrafficLights />
      </div>
      {/* Proportions mirror RootComposeView: a centered reading column
          (max-w-[760px] in the real app) inside a much wider main area,
          content top-aligned, empty canvas below. */}
      <div className="flex min-h-[430px] items-stretch">
        <div className="min-w-0 flex-1 px-6 pb-6 pt-4">
          <div className="mx-auto w-full max-w-[560px] space-y-2.5">
            {/* the composer, no greeting above it (RootComposeView order):
              the real one when the host lends it, the mock otherwise */}
            {composer ?? <MockHomeComposer />}

            {/* plugin homepage sections render last, below everything */}
            <Mark
              id="homepage-section"
              label="A plugin homepage section, below the composer"
              className="mt-4 block px-3 py-2.5"
              chipClassName="-top-1 right-0"
            >
              <span className="flex items-center gap-1.5 pb-2 font-medium text-foreground">
                <PluginGlyph className="size-3" />
                Your section
              </span>
              <span className="grid grid-cols-3 gap-2" aria-hidden>
                {["Release 1.4", "Bug triage", "Design QA"].map((card) => (
                  <span
                    key={card}
                    className="space-y-1.5 rounded-md border border-border-hairline bg-surface-raised p-2.5"
                  >
                    <span className="block text-foreground">{card}</span>
                    <span className="block h-1.5 w-4/5 rounded-sm bg-muted/60" />
                    <span className="block h-1.5 w-3/5 rounded-sm bg-muted/60" />
                  </span>
                ))}
              </span>
            </Mark>
          </div>
        </div>

        {/* right panel: no Info/Diff pins here; the new-tab launcher */}
        <div className="w-[210px] shrink-0 border-l border-border-hairline p-2">
          <span className="block px-1.5 pb-1.5 pt-1 text-2xs text-subtle-foreground/75">
            Actions
          </span>
          <span className="flex h-6.5 items-center gap-2 rounded-md px-2">
            <MiniIcon icon={Search01Icon} className="size-3" />
            Open browser
          </span>
          <span className="flex h-6.5 items-center gap-2 rounded-md px-2">
            <MiniIcon icon={TerminalIcon} className="size-3" />
            Start terminal
          </span>
          <Mark
            id="new-thread-panel"
            label="A plugin action in the new-thread panel launcher"
            className="flex h-6.5 items-center gap-2 px-2.5"
            chipClassName="-top-2 right-0"
          >
            <PluginGlyph className="size-3" />
            <span className="text-foreground">Your action</span>
          </Mark>
        </div>
      </div>
    </WindowFrame>
  );
}

/* ── the plugin settings page (PluginSettings.tsx order) ────────────── */

export function SettingsWireframe() {
  return (
    <WindowFrame>
      {/* health banner renders above the page */}
      <Mark
        id="plugin-status"
        label="The needs-configuration banner, above the settings page"
        className="m-2.5 flex items-center gap-2 border border-warning/40 bg-warning/10 px-3 py-2.5"
        chipClassName="-top-1.5 right-1.5"
      >
        <span aria-hidden className="size-2 shrink-0 rounded-full bg-warning" />
        <span className="text-warning-text">
          Set an API key, then reload the plugin
        </span>
      </Mark>

      <div className="space-y-3 px-4 pb-4">
        {/* header: icon, name, description left; the enable switch right */}
        <div className="flex items-center gap-2.5">
          <span className="flex size-8 items-center justify-center rounded-md border border-border">
            <PluginGlyph className="size-4" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-semibold text-foreground">
              Hello
            </span>
            <span className="block pt-1">
              A friendly example plugin · v0.1.0
            </span>
          </span>
          <span
            aria-hidden
            className="flex h-4.5 w-8 items-center rounded-full bg-foreground/60 p-0.5"
          >
            <span className="ml-auto size-3.5 rounded-full bg-background" />
          </span>
        </div>

        {/* Configuration: the declarative form, label left, control right */}
        <span className="block pt-1 font-medium text-foreground">
          Configuration
        </span>
        <Mark
          id="declarative-settings"
          label="The settings form bb renders from your descriptors"
          className="block border border-border bg-surface-recessed-solid p-3"
          chipClassName="-top-2 right-1.5"
        >
          <span className="flex h-7 items-center justify-between gap-2">
            <span className="flex items-center gap-1.5 text-foreground">
              API key
              <span className="rounded border border-border px-1.5 py-0.5 text-2xs">
                secret
              </span>
            </span>
            <span
              aria-hidden
              className="flex h-5.5 w-28 items-center rounded-md border border-border bg-card px-1.5 text-2xs text-subtle-foreground"
            >
              ••••••••
            </span>
          </span>
          <span className="flex h-7 items-center justify-between gap-2">
            <span className="text-foreground">Workspace</span>
            <span
              aria-hidden
              className="flex h-5.5 w-28 items-center justify-between rounded-md border border-border bg-card px-1.5 text-2xs"
            >
              acme-team
              <MiniIcon
                icon={ArrowRight01Icon}
                className="size-2.5 rotate-90"
              />
            </span>
          </span>
          <span className="flex h-7 items-center justify-between gap-2">
            <span className="text-foreground">Case-sensitive search</span>
            <span
              aria-hidden
              className="flex h-4.5 w-8 items-center rounded-full bg-foreground/60 p-0.5"
            >
              <span className="ml-auto size-3.5 rounded-full bg-background" />
            </span>
          </span>
          <span className="flex justify-end pt-1.5">
            <span className="flex h-6 items-center rounded-md border border-border px-2 text-foreground">
              Save settings
            </span>
          </span>
        </Mark>

        {/* plugin settingsSection components render below the form */}
        <Mark
          id="settings-section"
          label="Your custom settings section, below the form"
          className="block p-3"
          chipClassName="-top-1 right-0"
        >
          <span className="flex items-center gap-1.5 pb-2 font-medium text-foreground">
            <PluginGlyph className="size-3" />
            Your section
          </span>
          <span
            aria-hidden
            className="block space-y-2 rounded-md border border-border bg-surface-recessed-solid p-2.5"
          >
            <span className="flex items-center justify-between">
              <span className="text-foreground">Connected as @acme-bot</span>
              <span className="flex h-5.5 items-center rounded-md border border-border bg-card px-2 text-foreground">
                Test connection
              </span>
            </span>
            <span className="block h-2 w-2/3 rounded-sm bg-muted/60" />
            <span className="block h-2 w-1/2 rounded-sm bg-muted/60" />
          </span>
        </Mark>
      </div>
    </WindowFrame>
  );
}

/** The stand-in composer for surfaces with no bb behind them (the docs site). */
function MockHomeComposer() {
  return (
    <>
      <div className="rounded-xl border border-border bg-card p-3 shadow-sm">
        <p className="px-1 pt-1 leading-relaxed text-subtle-foreground">
          Ask anything. @ to mention files, folders, or sections
        </p>
        <div aria-hidden className="h-10" />
        <div className="flex items-center gap-2 px-0.5" aria-hidden>
          <span className="flex size-6 items-center justify-center rounded-md border border-border">
            <MiniIcon icon={PlusSignIcon} className="size-3" />
          </span>
          <span className="flex h-6 items-center gap-1.5 rounded-md px-1.5 text-foreground">
            <MiniIcon icon={SparklesIcon} className="size-3" />
            Fable 5 · High
          </span>
          <span className="flex-1" />
          <MiniIcon icon={Mic01Icon} className="size-3" />
          <span className="flex size-6 items-center justify-center rounded-md bg-foreground">
            <MiniIcon icon={ArrowUp01Icon} className="size-3 text-background" />
          </span>
        </div>
      </div>
      <div className="flex items-center justify-between px-2.5" aria-hidden>
        <span className="flex items-center gap-1.5">
          <MiniIcon icon={Folder01Icon} className="size-3" />
          acme-app
          <span className="text-subtle-foreground">· worktree</span>
        </span>
        <span>Full Access</span>
      </div>
    </>
  );
}

/* ── annotating the real composer (plugin surface only) ─────────────── */

/**
 * Marker for a real host component: the numbered chip, plus an optional
 * highlight rectangle over the region it points at. The highlight uses the
 * same selected-surface tokens the skeleton `Mark` regions use, so a live
 * component and a mockup light up the same way.
 */
function OverlayMark({
  id,
  label,
  className,
  region,
}: {
  id: string;
  label: string;
  /** Chip position, relative to the annotated container. */
  className?: string;
  /** Region to highlight while active, as inset utilities. */
  region?: string;
}) {
  const { activeId, setActiveId, expandedId, spotlightId, numberOf, onSelect } =
    useSurfaceMap();
  const active = activeId === id || expandedId === id || spotlightId === id;
  return (
    <>
      {region && active ? (
        <span
          aria-hidden
          className={cn(
            // Same tokens as a skeleton Mark; the fill is dialled back
            // because this one sits over live product UI instead of behind
            // mockup bones.
            "pointer-events-none absolute z-10 rounded-md bg-surface-selected/30 ring-1 ring-surface-selected-border",
            region,
          )}
        />
      ) : null}
      <a
        href={`#surface-${id}`}
        aria-label={`${label} — jump to details`}
        onClick={
          onSelect
            ? (event) => {
                event.preventDefault();
                onSelect(id);
              }
            : undefined
        }
        onMouseEnter={() => setActiveId(id)}
        onMouseLeave={() => setActiveId(null)}
        onFocus={() => setActiveId(id)}
        onBlur={() => setActiveId(null)}
        className={cn("absolute z-20", className)}
      >
        <span
          aria-hidden
          className={annotationChipClass(active, "ring-2 ring-card")}
        >
          {numberOf(id)}
        </span>
      </a>
    </>
  );
}

/**
 * The composer slide when the real thing is available (inside bb): the
 * host's actual NewThreadComposer with the six composer surfaces marked
 * over its real chrome. Marker offsets track the composer's stable layout —
 * editor on top, the +/model/actions row at the card's bottom edge, the
 * project row beneath.
 */
export function RealComposerAnnotated({ composer }: { composer: ReactNode }) {
  return (
    <div className="relative mx-auto w-full max-w-2xl">
      {/* Plugin banners render in the space above the composer. */}
      <OverlayMark
        id="composer-banners"
        label="Plugin composer banners, above the prompt box"
        className="-top-2 left-6"
        region="inset-x-0 -top-1 h-8"
      />
      <OverlayMark
        id="mention-provider"
        label="Plugin @-mention typeahead, inside the editor"
        className="-left-2 top-6"
        region="inset-x-2 top-3 h-16"
      />
      {/* The draft region: the editor itself, which is what a plugin paints. */}
      <OverlayMark
        id="composer-rich-text"
        label="Plugin draft highlighting, painted over the text"
        className="left-[55%] top-12"
        region="inset-x-2 top-3 h-16"
      />
      <OverlayMark
        id="composer-plus-menu"
        label="Plugin rows in the + menu"
        className="-left-2 bottom-[46px]"
        region="bottom-[42px] left-2 size-8"
      />
      <OverlayMark
        id="provider-picker"
        label="Plugin agent providers, in the model picker"
        className="bottom-[58px] left-12"
        region="bottom-[42px] left-11 h-8 w-40"
      />
      <OverlayMark
        id="composer-actions"
        label="Plugin inline actions, in the action row"
        className="bottom-[58px] right-24"
        region="bottom-[42px] right-4 h-8 w-32"
      />
      {composer}
    </div>
  );
}

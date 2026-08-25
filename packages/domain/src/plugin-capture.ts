/**
 * The plugin surfaces a submission screenshot can cover, and how each one is
 * reached.
 *
 * A listing screenshot has to show the plugin's own UI, so the capture visits
 * the surface the plugin registered rather than the app around it. Surfaces
 * split into two kinds:
 *
 * - `route`: the surface renders on a URL, either because it owns one
 *   (`navPanel`) or because it lives in chrome every route paints
 *   (`sidebarFooterAction`). Navigating is enough.
 * - `fixture`: the surface only exists once a thread, composer, or file is in
 *   a particular state. Capture seeds one shared fixture workspace and drives
 *   to that state; the same fixture is used for every plugin so listings stay
 *   comparable and no author has to author one.
 */
export type PluginCaptureKind = "route" | "fixture";

export interface PluginCaptureSurface {
  /** Slot name as registered through the plugin SDK. */
  readonly slot: string;
  /** How the capture reaches it. */
  readonly kind: PluginCaptureKind;
  /**
   * Route to load, relative to the app origin. `:pluginId` and `:panelPath`
   * are substituted from the plugin's own registration.
   */
  readonly route: string;
  /** What the fixture must arrange before the shot is worth taking. */
  readonly requires?: string;
  /** Suggested file stem, so a listing's shots sort predictably. */
  readonly stem: string;
}

export const PLUGIN_CAPTURE_SURFACES: readonly PluginCaptureSurface[] = [
  {
    slot: "navPanel",
    kind: "route",
    route: "/plugins/:pluginId/:panelPath",
    stem: "01-panel",
  },
  { slot: "homepageSection", kind: "route", route: "/", stem: "02-homepage" },
  {
    slot: "settingsSection",
    kind: "route",
    route: "/settings/plugins/:pluginId",
    stem: "03-settings",
  },
  {
    slot: "experimental_threadList",
    kind: "route",
    route: "/",
    stem: "04-thread-list",
  },
  {
    slot: "sidebarFooterAction",
    kind: "route",
    route: "/",
    stem: "05-sidebar-footer",
  },
  {
    slot: "messageDirective",
    kind: "fixture",
    route: "/threads/:threadId",
    requires: "a thread whose last message carries the plugin's directive",
    stem: "06-message",
  },
  {
    slot: "threadPanelAction",
    kind: "fixture",
    route: "/threads/:threadId",
    requires: "a thread with the plugin's thread panel opened",
    stem: "07-thread-panel",
  },
  {
    slot: "experimental_threadHeaderAction",
    kind: "fixture",
    route: "/threads/:threadId",
    requires: "a thread open",
    stem: "08-thread-header",
  },
  {
    slot: "composer.customize",
    kind: "fixture",
    route: "/threads/:threadId",
    requires: "a thread with the composer focused",
    stem: "09-composer",
  },
  {
    slot: "pendingInteraction",
    kind: "fixture",
    route: "/threads/:threadId",
    requires: "a turn paused awaiting input",
    stem: "10-pending",
  },
  {
    slot: "fileOpener",
    kind: "fixture",
    route: "/threads/:threadId",
    requires: "a fixture file open whose extension the plugin claims",
    stem: "11-file",
  },
] as const;

const SURFACES_BY_SLOT = new Map(
  PLUGIN_CAPTURE_SURFACES.map((surface) => [surface.slot, surface]),
);

export function pluginCaptureSurface(
  slot: string,
): PluginCaptureSurface | undefined {
  return SURFACES_BY_SLOT.get(slot);
}

/** One planned screenshot: where to go, and what to write. */
export interface PluginCaptureStep {
  readonly slot: string;
  readonly kind: PluginCaptureKind;
  readonly url: string;
  readonly outputFile: string;
  readonly requires: string | null;
}

export interface PluginCapturePlanArgs {
  readonly pluginId: string;
  /** Slots the plugin actually registered, as reported by the running app. */
  readonly slots: readonly string[];
  /** First path segment of each nav panel the plugin registered. */
  readonly panelPaths?: readonly string[];
  /** Fixture thread the capture drives, when any fixture surface is planned. */
  readonly fixtureThreadId?: string;
}

/**
 * Turn the slots a plugin registered into an ordered capture plan.
 *
 * Unregistered slots produce no step: a plugin that only adds agent tools has
 * nothing to photograph, and a listing should not be blocked on a screenshot
 * that cannot exist. Fixture surfaces are dropped when no fixture thread is
 * available rather than pointing at a route that would render the empty app.
 */
export function planPluginCapture(
  args: PluginCapturePlanArgs,
): PluginCaptureStep[] {
  const panelPaths = args.panelPaths ?? [];
  const steps: PluginCaptureStep[] = [];
  for (const surface of PLUGIN_CAPTURE_SURFACES) {
    if (!args.slots.includes(surface.slot)) continue;
    if (surface.kind === "fixture" && args.fixtureThreadId === undefined)
      continue;

    if (surface.route.includes(":panelPath")) {
      // One shot per panel: a plugin contributing several panels is several
      // different screens, and a listing that shows one of them undersells it.
      panelPaths.forEach((panelPath, index) => {
        steps.push({
          slot: surface.slot,
          kind: surface.kind,
          url: surface.route
            .replace(":pluginId", args.pluginId)
            .replace(":panelPath", panelPath),
          outputFile:
            panelPaths.length > 1
              ? `${surface.stem}-${index + 1}.png`
              : `${surface.stem}.png`,
          requires: surface.requires ?? null,
        });
      });
      continue;
    }

    steps.push({
      slot: surface.slot,
      kind: surface.kind,
      url: surface.route
        .replace(":pluginId", args.pluginId)
        .replace(":threadId", args.fixtureThreadId ?? ""),
      outputFile: `${surface.stem}.png`,
      requires: surface.requires ?? null,
    });
  }
  return steps;
}

export type PluginCaptureKind = "route" | "fixture";

export interface PluginCaptureSurface {
  readonly slot: string;
  readonly kind: PluginCaptureKind;
  readonly route: string;
  readonly requires?: string;
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

export interface PluginCaptureStep {
  readonly slot: string;
  readonly kind: PluginCaptureKind;
  readonly url: string;
  readonly outputFile: string;
  readonly requires: string | null;
}

export interface PluginCapturePlanArgs {
  readonly pluginId: string;
  readonly slots: readonly string[];
  readonly panelPaths?: readonly string[];
  readonly fixtureThreadId?: string;
}

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

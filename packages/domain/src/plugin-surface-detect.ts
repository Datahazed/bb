/**
 * Which surfaces a plugin registers, read from its own frontend source.
 *
 * The server never learns this: slots are registered at runtime in the
 * renderer, inside the plugin's `definePluginApp` entry. Asking a running app
 * would mean the plugin is already installed and loaded, which is exactly what
 * a submission screenshot cannot assume. Reading the source it is about to
 * ship keeps the capture available before the plugin exists anywhere.
 *
 * This is deliberately a text scan, not a parse. It only has to answer "does
 * this plugin paint here", and a false positive costs one skipped screenshot
 * rather than a wrong listing.
 */
import { PLUGIN_CAPTURE_SURFACES } from "./plugin-capture.js";

const SLOT_CALL = /(?:^|[^\w.])(?:app\.)?slots\.([A-Za-z_][\w]*)\s*\(/g;
const COMPOSER_CALL = /(?:^|[^\w.])(?:app\.)?composer\.customize\s*\(/;
/** Comments and strings that merely name a slot must not count as registration. */
const LINE_COMMENT = /^\s*(?:\/\/|\*|\/\*)/;

export interface DetectedPluginSurfaces {
  /** Capturable slots, in catalog order. */
  readonly slots: string[];
  /** First path segment of each nav panel, in registration order. */
  readonly panelPaths: string[];
}

function isCapturable(slot: string): boolean {
  return PLUGIN_CAPTURE_SURFACES.some((surface) => surface.slot === slot);
}

/**
 * Nav panels declare the path they own; the capture needs it to build the
 * panel's URL. `path: "board"` and `path: "/board"` both mean the same panel.
 */
function readPanelPaths(source: string): string[] {
  const paths: string[] = [];
  const navPanel = /slots\.navPanel\s*\(\s*\{([\s\S]{0,400}?)\}/g;
  let match: RegExpExecArray | null;
  while ((match = navPanel.exec(source)) !== null) {
    const path = /\bpath\s*:\s*["'`]([^"'`]+)["'`]/.exec(match[1] ?? "");
    if (path?.[1] !== undefined) paths.push(path[1].replace(/^\/+/, ""));
  }
  return paths;
}

export function detectPluginSurfaces(source: string): DetectedPluginSurfaces {
  const code = source
    .split("\n")
    .filter((line) => !LINE_COMMENT.test(line))
    .join("\n");

  const found = new Set<string>();
  let match: RegExpExecArray | null;
  SLOT_CALL.lastIndex = 0;
  while ((match = SLOT_CALL.exec(code)) !== null) {
    const slot = match[1];
    if (slot !== undefined && isCapturable(slot)) found.add(slot);
  }
  if (COMPOSER_CALL.test(code)) found.add("composer.customize");

  return {
    slots: PLUGIN_CAPTURE_SURFACES.filter((surface) => found.has(surface.slot)).map(
      (surface) => surface.slot,
    ),
    panelPaths: readPanelPaths(code),
  };
}

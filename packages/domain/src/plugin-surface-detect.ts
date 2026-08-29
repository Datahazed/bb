import { PLUGIN_CAPTURE_SURFACES } from "./plugin-capture.js";

const SLOT_CALL = /(?:^|[^\w.])(?:app\.)?slots\.([A-Za-z_][\w]*)\s*\(/g;
const COMPOSER_CALL = /(?:^|[^\w.])(?:app\.)?composer\.customize\s*\(/;
const LINE_COMMENT = /^\s*(?:\/\/|\*|\/\*)/;

export interface DetectedPluginSurfaces {
  readonly slots: string[];
  readonly panelPaths: string[];
}

function isCapturable(slot: string): boolean {
  return PLUGIN_CAPTURE_SURFACES.some((surface) => surface.slot === slot);
}

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
    slots: PLUGIN_CAPTURE_SURFACES.filter((surface) =>
      found.has(surface.slot),
    ).map((surface) => surface.slot),
    panelPaths: readPanelPaths(code),
  };
}

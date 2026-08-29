import {
  createPluginSurfaceAgentReference,
  type PluginSurface,
} from "@bb/plugin-api-map";

import { copyPlainText } from "../lib/copy-plain-text.js";

export function pluginSurfaceReferenceText(surface: PluginSurface): string {
  return createPluginSurfaceAgentReference(surface).clipboard.text;
}

export function copyPluginSurfaceReferenceText(
  surface: PluginSurface,
): Promise<boolean> {
  return copyPlainText(pluginSurfaceReferenceText(surface));
}

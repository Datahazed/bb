import {
  createPluginSurfaceAgentReference,
  type PluginSurface,
} from "@bb/plugin-api-map";

import { copyPlainText } from "../lib/copy-plain-text.js";

export function pluginSurfaceReferenceText(surface: PluginSurface): string {
  const reference = createPluginSurfaceAgentReference(surface);
  return `${reference.clipboard.text.trim()}\n\n${reference.context}`;
}

export function copyPluginSurfaceReferenceText(
  surface: PluginSurface,
): Promise<boolean> {
  return copyPlainText(pluginSurfaceReferenceText(surface));
}

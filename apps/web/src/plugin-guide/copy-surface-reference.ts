import {
  createPluginSurfaceAgentReference,
  type PluginSurface,
} from "@bb/plugin-api-map";

/** The exact plain-text reference intended for editors and terminal agents. */
export function pluginSurfaceReferenceText(surface: PluginSurface): string {
  return createPluginSurfaceAgentReference(surface).clipboard.text;
}

function copyWithEditingCommand(text: string): boolean {
  if (
    typeof document === "undefined" ||
    document.body === null ||
    typeof document.execCommand !== "function"
  ) {
    return false;
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.readOnly = true;
  textarea.setAttribute("aria-hidden", "true");
  Object.assign(textarea.style, {
    height: "1px",
    opacity: "0",
    pointerEvents: "none",
    position: "fixed",
    width: "1px",
  });
  document.body.appendChild(textarea);

  try {
    textarea.select();
    return document.execCommand("copy");
  } catch {
    return false;
  } finally {
    textarea.remove();
  }
}

/** Copy arbitrary text without placing an HTML representation on the clipboard. */
export async function copyPlainText(text: string): Promise<boolean> {
  if (
    typeof navigator !== "undefined" &&
    typeof navigator.clipboard?.writeText === "function"
  ) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // The selected-text fallback also works when the Clipboard API is
      // unavailable on an otherwise functional page.
    }
  }

  return copyWithEditingCommand(text);
}

/**
 * Copy a Guide reference as text only. The docs site deliberately never uses
 * the bb composer pill's ClipboardItem/text-html path.
 */
export function copyPluginSurfaceReferenceText(
  surface: PluginSurface,
): Promise<boolean> {
  return copyPlainText(pluginSurfaceReferenceText(surface));
}

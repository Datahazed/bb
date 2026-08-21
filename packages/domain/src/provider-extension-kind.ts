import { z } from "zod";

/**
 * The namespace grammar for provider extension kinds: `"<pluginId>/<name>"`.
 *
 * Core understands a small semantic item vocabulary (see `CORE_ITEM_KINDS` in
 * provider-event.ts). Everything else a provider emits is an extension kind
 * owned by the plugin that registered the provider: codex goals, the codex
 * `macos` permission profile, a future provider's native widgets. The plugin
 * id prefix is what keeps two plugins from colliding on `"goal"`, and it is
 * the key the server uses to find the declared payload schema at ingest.
 *
 * Only the namespace SHAPE is validated here. The payload is opaque to this
 * layer: the server validates it against the owning plugin's declared
 * `extensionKinds` schema when the event is ingested, which is wired in a
 * later workstream (WS1a, generic assembler + ingest validation).
 */
export const EXTENSION_KIND_PATTERN = /^[a-z0-9-]+\/[a-z0-9-]+$/u;

export const extensionKindSchema = z
  .string()
  .regex(
    EXTENSION_KIND_PATTERN,
    'extension kinds are "<pluginId>/<name>" (lowercase letters, digits, and "-")',
  );

/** A namespaced extension kind, `"<pluginId>/<name>"`. */
export type ExtensionKind = `${string}/${string}`;

export function isExtensionKind(value: string): value is ExtensionKind {
  return EXTENSION_KIND_PATTERN.test(value);
}

/** Split a validated extension kind into its plugin id and local name. */
export function parseExtensionKind(kind: ExtensionKind): {
  pluginId: string;
  name: string;
} {
  const separator = kind.indexOf("/");
  return {
    pluginId: kind.slice(0, separator),
    name: kind.slice(separator + 1),
  };
}

/**
 * Types for the generated plugin API docs model. The model is extracted from
 * the plugin SDK's committed bundled declarations by
 * scripts/generate-plugin-api-docs.mjs, so the docs cannot drift from the
 * published API surface without failing the staleness test.
 */

export type ApiModuleId =
  | "root"
  | "app"
  | "host"
  | "provider-bridge"
  | "testing"
  | "testing-app"
  | "testing-host";

export type ApiSymbolKind =
  | "interface"
  | "type"
  | "function"
  | "class"
  | "const"
  | "enum";

export interface ApiMemberDoc {
  name: string;
  kind: "property" | "method" | "signature";
  optional: boolean;
  /** Declaration text as written in the bundled declarations. */
  signature: string;
  doc: string | null;
  experimental: boolean;
}

export interface ApiSymbolDoc {
  name: string;
  kind: ApiSymbolKind;
  /** True when the export is type-only (types, interfaces, `export type`). */
  exportedAsType: boolean;
  doc: string | null;
  /** Header line for interfaces/classes; the full declaration otherwise. */
  signature: string;
  members: ApiMemberDoc[];
  experimental: boolean;
}

export interface ApiModuleDoc {
  id: ApiModuleId;
  /** The subpath plugin authors import, e.g. "@get-bb/plugin-sdk/app". */
  importPath: string;
  /** Repo-relative path of the declaration file this module was read from. */
  sourceFile: string;
  exports: ApiSymbolDoc[];
}

export interface PluginApiDocsModel {
  sdkVersion: string;
  modules: ApiModuleDoc[];
}

export interface ApiSymbolRef {
  module: ApiModuleId;
  name: string;
}

export function symbolKey(ref: ApiSymbolRef): string {
  return `${ref.module}:${ref.name}`;
}

export function indexModel(
  model: PluginApiDocsModel,
): Map<string, ApiSymbolDoc> {
  const index = new Map<string, ApiSymbolDoc>();
  for (const module of model.modules) {
    for (const symbol of module.exports) {
      index.set(symbolKey({ module: module.id, name: symbol.name }), symbol);
    }
  }
  return index;
}

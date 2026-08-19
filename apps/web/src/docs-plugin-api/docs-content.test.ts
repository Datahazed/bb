import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { renderGeneratedModule } from "../../scripts/generate-plugin-api-docs.mjs";
import { PLUGIN_API_MODEL } from "./api-model.generated";
import { DOCS_GROUPS, DOCS_SECTIONS } from "./content";
import { indexModel, symbolKey } from "./model";

const modelIndex = indexModel(PLUGIN_API_MODEL);

describe("generated API model", () => {
  it(
    "is up to date with the plugin SDK bundled declarations",
    // Re-parses all seven declaration bundles with the TS compiler; on a
    // loaded machine that legitimately exceeds vitest's 5s default.
    { timeout: 30_000 },
    () => {
      const committed = readFileSync(
        join(import.meta.dirname, "api-model.generated.ts"),
        "utf8",
      );
      expect(
        committed === renderGeneratedModule(),
        "api-model.generated.ts is stale. Run: pnpm --filter @bb/web docs:generate",
      ).toBe(true);
    },
  );

  it("covers every public SDK entry point", () => {
    expect(PLUGIN_API_MODEL.modules.map((module) => module.id)).toEqual([
      "root",
      "app",
      "host",
      "provider-bridge",
      "testing",
      "testing-app",
      "testing-host",
    ]);
    for (const module of PLUGIN_API_MODEL.modules) {
      expect(module.exports.length).toBeGreaterThan(0);
    }
  });
});

describe("curated docs content", () => {
  it("has unique section ids and only known groups", () => {
    const ids = DOCS_SECTIONS.map((section) => section.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const section of DOCS_SECTIONS) {
      expect(DOCS_GROUPS).toContain(section.group);
    }
  });

  it("references only symbols that exist in the generated model", () => {
    const unknown: string[] = [];
    for (const section of DOCS_SECTIONS) {
      for (const group of section.symbolGroups) {
        for (const ref of group.symbols) {
          if (!modelIndex.has(symbolKey(ref))) {
            unknown.push(`${section.id}: ${ref.module}:${ref.name}`);
          }
        }
      }
    }
    expect(unknown).toEqual([]);
  });

  it("assigns each symbol name to exactly one section", () => {
    const seen = new Map<string, string>();
    const conflicts: string[] = [];
    for (const section of DOCS_SECTIONS) {
      for (const group of section.symbolGroups) {
        for (const ref of group.symbols) {
          const existing = seen.get(ref.name);
          if (existing && existing !== section.id) {
            conflicts.push(`${ref.name} in both ${existing} and ${section.id}`);
          }
          seen.set(ref.name, section.id);
        }
      }
    }
    expect(conflicts).toEqual([]);
  });

  it("documents every export of every SDK entry point", () => {
    // Name-level coverage: a type re-exported by several entry points (for
    // example JsonValue from the root, app, and provider-bridge subpaths) is
    // documented once and linked everywhere else.
    const documented = new Set<string>();
    for (const section of DOCS_SECTIONS) {
      for (const group of section.symbolGroups) {
        for (const ref of group.symbols) {
          documented.add(ref.name);
        }
      }
    }
    const missing: string[] = [];
    for (const module of PLUGIN_API_MODEL.modules) {
      for (const symbol of module.exports) {
        if (!documented.has(symbol.name)) {
          missing.push(`${module.id}:${symbol.name}`);
        }
      }
    }
    expect(missing).toEqual([]);
  });
});

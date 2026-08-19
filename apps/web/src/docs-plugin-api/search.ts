/**
 * Client-side search over the plugin API: every exported symbol plus the
 * curated section pages, ranked by @bb/fuzzy-match (the same engine bb's app
 * uses for its pickers).
 */
import { fuzzyMatchText } from "@bb/fuzzy-match";

import { PLUGIN_API_MODEL } from "./api-model.generated";
import { DOCS_SECTIONS, SECTION_BY_SYMBOL_NAME } from "./content";

export interface DocsSearchEntry {
  kind: "symbol" | "section";
  /** Display title: the symbol name or section title. */
  title: string;
  /** Secondary line: import path for symbols, group for sections. */
  subtitle: string;
  /** Symbol kind badge ("interface", "function", …); null for sections. */
  badge: string | null;
  experimental: boolean;
  href: string;
  /** First sentence of the doc/summary, for the result row. */
  summary: string | null;
}

function firstSentence(text: string | null): string | null {
  if (!text) {
    return null;
  }
  const flattened = text
    .split("\n")
    .join(" ")
    .replace(/\{@link\s+([^}|\s]+)(?:\s*\|\s*([^}]+))?\}/g, "$1")
    .replace(/`/g, "");
  const match = flattened.match(/^.*?[.!?](\s|$)/);
  const sentence = (match ? match[0] : flattened).trim();
  return sentence.length > 160 ? `${sentence.slice(0, 157)}…` : sentence;
}

export function buildSearchIndex(): DocsSearchEntry[] {
  const entries: DocsSearchEntry[] = [];

  for (const section of DOCS_SECTIONS) {
    entries.push({
      kind: "section",
      title: section.title,
      subtitle: section.group,
      badge: null,
      experimental: false,
      href: `/docs/plugin-api/${section.id}`,
      summary: section.summary,
    });
  }

  // One entry per symbol name; the canonical page comes from the curated
  // section map, and additional exporting modules are folded into the
  // subtitle so "provider-bridge" searches still land.
  const seen = new Map<string, DocsSearchEntry>();
  for (const module of PLUGIN_API_MODEL.modules) {
    for (const symbol of module.exports) {
      const sectionId = SECTION_BY_SYMBOL_NAME.get(symbol.name);
      if (!sectionId) {
        continue;
      }
      const existing = seen.get(symbol.name);
      if (existing) {
        continue;
      }
      const entry: DocsSearchEntry = {
        kind: "symbol",
        title: symbol.name,
        subtitle: module.importPath,
        badge: symbol.kind,
        experimental: symbol.experimental,
        href: `/docs/plugin-api/${sectionId}#${symbol.name}`,
        summary: firstSentence(symbol.doc),
      };
      seen.set(symbol.name, entry);
      entries.push(entry);
    }
  }

  return entries;
}

export const SEARCH_INDEX: DocsSearchEntry[] = buildSearchIndex();

export interface DocsSearchResult {
  entry: DocsSearchEntry;
  /** Matched character positions within entry.title (title matches only). */
  titlePositions: number[];
}

export function searchDocs(query: string, limit = 12): DocsSearchResult[] {
  const trimmed = query.trim();
  if (!trimmed) {
    return [];
  }
  const matches = fuzzyMatchText({
    items: SEARCH_INDEX,
    query: trimmed,
    getText: (entry) => [entry.title, entry.summary ?? ""],
    limit,
  });
  return matches.map((match) => {
    const matchedTitle =
      match.positions.length > 0 &&
      match.positions.every((position) => position < match.item.title.length);
    return {
      entry: match.item,
      titlePositions: matchedTitle ? match.positions : [],
    };
  });
}

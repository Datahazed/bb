import type { PluginCatalogSearchEntry } from "@/hooks/queries/plugin-catalog-queries";

function normalizedAuthorName(name: string): string {
  return name.normalize("NFKC").trim().replace(/\s+/gu, " ").toLowerCase();
}

function marketplaceScopedAuthorId(
  marketplace: string,
  authorIdentity: string,
): string {
  return `${marketplace.length}:${marketplace}:${authorIdentity}`;
}

export function pluginMarketplaceAuthorId(
  entry: Pick<PluginCatalogSearchEntry, "author" | "marketplace">,
): string | null {
  const author = entry.author;
  if (author === null) return null;
  if (author.github !== null) {
    return marketplaceScopedAuthorId(
      entry.marketplace,
      `github:${author.github.toLowerCase()}`,
    );
  }
  return marketplaceScopedAuthorId(
    entry.marketplace,
    `name:${normalizedAuthorName(author.name)}`,
  );
}

export function entriesByMarketplaceAuthor<
  Entry extends Pick<PluginCatalogSearchEntry, "author" | "marketplace">,
>(entries: readonly Entry[], authorId: string): Entry[] {
  return entries.filter(
    (entry) => pluginMarketplaceAuthorId(entry) === authorId,
  );
}

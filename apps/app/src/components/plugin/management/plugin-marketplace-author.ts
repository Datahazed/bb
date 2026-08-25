import type { PluginCatalogSearchEntry } from "@/hooks/queries/plugin-catalog-queries";

const GITHUB_HOSTS = new Set(["github.com", "www.github.com"]);

function normalizedAuthorName(name: string): string {
  return name.normalize("NFKC").trim().replace(/\s+/gu, " ").toLowerCase();
}

function canonicalAuthorUrl(value: string): string {
  const url = new URL(value);
  url.hash = "";
  url.hostname = url.hostname.toLowerCase();
  url.pathname = url.pathname.replace(/\/+$/u, "") || "/";
  if (
    (url.protocol === "https:" && url.port === "443") ||
    (url.protocol === "http:" && url.port === "80")
  ) {
    url.port = "";
  }
  return url.toString();
}

function githubLoginFromUrl(value: string): string | null {
  const url = new URL(value);
  if (!GITHUB_HOSTS.has(url.hostname.toLowerCase())) return null;
  const [login, extra] = url.pathname.split("/").filter(Boolean);
  if (login === undefined || extra !== undefined) return null;
  return login.toLowerCase();
}

function marketplaceScopedAuthorId(
  marketplace: string,
  authorIdentity: string,
): string {
  // Length-prefixing makes the key unambiguous even when a user-named
  // marketplace contains the same separators as an author identity.
  return `${marketplace.length}:${marketplace}:${authorIdentity}`;
}

/**
 * Canonical author identity available from the shipped catalog contract.
 *
 * Marketplace `author.github` is projected by the server as its GitHub profile
 * URL, so it remains the strongest identity even though the app DTO carries
 * only `name` and `url`. An explicit author URL is next. The manifest permits
 * neither field, so the deterministic last resort is marketplace + normalized
 * display name; scoping prevents two marketplaces from merging unrelated
 * name-only people. Two different name-only people with the same display name
 * inside one marketplace remain indistinguishable because the source contract
 * provides no stronger key.
 */
export function pluginMarketplaceAuthorId(
  entry: Pick<PluginCatalogSearchEntry, "author" | "marketplace">,
): string | null {
  const author = entry.author;
  if (author === null) return null;
  if (author.url !== null) {
    const github = githubLoginFromUrl(author.url);
    if (github !== null) {
      return marketplaceScopedAuthorId(entry.marketplace, `github:${github}`);
    }
    return marketplaceScopedAuthorId(
      entry.marketplace,
      `url:${canonicalAuthorUrl(author.url)}`,
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

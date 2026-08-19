import { createHash } from "node:crypto";

/**
 * Weak validator for a serialized JSON body. Weak because the response is
 * served through content negotiation (gzip/brotli) and byte identity is not
 * the point: the client only needs to know the JSON did not change.
 */
export function weakEtagForBody(body: string): string {
  return `W/"${createHash("sha1").update(body).digest("base64url")}"`;
}

/**
 * RFC 9110 If-None-Match evaluation with weak comparison: `*` matches any
 * current representation, and `W/` prefixes are ignored on both sides.
 */
export function ifNoneMatchMatches(
  headerValue: string | undefined,
  etag: string,
): boolean {
  if (headerValue === undefined) {
    return false;
  }
  const trimmed = headerValue.trim();
  if (trimmed === "*") {
    return true;
  }
  const opaque = stripWeakPrefix(etag);
  return trimmed
    .split(",")
    .some((candidate) => stripWeakPrefix(candidate.trim()) === opaque);
}

function stripWeakPrefix(value: string): string {
  return value.startsWith("W/") ? value.slice(2) : value;
}

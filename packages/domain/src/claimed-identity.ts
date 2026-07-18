import { z } from "zod";

/**
 * Multiplayer identity is CLAIMED, not verified: every client self-asserts who
 * it is via this header, on API requests and the /ws upgrade. Admission is
 * enforced entirely at the boundary (connect gate membership, tailnet ACLs, or
 * an explicitly opened network bind); anyone admitted has owner parity and
 * could execute code regardless, so attribution is honor-system by design.
 * The only verified record is the connect gate's admission audit log.
 *
 * Collaborators are keyed by normalized handle: the same handle on two devices
 * is the same person. `clientId` is a per-device hint used only for presence
 * bookkeeping, never for identity.
 */
export const CLAIMED_IDENTITY_HEADER = "x-bb-claimed-identity";

export const claimedIdentitySchema = z
  .object({
    handle: z.string().min(1).max(64),
    displayName: z.string().min(1).max(128),
    // null = this person has no avatar; clients render initials instead.
    imageUrl: z.string().max(2048).nullable(),
    clientId: z.string().min(1).max(64),
  })
  .strict();
export type ClaimedIdentity = z.infer<typeof claimedIdentitySchema>;

/**
 * Canonical form used as the collaborator key. Case and surrounding whitespace
 * never distinguish people ("Sawyer" and "sawyer " are the same collaborator).
 */
export function normalizeHandle(raw: string): string {
  return raw.normalize("NFKC").trim().toLowerCase();
}

/** Header value: URI-encoded JSON (ASCII-safe, portable browser/node). */
export function encodeClaimedIdentityHeader(identity: ClaimedIdentity): string {
  return encodeURIComponent(JSON.stringify(identity));
}

/**
 * Boundary parser for the freeform header. Returns the identity with its
 * handle normalized, or null when the value is absent or malformed — callers
 * fall back to their default local identity rather than failing the request.
 */
export function decodeClaimedIdentityHeader(
  value: string | null | undefined,
): ClaimedIdentity | null {
  if (!value) {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(decodeURIComponent(value));
  } catch {
    return null;
  }
  const result = claimedIdentitySchema.safeParse(parsed);
  if (!result.success) {
    return null;
  }
  const handle = normalizeHandle(result.data.handle);
  if (handle.length === 0) {
    return null;
  }
  return { ...result.data, handle };
}

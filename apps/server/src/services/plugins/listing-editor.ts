/**
 * Direct listing edits — the seams, not the implementation.
 *
 * Authors currently change a published listing by opening a pull request on
 * `get-bb/marketplace`, which is right for a first submission (it is the review
 * gate) and wrong for "fix a typo in my description". This module defines the
 * boundary a direct-edit path has to satisfy so the rest of the system can be
 * written against it while the registry side is built.
 *
 * Two facts constrain the design:
 *
 * 1. bb has no ownership primitive. "Authored" means "installed from a local
 *    path on this machine", which says nothing about who owns the registry
 *    entry. Ownership has to be established against an external identity —
 *    the entry already carries `author.github`.
 * 2. Only listing metadata is safe to write without review. Anything that
 *    changes which code runs (source, version range, tag prefix) keeps the PR
 *    path, so the editable subset is deliberately narrow.
 */

import type { MarketplaceEntryV2 } from "../plugin-catalog/marketplace-manifest.js";

/** The fields a listing owner may change without marketplace review. */
export interface ListingEditableFields {
  description: string;
  category: MarketplaceEntryV2["category"];
  screenshots: readonly string[];
}

/**
 * Whether the caller may edit a given entry's listing.
 *
 * `verified` requires proof the caller controls the identity the entry names —
 * matching `author.github` against a signed-in GitHub account is the intended
 * mechanism. Until that exists, every caller is `unverified`.
 */
export type ListingOwnership =
  | { kind: "verified"; login: string }
  | { kind: "unverified"; reason: string };

export interface ListingOwnershipResolver {
  resolve(pluginId: string): Promise<ListingOwnership>;
}

/** Denies every edit; replaced once author identity exists. */
export const unverifiedOwnershipResolver: ListingOwnershipResolver = {
  resolve: async () => ({
    kind: "unverified",
    reason: "author identity is not implemented yet",
  }),
};

export type ListingWriteResult =
  | { ok: true; publishedAt: string }
  | { ok: false; status: 403 | 422 | 501 | 502; error: string };

/**
 * Writes an approved edit to the registry's source model.
 *
 * The implementation is registry-side: authenticate the owner, validate against
 * the same v2 entry schema the manifest parser uses, write the source entry, and
 * let the existing build emit both v1 and v2. Clients pick the change up on the
 * next catalog refresh — no client change is needed.
 */
export interface MarketplaceListingWriter {
  write(
    pluginId: string,
    fields: ListingEditableFields,
    ownership: Extract<ListingOwnership, { kind: "verified" }>,
  ): Promise<ListingWriteResult>;
}

export const notImplementedListingWriter: MarketplaceListingWriter = {
  write: async () => ({
    ok: false,
    status: 501,
    error: "direct listing edits are not implemented; submit a pull request",
  }),
};

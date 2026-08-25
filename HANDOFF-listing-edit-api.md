# Handoff — direct listing edits (no PR)

**Status:** seams only. `apps/server/src/services/plugins/listing-editor.ts` compiles and is wired to nothing. No user-visible behavior changes on this layer.

## The problem

An author who wants to fix a typo in their marketplace description currently has to open a pull request on `get-bb/marketplace` and wait for review. That gate is correct for a first submission and wrong for every edit after it.

## Why it isn't just a UI change

bb has no ownership primitive. Today "authored" means "installed from a local path on this machine" — that proves you have the code, not that you own the `usage` entry in the registry. A direct-edit path needs an identity bb doesn't currently have.

## Scope of this handoff: the registry write API

The colleague owns **piece 2 — the registry write API on getbb.app**. That is the load-bearing piece: it defines the contract the other two are written against, and it can be built and tested before either exists (a verified-owner fixture stands in for identity; the app keeps its PR path until the API is live).

Pieces 1 and 3 are described below for context, not as this handoff's deliverables.

## The three pieces

1. **Identity.** Authors sign in; ownership means the signed-in identity matches the entry's `author.github`, established at first submission. GitHub OAuth is the natural fit since the entry already carries the login. Implements `ListingOwnershipResolver` (currently `unverifiedOwnershipResolver`, which denies everything).
2. **A registry write API** on getbb.app. Accepts an edit from a verified owner, validates against the *same* v2 entry schema the manifest parser uses, writes the source entry, and lets the existing build emit both v1 and v2. Implements `MarketplaceListingWriter` (currently `notImplementedListingWriter`, which returns 501).
3. **The app.** `Edit listing` stops opening a composer that files a PR and calls the API instead. The listing goes live on the next catalog refresh — no client-side cache work needed.

## Boundaries that are already decided

- **Editable subset is narrow by design:** description, category, screenshots. Anything that changes which code runs — source, version range, tag prefix — keeps the PR path. `ListingEditableFields` encodes this; don't widen it without a compatibility conversation.
- **v1 stays frozen.** Edits flow into the source model; the build still emits byte-compatible v1 and full v2. No manifest schema change.
- **Validation is shared, not re-implemented.** Reuse the v2 entry schema rather than writing a second validator — the branch this stacks on already has four hand-written copies of the entry shape, and that's a known problem, not a pattern to follow.

## Interaction with the branch below

This subsumes a bug being fixed underneath: `savePluginListingDraft` currently clobbers in-review state and loses PR tracking. Once most edits stop touching PR state, that path narrows to first submissions only. Coordinate before changing lifecycle transitions.

## Suggested first step

Write the spec before the code — the identity decision (who can sign in, what happens when an entry's `author.github` is wrong or absent, what a transfer looks like) drives everything else and is not settled here.

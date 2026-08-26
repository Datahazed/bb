import { z } from "zod";
import {
  marketplaceAuthorEntrySchema,
  type MarketplaceAuthorEntry,
} from "./plugin-marketplace-entry.js";

/** The author-prepared portion of a marketplace v2 entry. */
export const pluginListingDraftEntrySchema = marketplaceAuthorEntrySchema;
export type PluginListingDraftEntry = MarketplaceAuthorEntry;

export const pluginListingMarketplacePullRequestUrlSchema = z
  .url()
  .refine((value) => {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      url.hostname === "github.com" &&
      url.port === "" &&
      url.username === "" &&
      url.password === "" &&
      url.search === "" &&
      url.hash === "" &&
      /^\/get-bb\/marketplace\/pull\/[1-9]\d*\/?$/u.test(url.pathname)
    );
  }, "must be a canonical https://github.com/get-bb/marketplace/pull/<number> URL");

export const pluginListingLifecycleSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("not-published") }),
  z.object({
    status: z.literal("draft"),
    entry: pluginListingDraftEntrySchema,
  }),
  z.object({
    status: z.literal("in-review"),
    entry: pluginListingDraftEntrySchema,
    pullRequest: z.object({
      url: pluginListingMarketplacePullRequestUrlSchema,
      openedAt: z.number().int().nonnegative(),
    }),
  }),
  z.object({
    status: z.literal("published"),
    entryId: z.string().min(1),
    publishedAt: z.number().int().nonnegative(),
  }),
]);
export type PluginListingLifecycle = z.infer<
  typeof pluginListingLifecycleSchema
>;

export const pluginListingRecordSchema = z.object({
  pluginId: z.string().min(1),
  authorship: z.literal("path"),
  lifecycle: pluginListingLifecycleSchema,
});
export type PluginListingRecord = z.infer<typeof pluginListingRecordSchema>;

const listingNoticeBase = {
  id: z.string().min(1),
  pluginId: z.string().min(1),
  pluginName: z.string().min(1),
  createdAt: z.number().int().nonnegative(),
};
export const pluginListingNoticeSchema = z.discriminatedUnion("kind", [
  z.object({ ...listingNoticeBase, kind: z.literal("published") }),
  z.object({
    ...listingNoticeBase,
    kind: z.literal("returned"),
    pullRequestUrl: z.url(),
  }),
]);
export type PluginListingNotice = z.infer<typeof pluginListingNoticeSchema>;

type InReviewLifecycle = Extract<
  PluginListingLifecycle,
  { status: "in-review" }
>;

export class PluginListingDraftConflictError extends Error {
  override readonly name = "PluginListingDraftConflictError";
}

/** Save an author entry as a draft, including published -> fresh-draft edits. */
export function transitionPluginListingDraftSave(args: {
  current: PluginListingLifecycle | undefined;
  pluginId: string;
  entry: PluginListingDraftEntry;
}): PluginListingLifecycle {
  if (args.current?.status === "in-review") {
    throw new PluginListingDraftConflictError(
      `plugin ${JSON.stringify(args.pluginId)} already has a listing in review`,
    );
  }
  return pluginListingLifecycleSchema.parse({
    status: "draft",
    entry: args.entry,
  });
}

/** Record the marketplace pull request for a validated draft. */
export function transitionPluginListingSubmission(args: {
  current: PluginListingLifecycle | undefined;
  pluginId: string;
  pullRequest: InReviewLifecycle["pullRequest"];
}): PluginListingLifecycle {
  if (args.current?.status !== "draft") {
    throw new Error(
      `plugin ${JSON.stringify(args.pluginId)} has no listing draft`,
    );
  }
  return pluginListingLifecycleSchema.parse({
    status: "in-review",
    entry: args.current.entry,
    pullRequest: args.pullRequest,
  });
}

/** Publish a listing accepted into the catalog and create its one-shot notice. */
export function transitionPluginListingPublication(args: {
  current: PluginListingLifecycle | undefined;
  pluginId: string;
  at: number;
  noticeId: string;
}): { lifecycle: PluginListingLifecycle; notice: PluginListingNotice } {
  if (args.current?.status !== "in-review") {
    throw new Error(`plugin ${JSON.stringify(args.pluginId)} is not in review`);
  }
  return {
    lifecycle: pluginListingLifecycleSchema.parse({
      status: "published",
      entryId: args.current.entry.id,
      publishedAt: args.at,
    }),
    notice: pluginListingNoticeSchema.parse({
      id: args.noticeId,
      kind: "published",
      pluginId: args.pluginId,
      pluginName: args.current.entry.displayName,
      createdAt: args.at,
    }),
  };
}

/** Return a closed, unmerged submission to its retained author draft. */
export function transitionPluginListingClosedUnmerged(args: {
  current: PluginListingLifecycle | undefined;
  pluginId: string;
  at: number;
  noticeId: string;
}): { lifecycle: PluginListingLifecycle; notice: PluginListingNotice } {
  if (args.current?.status !== "in-review") {
    throw new Error(`plugin ${JSON.stringify(args.pluginId)} is not in review`);
  }
  return {
    lifecycle: pluginListingLifecycleSchema.parse({
      status: "draft",
      entry: args.current.entry,
    }),
    notice: pluginListingNoticeSchema.parse({
      id: args.noticeId,
      kind: "returned",
      pluginId: args.pluginId,
      pluginName: args.current.entry.displayName,
      pullRequestUrl: args.current.pullRequest.url,
      createdAt: args.at,
    }),
  };
}

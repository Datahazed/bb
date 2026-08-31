import { describe, expect, it } from "vitest";
import {
  PluginListingDraftConflictError,
  pluginListingLifecycleSchema,
  pluginListingMarketplacePullRequestUrlSchema,
  transitionPluginListingClosedUnmerged,
  transitionPluginListingDraftSave,
  transitionPluginListingPublication,
  transitionPluginListingSubmission,
  type PluginListingDraftEntry,
  type PluginListingLifecycle,
} from "../src/plugin-listing-lifecycle.js";

const entry: PluginListingDraftEntry = {
  id: "author-tools",
  displayName: "Author tools",
  description: "Tools for maintaining authored plugins.",
  icon: "Puzzle",
  author: { name: "Author", github: "author" },
  source: {
    git: {
      url: "https://github.com/author/bb-plugin-author-tools.git",
      range: "^1.0.0",
    },
  },
  category: "plugin-development",
  screenshots: [],
};

const inReview: PluginListingLifecycle = {
  status: "in-review",
  entry,
  pullRequest: {
    url: "https://github.com/get-bb/marketplace/pull/42",
    openedAt: 1_000,
  },
};

describe("plugin listing lifecycle", () => {
  it("keeps lifecycle parsing forward tolerant", () => {
    expect(
      pluginListingLifecycleSchema.parse({
        ...inReview,
        futureLifecycleField: true,
        pullRequest: {
          ...inReview.pullRequest,
          futurePullRequestField: true,
        },
      }),
    ).toEqual(inReview);
  });

  it("accepts only canonical BB marketplace pull request URLs", () => {
    expect(
      pluginListingMarketplacePullRequestUrlSchema.safeParse(
        "https://github.com/get-bb/marketplace/pull/42",
      ).success,
    ).toBe(true);
    for (const value of [
      "http://github.com/get-bb/marketplace/pull/42",
      "https://user:secret@github.com/get-bb/marketplace/pull/42",
      "https://github.com/get-bb/marketplace/pull/0",
      "https://github.com/get-bb/marketplace/pull/42?diff=split",
      "https://github.com/another/marketplace/pull/42",
    ]) {
      expect(
        pluginListingMarketplacePullRequestUrlSchema.safeParse(value).success,
      ).toBe(false);
    }
  });

  it("saves a fresh draft unless the listing is already in review", () => {
    expect(
      transitionPluginListingDraftSave({
        current: {
          status: "published",
          entryId: entry.id,
          publishedAt: 500,
        },
        pluginId: entry.id,
        entry,
      }),
    ).toEqual({ status: "draft", entry });

    expect(() =>
      transitionPluginListingDraftSave({
        current: inReview,
        pluginId: entry.id,
        entry,
      }),
    ).toThrow(
      new PluginListingDraftConflictError(
        'plugin "author-tools" already has a listing in review',
      ),
    );
  });

  it("submits only a retained draft", () => {
    expect(
      transitionPluginListingSubmission({
        current: { status: "draft", entry },
        pluginId: entry.id,
        pullRequest: inReview.pullRequest,
      }),
    ).toEqual(inReview);
    expect(() =>
      transitionPluginListingSubmission({
        current: { status: "not-published" },
        pluginId: entry.id,
        pullRequest: inReview.pullRequest,
      }),
    ).toThrow('plugin "author-tools" has no listing draft');
  });

  it("publishes an in-review entry with its one-shot notice", () => {
    expect(
      transitionPluginListingPublication({
        current: inReview,
        pluginId: entry.id,
        at: 2_000,
        noticeId: "pln_published",
      }),
    ).toEqual({
      lifecycle: {
        status: "published",
        entryId: entry.id,
        publishedAt: 2_000,
      },
      notice: {
        id: "pln_published",
        kind: "published",
        pluginId: entry.id,
        pluginName: entry.displayName,
        createdAt: 2_000,
      },
    });
  });

  it("returns a closed-unmerged review to its draft with the PR notice", () => {
    expect(
      transitionPluginListingClosedUnmerged({
        current: inReview,
        pluginId: entry.id,
        at: 2_000,
        noticeId: "pln_returned",
      }),
    ).toEqual({
      lifecycle: { status: "draft", entry },
      notice: {
        id: "pln_returned",
        kind: "returned",
        pluginId: entry.id,
        pluginName: entry.displayName,
        pullRequestUrl: inReview.pullRequest.url,
        createdAt: 2_000,
      },
    });
  });

  it("rejects publication and return after the review state has moved", () => {
    const current: PluginListingLifecycle = { status: "draft", entry };
    expect(() =>
      transitionPluginListingPublication({
        current,
        pluginId: entry.id,
        at: 2_000,
        noticeId: "pln_published",
      }),
    ).toThrow('plugin "author-tools" is not in review');
    expect(() =>
      transitionPluginListingClosedUnmerged({
        current,
        pluginId: entry.id,
        at: 2_000,
        noticeId: "pln_returned",
      }),
    ).toThrow('plugin "author-tools" is not in review');
  });
});

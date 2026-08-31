import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createConnection,
  migrate,
  getPluginListingLifecycle,
  listPluginListingNotices,
  recordPluginListingSubmission,
  returnPluginListingToDraft,
  savePluginListingDraft,
  upsertInstalledPlugin,
  type DbConnection,
} from "@bb/db";
import type { PluginListingDraftEntry } from "@bb/server-contract";
import {
  parseGithubPullRequestUrl,
  reconcilePluginListingLifecycles,
} from "../../../src/services/plugins/plugin-listing-lifecycle.js";

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

describe("plugin listing lifecycle reconciliation", () => {
  let db: DbConnection;

  beforeEach(() => {
    db = createConnection(":memory:");
    migrate(db);
    upsertInstalledPlugin(db, {
      id: entry.id,
      source: "path:/plugins/author-tools",
      provenance: { kind: "direct" },
      sourceIntent: {
        kind: "path",
        canonicalPath: "/plugins/author-tools",
      },
      exactResolution: { kind: "path" },
      updateState: {
        lastCheckAt: null,
        availableCompatibleVersion: null,
        newestIncompatibleVersion: null,
        statusDetail: null,
      },
      activeArtifactId: null,
      rootDir: "/plugins/author-tools",
      version: "1.0.0",
      enabled: true,
    });
    savePluginListingDraft(db, entry.id, entry);
    recordPluginListingSubmission(db, entry.id, {
      url: "https://github.com/get-bb/marketplace/pull/42",
      openedAt: 1_000,
    });
  });

  afterEach(() => db.$client.close());

  it("accepts only canonical credential-free github.com PR URLs", () => {
    expect(
      parseGithubPullRequestUrl(
        "https://github.com/get-bb/marketplace/pull/42",
      ),
    ).toEqual({ owner: "get-bb", repository: "marketplace", number: 42 });
    expect(
      parseGithubPullRequestUrl(
        "https://github.com.evil.test/get-bb/marketplace/pull/42",
      ),
    ).toBeNull();
    expect(
      parseGithubPullRequestUrl(
        "https://user:secret@github.com/get-bb/marketplace/pull/42",
      ),
    ).toBeNull();
    expect(
      parseGithubPullRequestUrl(
        "https://github.com/get-bb/marketplace/pull/42?diff=split",
      ),
    ).toBeNull();
  });

  it("publishes from the explicit catalog acceptance event without polling", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>();
    await expect(
      reconcilePluginListingLifecycles({
        db,
        acceptedEntries: new Map([[entry.id, entry.source]]),
        fetch,
        now: () => 2_000,
      }),
    ).resolves.toBe(true);

    expect(fetch).not.toHaveBeenCalled();
    expect(getPluginListingLifecycle(db, entry.id)).toEqual({
      status: "published",
      entryId: entry.id,
      publishedAt: 2_000,
    });
    expect(listPluginListingNotices(db)).toEqual([
      expect.objectContaining({
        kind: "published",
        pluginId: entry.id,
        pluginName: entry.displayName,
      }),
    ]);
  });

  it("does not publish a catalog entry with the same id and a different source", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
      new Response(JSON.stringify({ state: "open", merged: false }), {
        status: 200,
      }),
    );

    await expect(
      reconcilePluginListingLifecycles({
        db,
        acceptedEntries: new Map([
          [
            entry.id,
            {
              git: {
                url: "https://github.com/someone-else/author-tools.git",
                range: "^1.0.0",
              },
            },
          ],
        ]),
        fetch,
        now: () => 2_000,
      }),
    ).resolves.toBe(false);

    expect(getPluginListingLifecycle(db, entry.id)?.status).toBe("in-review");
    expect(listPluginListingNotices(db)).toEqual([]);
  });

  it("warns instead of rejecting reconciliation when persisted state changed", async () => {
    const warn = vi.fn();
    const acceptedEntries = new Map([[entry.id, entry.source]]);
    vi.spyOn(acceptedEntries, "get").mockImplementationOnce(() => {
      returnPluginListingToDraft(db, entry.id, 1_500);
      return entry.source;
    });

    await expect(
      reconcilePluginListingLifecycles({
        db,
        acceptedEntries,
        fetch: vi.fn<typeof globalThis.fetch>(),
        now: () => 2_000,
        warn,
      }),
    ).resolves.toBe(false);

    expect(warn).toHaveBeenCalledWith(
      `listing publication failed for ${entry.id}: plugin ${JSON.stringify(entry.id)} is not in review`,
    );
    expect(getPluginListingLifecycle(db, entry.id)?.status).toBe("draft");
  });

  it("returns a closed-unmerged PR to draft and creates a one-shot notice", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
      new Response(JSON.stringify({ state: "closed", merged: false }), {
        status: 200,
      }),
    );
    await reconcilePluginListingLifecycles({
      db,
      acceptedEntries: new Map(),
      fetch,
      now: () => 2_000,
    });

    expect(fetch).toHaveBeenCalledWith(
      "https://api.github.com/repos/get-bb/marketplace/pulls/42",
      expect.any(Object),
    );
    expect(getPluginListingLifecycle(db, entry.id)).toEqual({
      status: "draft",
      entry,
    });
    expect(listPluginListingNotices(db)).toEqual([
      expect.objectContaining({
        kind: "returned",
        pullRequestUrl: "https://github.com/get-bb/marketplace/pull/42",
      }),
    ]);
  });

  it("keeps both open and merged PRs in review until the catalog carries the entry", async () => {
    for (const state of [
      { state: "open", merged: false },
      { state: "closed", merged: true },
    ] as const) {
      const fetch = vi
        .fn<typeof globalThis.fetch>()
        .mockResolvedValue(
          new Response(JSON.stringify(state), { status: 200 }),
        );
      await expect(
        reconcilePluginListingLifecycles({
          db,
          acceptedEntries: new Map(),
          fetch,
          now: () => 2_000,
        }),
      ).resolves.toBe(false);
      expect(getPluginListingLifecycle(db, entry.id)?.status).toBe("in-review");
    }
    expect(listPluginListingNotices(db)).toEqual([]);
  });
});

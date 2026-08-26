import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { PluginListingDraftEntry } from "@bb/domain";
import { eq } from "drizzle-orm";
import {
  consumePluginListingNotice,
  ensurePathPluginListingLifecycles,
  getPluginListingLifecycle,
  listPathPluginListingLifecycles,
  listPluginListingNotices,
  publishPluginListing,
  recordPluginListingSubmission,
  returnPluginListingToDraft,
  savePluginListingDraft,
  upsertInstalledPlugin,
  type DbConnection,
} from "../../src/index.js";
import type { UpsertInstalledPluginInput } from "../../src/data/plugins.js";
import { pluginListingLifecycles } from "../../src/schema.js";
import { createMigratedConnection } from "../helpers/migrated-connection.js";

const plugin: UpsertInstalledPluginInput = {
  id: "author-tools",
  source: "path:/plugins/author-tools",
  provenance: { kind: "direct" },
  sourceIntent: { kind: "path", canonicalPath: "/plugins/author-tools" },
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
};

const draft: PluginListingDraftEntry = {
  id: "author-tools",
  displayName: "Author tools",
  description: "Tools for maintaining authored plugins.",
  icon: { url: "./assets/author-tools.svg" },
  author: { name: "Author", github: "author" },
  source: {
    git: {
      url: "https://github.com/author/bb-plugin-author-tools.git",
      range: "^1.0.0",
    },
  },
  tags: ["authoring"],
  category: "plugin-development",
  screenshots: ["./assets/author-tools.png"],
};

describe("plugin listing lifecycle persistence", () => {
  let db: DbConnection;

  beforeEach(() => {
    db = createMigratedConnection();
  });

  afterEach(() => db.$client.close());

  it("materializes path authorship even when the plugin arrives after startup", () => {
    ensurePathPluginListingLifecycles(db);
    expect(listPathPluginListingLifecycles(db)).toEqual([]);

    upsertInstalledPlugin(db, plugin);
    ensurePathPluginListingLifecycles(db);

    expect(listPathPluginListingLifecycles(db)).toEqual([
      {
        pluginId: "author-tools",
        lifecycle: { status: "not-published" },
      },
    ]);
  });

  it("does not claim git, npm, catalog, or builtin installs as authored", () => {
    upsertInstalledPlugin(db, {
      ...plugin,
      id: "remote-tools",
      source: "git:https://github.com/author/remote-tools.git@v1.0.0",
      sourceIntent: {
        kind: "git",
        url: "https://github.com/author/remote-tools.git",
        subdirectory: null,
        selector: { kind: "ref", ref: "v1.0.0", refKind: "tag" },
      },
      exactResolution: {
        kind: "git",
        commit: "0123456789abcdef0123456789abcdef01234567",
      },
    });

    ensurePathPluginListingLifecycles(db);
    expect(listPathPluginListingLifecycles(db)).toEqual([]);
  });

  it("persists only the fields valid for each explicit lifecycle state", () => {
    upsertInstalledPlugin(db, plugin);
    ensurePathPluginListingLifecycles(db);

    expect(savePluginListingDraft(db, plugin.id, draft)).toEqual({
      status: "draft",
      entry: draft,
    });
    expect(
      recordPluginListingSubmission(db, plugin.id, {
        url: "https://github.com/get-bb/marketplace/pull/42",
        openedAt: 1_000,
      }),
    ).toEqual({
      status: "in-review",
      entry: draft,
      pullRequest: {
        url: "https://github.com/get-bb/marketplace/pull/42",
        openedAt: 1_000,
      },
    });

    expect(publishPluginListing(db, plugin.id, 2_000)).toEqual({
      status: "published",
      entryId: "author-tools",
      publishedAt: 2_000,
    });
    expect(getPluginListingLifecycle(db, plugin.id)).toEqual({
      status: "published",
      entryId: "author-tools",
      publishedAt: 2_000,
    });
  });

  it("returns a closed submission to its retained draft and consumes its notice once", () => {
    upsertInstalledPlugin(db, plugin);
    savePluginListingDraft(db, plugin.id, draft);
    recordPluginListingSubmission(db, plugin.id, {
      url: "https://github.com/get-bb/marketplace/pull/42",
      openedAt: 1_000,
    });

    expect(returnPluginListingToDraft(db, plugin.id, 2_000)).toEqual({
      status: "draft",
      entry: draft,
    });
    const notices = listPluginListingNotices(db);
    expect(notices).toHaveLength(1);
    expect(notices[0]).toMatchObject({
      kind: "returned",
      pluginId: "author-tools",
      pullRequestUrl: "https://github.com/get-bb/marketplace/pull/42",
    });
    expect(consumePluginListingNotice(db, notices[0]!.id)).toBe(true);
    expect(consumePluginListingNotice(db, notices[0]!.id)).toBe(false);
    expect(listPluginListingNotices(db)).toEqual([]);
  });

  it("refuses to record a submission without a validated draft", () => {
    upsertInstalledPlugin(db, plugin);
    ensurePathPluginListingLifecycles(db);
    expect(() =>
      recordPluginListingSubmission(db, plugin.id, {
        url: "https://github.com/get-bb/marketplace/pull/42",
        openedAt: 1_000,
      }),
    ).toThrow("has no listing draft");
  });

  it("keeps an in-review submission intact when a draft save is attempted", () => {
    upsertInstalledPlugin(db, plugin);
    savePluginListingDraft(db, plugin.id, draft);
    const inReview = recordPluginListingSubmission(db, plugin.id, {
      url: "https://github.com/get-bb/marketplace/pull/42",
      openedAt: 1_000,
    });

    expect(() =>
      savePluginListingDraft(db, plugin.id, {
        ...draft,
        displayName: "Updated author tools",
      }),
    ).toThrow("already has a listing in review");
    expect(getPluginListingLifecycle(db, plugin.id)).toEqual(inReview);
  });

  it("starts a fresh draft when editing a published listing", () => {
    upsertInstalledPlugin(db, plugin);
    savePluginListingDraft(db, plugin.id, draft);
    recordPluginListingSubmission(db, plugin.id, {
      url: "https://github.com/get-bb/marketplace/pull/42",
      openedAt: 1_000,
    });
    publishPluginListing(db, plugin.id, 2_000);
    const updatedDraft = {
      ...draft,
      displayName: "Updated author tools",
    };

    expect(savePluginListingDraft(db, plugin.id, updatedDraft)).toEqual({
      status: "draft",
      entry: updatedDraft,
    });
    expect(getPluginListingLifecycle(db, plugin.id)).toEqual({
      status: "draft",
      entry: updatedDraft,
    });
  });

  it("fails clearly when persisted lifecycle or notice JSON is malformed", () => {
    upsertInstalledPlugin(db, plugin);
    savePluginListingDraft(db, plugin.id, draft);
    recordPluginListingSubmission(db, plugin.id, {
      url: "https://github.com/get-bb/marketplace/pull/42",
      openedAt: 1_000,
    });
    publishPluginListing(db, plugin.id, 2_000);

    db.update(pluginListingLifecycles)
      .set({
        lifecycleJson: '{"status":"unknown"}',
        noticeJson: '{"kind":"unknown"}',
      })
      .where(eq(pluginListingLifecycles.pluginId, plugin.id))
      .run();

    expect(() => getPluginListingLifecycle(db, plugin.id)).toThrow(
      "invalid persisted plugin listing lifecycle",
    );
    expect(() => listPluginListingNotices(db)).toThrow(
      "invalid persisted plugin listing notice",
    );
  });
});

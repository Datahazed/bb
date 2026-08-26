import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createConnection,
  getPluginListingLifecycle,
  migrate,
  publishPluginListing,
  recordPluginListingSubmission,
  savePluginListingDraft,
  upsertPluginMarketplace,
  upsertInstalledPlugin,
  type DbConnection,
} from "@bb/db";
import type { PluginListingDraftEntry } from "@bb/server-contract";
import { registerPluginListingRoutes } from "../../../src/routes/plugins.js";

const entry = {
  id: "author-tools",
  displayName: "Author tools",
  description: "Tools for maintaining authored plugins.",
  icon: "Toolbox",
  author: { name: "Author", github: "author" },
  source: {
    git: {
      url: "https://github.com/author/author-tools.git",
      range: "^1.0.0",
    },
  },
  category: "plugin-development",
  screenshots: [],
} satisfies PluginListingDraftEntry;

const updateState = {
  lastCheckAt: null,
  availableCompatibleVersion: null,
  newestIncompatibleVersion: null,
  statusDetail: null,
};

function jsonPost(body: unknown, origin?: string): RequestInit {
  return {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(origin === undefined ? {} : { origin }),
    },
    body: JSON.stringify(body),
  };
}

function storeCuratedCatalog(db: DbConnection): void {
  upsertPluginMarketplace(db, {
    name: "bb-community",
    sourceKind: "https",
    manifestUrl: "https://getbb.app/marketplace/v2/marketplace.json",
    sourceGitRef: null,
    sourceGitCommit: null,
    manifestJson: JSON.stringify({
      schemaVersion: 2,
      name: "bb-community",
      displayName: "BB Community",
      newAndNotable: [],
      plugins: [entry],
    }),
    etag: null,
    lastModified: null,
    lastSuccessfulRefreshAt: 1_000,
    lastAttemptedRefreshAt: 1_000,
    lastError: null,
  });
}

describe("plugin listing routes", () => {
  let db: DbConnection;
  let app: Hono;
  const notifySystem = vi.fn();

  beforeEach(() => {
    db = createConnection(":memory:");
    migrate(db);
    app = new Hono();
    registerPluginListingRoutes(app, {
      config: { serverPort: 3334 },
      db,
      hub: { notifySystem },
    });
  });

  afterEach(() => db.$client.close());

  it("lists a path plugin installed after startup without claiming a git install", async () => {
    expect(await (await app.request("/plugin-listings")).json()).toEqual({
      records: [],
      notices: [],
    });
    upsertInstalledPlugin(db, {
      id: entry.id,
      source: "path:/plugins/author-tools",
      provenance: { kind: "direct" },
      sourceIntent: {
        kind: "path",
        canonicalPath: "/plugins/author-tools",
      },
      exactResolution: { kind: "path" },
      updateState,
      activeArtifactId: null,
      rootDir: "/plugins/author-tools",
      version: "1.0.0",
      enabled: true,
    });
    upsertInstalledPlugin(db, {
      id: "remote-tools",
      source: "git:https://github.com/author/remote-tools.git@v1.0.0",
      provenance: { kind: "direct" },
      sourceIntent: {
        kind: "git",
        url: "https://github.com/author/remote-tools.git",
        subdirectory: null,
        selector: { kind: "ref", ref: "v1.0.0", refKind: "tag" },
      },
      exactResolution: { kind: "git", commit: "abcdef1234567" },
      updateState,
      activeArtifactId: null,
      rootDir: "/plugins/remote-tools",
      version: "1.0.0",
      enabled: true,
    });

    expect(await (await app.request("/plugin-listings")).json()).toEqual({
      records: [
        {
          pluginId: entry.id,
          authorship: "path",
          lifecycle: { status: "not-published" },
        },
      ],
      notices: [],
    });
  });

  it("enforces local auth, path authorship, entry identity, and strict v2 validation", async () => {
    upsertInstalledPlugin(db, {
      id: entry.id,
      source: "path:/plugins/author-tools",
      provenance: { kind: "direct" },
      sourceIntent: {
        kind: "path",
        canonicalPath: "/plugins/author-tools",
      },
      exactResolution: { kind: "path" },
      updateState,
      activeArtifactId: null,
      rootDir: "/plugins/author-tools",
      version: "1.0.0",
      enabled: true,
    });

    expect(
      (
        await app.request(
          `/plugins/${entry.id}/listing/draft`,
          jsonPost({ entry }, "https://evil.test"),
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await app.request(
          `/plugins/${entry.id}/listing/draft`,
          jsonPost({ entry: { ...entry, id: "somewhere-else" } }),
        )
      ).status,
    ).toBe(422);
    expect(
      (
        await app.request(
          `/plugins/${entry.id}/listing/draft`,
          jsonPost({ entry: { ...entry, description: "" } }),
        )
      ).status,
    ).toBe(422);
    expect(
      (
        await app.request(
          `/plugins/${entry.id}/listing/draft`,
          jsonPost({ entry: { ...entry, category: "Other" } }),
        )
      ).status,
    ).toBe(422);
    const { screenshots: _screenshots, ...entryWithoutScreenshots } = entry;
    for (const invalidEntry of [
      entryWithoutScreenshots,
      { ...entry, installCount: 0 },
      { ...entry, author: { name: "Author", url: "https://" } },
      {
        ...entry,
        source: {
          npm: { package: "bb-plugin-author-tools", registry: "https://" },
        },
      },
      {
        ...entry,
        source: { git: { url: "https://", range: "^1.0.0" } },
      },
    ]) {
      expect(
        (
          await app.request(
            `/plugins/${entry.id}/listing/draft`,
            jsonPost({ entry: invalidEntry }),
          )
        ).status,
      ).toBe(422);
    }
    expect(
      (
        await app.request(
          "/plugins/not-installed/listing/draft",
          jsonPost({ entry: { ...entry, id: "not-installed" } }),
        )
      ).status,
    ).toBe(403);

    const valid = await app.request(
      `/plugins/${entry.id}/listing/draft`,
      jsonPost({ entry }),
    );
    expect(valid.status).toBe(200);
    expect(await valid.json()).toMatchObject({
      record: { lifecycle: { status: "draft", entry } },
    });
    expect(notifySystem).toHaveBeenCalledWith(["plugins-changed"]);
  });

  it("records only the canonical get-bb/marketplace submission PR", async () => {
    upsertInstalledPlugin(db, {
      id: entry.id,
      source: "path:/plugins/author-tools",
      provenance: { kind: "direct" },
      sourceIntent: {
        kind: "path",
        canonicalPath: "/plugins/author-tools",
      },
      exactResolution: { kind: "path" },
      updateState,
      activeArtifactId: null,
      rootDir: "/plugins/author-tools",
      version: "1.0.0",
      enabled: true,
    });
    await app.request(
      `/plugins/${entry.id}/listing/draft`,
      jsonPost({ entry }),
    );

    expect(
      (
        await app.request(
          `/plugins/${entry.id}/listing/submission`,
          jsonPost({
            pullRequestUrl: "https://github.com/author/repo/pull/42",
            openedAt: 1,
          }),
        )
      ).status,
    ).toBe(422);
    const response = await app.request(
      `/plugins/${entry.id}/listing/submission`,
      jsonPost({
        pullRequestUrl: "https://github.com/get-bb/marketplace/pull/42",
        openedAt: 1,
      }),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      record: {
        lifecycle: {
          status: "in-review",
          pullRequest: {
            url: "https://github.com/get-bb/marketplace/pull/42",
            openedAt: 1,
          },
        },
      },
    });

    const attemptedDraft = await app.request(
      `/plugins/${entry.id}/listing/draft`,
      jsonPost({
        entry: { ...entry, displayName: "Updated author tools" },
      }),
    );
    expect(attemptedDraft.status).toBe(409);
    expect(await attemptedDraft.json()).toEqual({
      error: `plugin ${JSON.stringify(entry.id)} already has a listing in review`,
    });

    const record = await app.request("/plugin-listings");
    expect(await record.json()).toMatchObject({
      records: [
        {
          pluginId: entry.id,
          lifecycle: {
            status: "in-review",
            entry,
            pullRequest: {
              url: "https://github.com/get-bb/marketplace/pull/42",
              openedAt: 1,
            },
          },
        },
      ],
    });
  });

  it("refuses a fresh draft whose id already exists in the curated catalog", async () => {
    upsertInstalledPlugin(db, {
      id: entry.id,
      source: "path:/plugins/author-tools",
      provenance: { kind: "direct" },
      sourceIntent: {
        kind: "path",
        canonicalPath: "/plugins/author-tools",
      },
      exactResolution: { kind: "path" },
      updateState,
      activeArtifactId: null,
      rootDir: "/plugins/author-tools",
      version: "1.0.0",
      enabled: true,
    });
    storeCuratedCatalog(db);

    const response = await app.request(
      `/plugins/${entry.id}/listing/draft`,
      jsonPost({ entry }),
    );

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: `plugin ${JSON.stringify(entry.id)} is already listed in the curated marketplace`,
    });
    expect(getPluginListingLifecycle(db, entry.id)).toBeUndefined();
  });

  it("allows the owner of a published listing to start an edit draft", async () => {
    upsertInstalledPlugin(db, {
      id: entry.id,
      source: "path:/plugins/author-tools",
      provenance: { kind: "direct" },
      sourceIntent: {
        kind: "path",
        canonicalPath: "/plugins/author-tools",
      },
      exactResolution: { kind: "path" },
      updateState,
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
    publishPluginListing(db, entry.id, 2_000);
    storeCuratedCatalog(db);

    const updatedEntry = { ...entry, displayName: "Updated author tools" };
    const response = await app.request(
      `/plugins/${entry.id}/listing/draft`,
      jsonPost({ entry: updatedEntry }),
    );

    expect(response.status).toBe(200);
    expect(getPluginListingLifecycle(db, entry.id)).toEqual({
      status: "draft",
      entry: updatedEntry,
    });
  });
});

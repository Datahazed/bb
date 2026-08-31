import { describe, expect, it } from "vitest";
import {
  installedPluginSchema,
  pluginCatalogInstallRequestSchema,
  pluginCatalogSearchResultSchema,
  pluginCatalogStatusSchema,
  pluginListingListResponseSchema,
  pluginListingMutationResponseSchema,
  pluginListingNoticeConsumeResponseSchema,
  pluginListingRecordSubmissionRequestSchema,
  pluginListingSaveDraftRequestSchema,
} from "../src/index.js";

describe("plugin catalog contracts", () => {
  it("accepts catalog install coordinates without marketplace nesting", () => {
    expect(
      pluginCatalogInstallRequestSchema.parse({
        entryId: "notes",
      }),
    ).toEqual({ entryId: "notes" });
    expect(() =>
      pluginCatalogInstallRequestSchema.parse({
        entryId: "notes",
        version: "1.2.0",
      }),
    ).toThrow();
    expect(() =>
      pluginCatalogInstallRequestSchema.parse({
        marketplace: { marketplaceId: "official", entryId: "notes" },
      }),
    ).toThrow();
  });

  it("keeps status to the bundled plugin count and search fields required", () => {
    const status = {
      pluginCount: 13,
      includedPluginCount: 8,
      optionalPluginCount: 5,
    };
    expect(pluginCatalogStatusSchema.parse(status)).toEqual(status);
    expect(
      pluginCatalogStatusSchema.parse({ ...status, lastError: null }),
    ).toEqual(status);

    expect(() =>
      pluginCatalogSearchResultSchema.parse({
        entryId: "notes",
        displayName: "Notes",
        description: "Notes",
        icon: null,
        category: "Productivity",
        source: "builtin:notes",
        installed: false,
        compatible: true,
        incompatibleReason: null,
      }),
    ).toThrow();
  });

  it("adds discovery fields without breaking older search responses", () => {
    const parsed = pluginCatalogSearchResultSchema.parse({
      entryId: "notes",
      pluginId: "notes",
      displayName: "Notes",
      description: "Notes",
      icon: null,
      iconUrl: null,
      source: "builtin:notes",
      marketplace: "bb-community",
      marketplaceDisplayName: "BB Community",
      publisherKey: "builtin",
      publisherLabel: "BB Official",
      official: true,
      author: null,
      installed: false,
      compatible: true,
      incompatibleReason: null,
    });

    expect(parsed).toMatchObject({ screenshots: [], newAndNotableRank: null });
    expect(parsed).not.toHaveProperty("categoryId");
    expect(parsed).not.toHaveProperty("category");
    expect(parsed).toMatchObject({ installs: null });
    expect(parsed).not.toHaveProperty("installCount");
    expect(parsed).not.toHaveProperty("publishedAt");
    expect(parsed).not.toHaveProperty("updatedAt");
  });

  it("preserves only authoritative catalog discovery statistics", () => {
    const requiredFields = {
      entryId: "notes",
      pluginId: "notes",
      displayName: "Notes",
      description: "Notes",
      icon: null,
      iconUrl: null,
      source: "builtin:notes",
      marketplace: "bb-community",
      marketplaceDisplayName: "BB Community",
      publisherKey: "builtin",
      publisherLabel: "BB Official",
      official: true,
      author: null,
      installed: false,
      compatible: true,
      incompatibleReason: null,
    };
    expect(
      pluginCatalogSearchResultSchema.parse({
        ...requiredFields,
        installs: 0,
        publishedAt: "2026-08-20T09:30:00Z",
        updatedAt: "2026-08-24T16:45:00+02:00",
      }),
    ).toMatchObject({
      installs: 0,
      publishedAt: "2026-08-20T09:30:00Z",
      updatedAt: "2026-08-24T16:45:00+02:00",
    });
    expect(() =>
      pluginCatalogSearchResultSchema.parse({
        ...requiredFields,
        installs: -1,
      }),
    ).toThrow();
    expect(() =>
      pluginCatalogSearchResultSchema.parse({
        ...requiredFields,
        publishedAt: "not-a-date",
      }),
    ).toThrow();
    expect(() =>
      pluginCatalogSearchResultSchema.parse({
        ...requiredFields,
        categoryId: "other",
        category: "Other",
      }),
    ).toThrow();
  });

  it("accepts additive listing response fields while requests stay strict", () => {
    const lifecycle = {
      status: "published" as const,
      entryId: "notes",
      publishedAt: 1,
    };
    const record = {
      pluginId: "notes",
      authorship: "path" as const,
      lifecycle,
    };
    const notice = {
      id: "notice-1",
      pluginId: "notes",
      pluginName: "Notes",
      createdAt: 2,
      kind: "published" as const,
    };

    expect(
      pluginListingListResponseSchema.parse({
        records: [
          {
            ...record,
            lifecycle: { ...lifecycle, futureLifecycleField: true },
            futureRecordField: true,
          },
        ],
        notices: [{ ...notice, futureNoticeField: true }],
        futureResponseField: true,
      }),
    ).toEqual({ records: [record], notices: [notice] });
    expect(
      pluginListingMutationResponseSchema.parse({
        ok: true,
        record: { ...record, futureRecordField: true },
        futureResponseField: true,
      }),
    ).toEqual({ ok: true, record });
    expect(
      pluginListingNoticeConsumeResponseSchema.parse({
        ok: true,
        futureResponseField: true,
      }),
    ).toEqual({ ok: true });

    expect(() =>
      pluginListingSaveDraftRequestSchema.parse({
        entry: {
          id: "notes",
          displayName: "Notes",
          description: "Notes",
          icon: "StickyNote",
          author: { name: "BB" },
          source: { npm: { package: "bb-plugin-notes" } },
          category: "tasks-workflows",
          screenshots: [],
        },
        futureRequestField: true,
      }),
    ).toThrow(/Unrecognized key/u);
    expect(() =>
      pluginListingRecordSubmissionRequestSchema.parse({
        pullRequestUrl: "https://github.com/get-bb/marketplace/pull/1",
        openedAt: 1,
        futureRequestField: true,
      }),
    ).toThrow(/Unrecognized key/u);
  });

  it("keeps installed plugin screenshots required on the shared contract", () => {
    expect(
      installedPluginSchema.shape.screenshots.safeParse(undefined).success,
    ).toBe(false);
  });

  it("preserves the author-only listing draft boundary", () => {
    const entry = {
      id: "author-tools",
      displayName: "  Author tools  ",
      description: "  Tools for authors.  ",
      icon: "Toolbox",
      author: { name: "  Author  " },
      source: {
        git: {
          url: "https://github.com/author/author-tools.git",
          range: "  ^1.0.0  ",
        },
      },
      category: "plugin-development",
      screenshots: [],
    };
    expect(pluginListingSaveDraftRequestSchema.parse({ entry })).toMatchObject({
      entry: {
        displayName: "Author tools",
        description: "Tools for authors.",
        author: { name: "Author" },
        source: { git: { range: "^1.0.0" } },
      },
    });

    const { screenshots: _screenshots, ...withoutScreenshots } = entry;
    for (const invalidEntry of [
      withoutScreenshots,
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
        pluginListingSaveDraftRequestSchema.safeParse({ entry: invalidEntry })
          .success,
      ).toBe(false);
    }
  });
});

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createPluginArtifact,
  deletePluginArtifact,
  deleteInstalledPlugin,
  getInstalledPluginRegistration,
  getInstalledPlugin,
  listPluginArtifacts,
  recordInstalledPluginHandlerError,
  setInstalledPluginLastProblem,
  upsertInstalledPlugin,
  type DbConnection,
} from "../../src/index.js";
import type { UpsertInstalledPluginInput } from "../../src/data/plugins.js";
import { createMigratedConnection } from "../helpers/migrated-connection.js";

describe("normalized plugin persistence", () => {
  let db: DbConnection;

  beforeEach(() => {
    db = createMigratedConnection();
  });

  afterEach(() => db.$client.close());

  it("persists typed plugin intent and an active artifact reference", () => {
    const linearPlugin: UpsertInstalledPluginInput = {
      id: "linear",
      source: "npm:bb-plugin-linear@1.2.3",
      provenance: {
        kind: "catalog",
        marketplace: "bb-community",
        entryId: "linear",
      },
      sourceIntent: {
        kind: "npm",
        packageName: "bb-plugin-linear",
        registry: "https://registry.npmjs.org",
        requestedSpec: "^1.2.0",
        specKind: "range",
      },
      exactResolution: {
        kind: "npm",
        version: "1.2.3",
        integrity: "sha512-example",
      },
      updateState: {
        lastCheckAt: null,
        availableCompatibleVersion: null,
        newestIncompatibleVersion: "2.0.0",
        statusDetail: null,
      },
      activeArtifactId: null,
      rootDir: "/plugins/linear",
      version: "1.2.3",
      enabled: true,
    };
    upsertInstalledPlugin(db, linearPlugin);
    createPluginArtifact(db, {
      id: "artifact-1",
      pluginId: "linear",
      sourceKind: "npm",
      npmResolvedVersion: "1.2.3",
      gitResolvedCommit: null,
      gitCheckoutRoot: null,
      path: "/cache/artifact-1.tgz",
      integrity: "sha512-example",
      contentHash: "sha256-example",
      validationResult: "valid",
      validatedAt: 100,
    });
    upsertInstalledPlugin(db, {
      ...linearPlugin,
      activeArtifactId: "artifact-1",
    });
    expect(getInstalledPlugin(db, "linear")?.rootDir).toBe(
      "/cache/artifact-1.tgz",
    );

    expect(getInstalledPluginRegistration(db, "linear")).toMatchObject({
      provenance: "catalog",
      catalogEntryId: "linear",
      catalogMarketplaceName: "bb-community",
      sourceKind: "npm",
      sourceNpmRequestedSpec: "^1.2.0",
      sourceNpmSpecKind: "range",
      npmResolvedVersion: "1.2.3",
      activeArtifactId: "artifact-1",
    });
    expect(listPluginArtifacts(db, "linear")).toHaveLength(1);
    expect(deletePluginArtifact(db, "artifact-1")).toBe(true);
    expect(getInstalledPluginRegistration(db, "linear")?.activeArtifactId).toBe(
      null,
    );
  });

  it("persists compact runtime health across registration updates", () => {
    const plugin: UpsertInstalledPluginInput = {
      id: "health",
      source: "path:/plugins/health",
      provenance: { kind: "direct" },
      sourceIntent: { kind: "path", canonicalPath: "/plugins/health" },
      exactResolution: { kind: "path" },
      updateState: {
        lastCheckAt: null,
        availableCompatibleVersion: null,
        newestIncompatibleVersion: null,
        statusDetail: null,
      },
      activeArtifactId: null,
      rootDir: "/plugins/health",
      version: "1.0.0",
      enabled: true,
    };
    upsertInstalledPlugin(db, plugin);

    expect(
      recordInstalledPluginHandlerError(db, "health", {
        class: "error",
        message: "first handler failure",
        at: 100,
      }),
    ).toBe(true);
    expect(
      recordInstalledPluginHandlerError(db, "health", {
        class: "error",
        message: "latest handler failure",
        at: 200,
      }),
    ).toBe(true);
    expect(getInstalledPlugin(db, "health")).toMatchObject({
      handlerErrorCount: 2,
      lastProblemClass: "error",
      lastProblemMessage: "latest handler failure",
      lastProblemAt: 200,
    });

    upsertInstalledPlugin(db, { ...plugin, version: "1.0.1" });
    expect(getInstalledPlugin(db, "health")).toMatchObject({
      version: "1.0.1",
      handlerErrorCount: 2,
      lastProblemMessage: "latest handler failure",
    });

    expect(
      setInstalledPluginLastProblem(db, "health", {
        class: "incompatible",
        message: "needs bb <0.39",
        at: 300,
      }),
    ).toBe(true);
    expect(getInstalledPlugin(db, "health")).toMatchObject({
      handlerErrorCount: 2,
      lastProblemClass: "incompatible",
      lastProblemMessage: "needs bb <0.39",
      lastProblemAt: 300,
    });
  });

  it("rejects an npm artifact without registry integrity at runtime", () => {
    const invalidArtifact = {
      id: "artifact-invalid",
      pluginId: "missing",
      sourceKind: "npm",
      npmResolvedVersion: "1.2.3",
      gitResolvedCommit: null,
      path: "/cache/artifact-invalid.tgz",
      integrity: null,
      contentHash: null,
      validationResult: "pending",
      validatedAt: null,
    };
    expect(() =>
      Reflect.apply(createPluginArtifact, undefined, [db, invalidArtifact]),
    ).toThrow(/resolution fields/);
  });

  it("stores a git ref and a git tag range in mutually exclusive columns", () => {
    const common = {
      provenance: { kind: "direct" } as const,
      exactResolution: { kind: "git" as const, commit: "abcdef1234567" },
      updateState: {
        lastCheckAt: null,
        availableCompatibleVersion: null,
        newestIncompatibleVersion: null,
        statusDetail: null,
      },
      activeArtifactId: null,
      rootDir: "/cache/repo/abcdef1234567",
      version: "1.4.2",
      enabled: true,
    };
    upsertInstalledPlugin(db, {
      ...common,
      id: "ranged",
      source: "git:/repo@semver:notes/:^1.0.0",
      sourceIntent: {
        kind: "git",
        url: "/repo",
        subdirectory: "plugins/notes",
        selector: {
          kind: "range",
          range: "^1.0.0",
          tagPrefix: "notes/",
          resolvedTag: "notes/v1.4.2",
        },
      },
    });
    expect(getInstalledPlugin(db, "ranged")).toMatchObject({
      sourceGitRange: "^1.0.0",
      sourceGitTagPrefix: "notes/",
      sourceGitResolvedTag: "notes/v1.4.2",
      sourceGitRequestedRef: null,
      sourceGitRefKind: null,
    });

    upsertInstalledPlugin(db, {
      ...common,
      id: "ranged",
      source: "git:/repo@main",
      sourceIntent: {
        kind: "git",
        url: "/repo",
        subdirectory: "plugins/notes",
        selector: { kind: "ref", ref: "main", refKind: "branch" },
      },
    });
    expect(getInstalledPlugin(db, "ranged")).toMatchObject({
      sourceGitRange: null,
      sourceGitTagPrefix: null,
      sourceGitResolvedTag: null,
      sourceGitRequestedRef: "main",
      sourceGitRefKind: "branch",
    });
  });

  it("retains artifact records when a plugin registration is removed", () => {
    const retainedPlugin: UpsertInstalledPluginInput = {
      id: "retained",
      source: "git:/repo@main",
      provenance: { kind: "direct" },
      sourceIntent: {
        kind: "git",
        url: "/repo",
        subdirectory: null,
        selector: { kind: "ref", ref: "main", refKind: "branch" },
      },
      exactResolution: { kind: "git", commit: "abcdef1234567" },
      updateState: {
        lastCheckAt: null,
        availableCompatibleVersion: null,
        newestIncompatibleVersion: null,
        statusDetail: null,
      },
      activeArtifactId: null,
      rootDir: "/cache/repo/abcdef1234567",
      version: "1.0.0",
      enabled: true,
    };
    upsertInstalledPlugin(db, retainedPlugin);
    createPluginArtifact(db, {
      id: "retained-artifact",
      pluginId: "retained",
      sourceKind: "git",
      npmResolvedVersion: null,
      gitResolvedCommit: "abcdef1234567",
      gitCheckoutRoot: "/cache/repo/abcdef1234567",
      path: "/cache/repo/abcdef1234567",
      integrity: null,
      contentHash: "sha256:retained",
      validationResult: "valid",
      validatedAt: Date.now(),
    });
    upsertInstalledPlugin(db, {
      ...retainedPlugin,
      activeArtifactId: "retained-artifact",
    });

    expect(deleteInstalledPlugin(db, "retained")).toBe(true);
    expect(listPluginArtifacts(db, "retained")).toHaveLength(1);
  });
});

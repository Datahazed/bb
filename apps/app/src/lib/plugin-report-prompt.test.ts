import { describe, expect, it } from "vitest";
import {
  EMPTY_PLUGIN_UPDATE_STATE,
  type PluginListItem,
} from "@/hooks/queries/plugin-settings-queries";
import {
  buildPluginReportToAuthorPrompt,
  installedPluginRepositoryUrl,
} from "./plugin-report-prompt";

const plugin = {
  id: "notify",
  source: "git:https://github.com/acme/bb-notify.git@semver:^1.0.0",
  rootDir: "/plugins/notify",
  version: "1.2.0",
  enabled: true,
  status: "running",
  statusDetail: null,
  lastProblem: {
    class: "error",
    message: "notification handler failed",
    at: Date.UTC(2026, 7, 25, 12, 0, 0),
  },
  categoryId: null,
  category: null,
  description: "Notifies you.",
  name: "Notify",
  icon: null,
  compactIconUrl: null,
  logoUrl: null,
  logoDarkUrl: null,
  hasSettings: false,
  provenance: "direct",
  isOrphanedBuiltin: false,
  catalogEntryId: null,
  publisherLabel: null,
  sourceDisplay: "git · github.com/acme/bb-notify",
  updateState: EMPTY_PLUGIN_UPDATE_STATE,
  handlerStats: { count: 8, totalMs: 20, maxMs: 8, errorCount: 2 },
  services: [],
  schedules: [],
  cliCommand: null,
  capabilities: [],
  app: { hasApp: false, bundle: null },
} satisfies PluginListItem;

describe("plugin report-to-author prompt", () => {
  it("derives a direct git repository without leaking its selector", () => {
    expect(installedPluginRepositoryUrl({ plugin })).toBe(
      "https://github.com/acme/bb-notify.git",
    );
  });

  it("prefers reviewed catalog repository metadata", () => {
    expect(
      installedPluginRepositoryUrl({
        plugin,
        catalogRepositoryUrl: "https://github.com/get-bb/bb-notify",
      }),
    ).toBe("https://github.com/get-bb/bb-notify");
  });

  it("does not treat a catalog package page as an issue repository", () => {
    expect(
      installedPluginRepositoryUrl({
        plugin: { ...plugin, source: "npm:bb-plugin-notify@^1.0.0" },
        catalogRepositoryUrl:
          "https://www.npmjs.com/package/bb-plugin-notify",
      }),
    ).toBeNull();
  });

  it("seeds evidence and an explicit reproduce-before-filing instruction", () => {
    const prompt = buildPluginReportToAuthorPrompt({
      plugin,
      repositoryUrl: "https://github.com/acme/bb-notify",
    });
    expect(prompt).toContain('"Notify" (notify@1.2.0)');
    expect(prompt).toContain("notification handler failed");
    expect(prompt).toContain("Handler errors recorded: 2");
    expect(prompt).toContain("Reproduce the failure and verify the cause");
    expect(prompt).toContain("If it is a plugin issue, file");
  });

  it("has no report prompt without actionable health evidence", () => {
    expect(
      buildPluginReportToAuthorPrompt({
        plugin: { ...plugin, lastProblem: null },
        repositoryUrl: "https://github.com/acme/bb-notify",
      }),
    ).toBeNull();
  });
});

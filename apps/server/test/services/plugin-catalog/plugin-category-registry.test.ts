import {
  PLUGIN_CATALOG_CATEGORY_IDS,
  type PluginCatalogCategoryId,
} from "@bb/server-contract";
import { describe, expect, it } from "vitest";
import {
  marketplaceEntryCategoryId,
  PLUGIN_CATALOG_CATEGORIES,
  REVIEWED_COMMUNITY_ENTRY_CATEGORIES,
} from "../../../src/services/plugin-catalog/plugin-category-registry.js";
import type { MarketplaceEntry } from "../../../src/services/plugin-catalog/marketplace-manifest.js";
import { BUNDLED_PLUGINS } from "../../../src/services/plugins/builtin-registry.js";

const EXPECTED_REVIEWED_ENTRY_IDS_BY_CATEGORY = {
  "themes-and-appearance": [
    "ayu",
    "monokai",
    "fonts",
    "pets",
    "theme-toggle",
    "tokyo-night",
    "ui-tweaks",
  ],
  "thread-lists-and-navigation": [
    "arc-switcher",
    "cascade",
    "gtd-sidebar",
    "t3sidebar",
    "thread-namer",
    "tinted-threads",
    "bb-sidebar",
    "copy-session-id",
    "sidebar-filter",
    "thread-provider-icons",
  ],
  "thread-messages-and-timelines": [
    "bb-better-latex",
    "emoji-react",
    "image-preview",
    "message-timestamps",
    "bb-rpiv-todo-renderer",
    "session-notes",
    "sticky-notes",
  ],
  "composer-and-prompts": [
    "dispatch",
    "prompt-enhancer",
    "prompts",
    "rephrase",
  ],
  "memory-and-context": ["noema", "progressive-skill", "project-instructions"],
  "agent-tools": ["advisor", "noisegate", "perspectives", "rtk", "unslop"],
  security: ["security-guidance"],
  "agents-and-providers": [
    "agent-proxy",
    "amp",
    "handoff",
    "autorouter",
    "bots",
    "provider-authentication",
  ],
  "token-usage-and-cost": [
    "context-meter",
    "headroom",
    "lanes",
    "usage-page",
    "usage-tracker",
    "usage",
    "provider-usage",
    "usage-meter",
  ],
  "notifications-and-attention": [
    "chime",
    "attention",
    "notify",
    "ntfy",
    "web-push-notify",
  ],
  "code-and-reviews": [
    "callstack",
    "dependabot",
    "gh-stack",
    "gitlab",
    "slopcop",
    "git-history",
    "repo-watch",
  ],
  "files-and-viewers": ["monaco", "audio-preview", "pdf-viewer"],
  "machines-and-hosts": [
    "disk-usage",
    "floating-terminal",
    "worktree-setup",
    "wterm-terminal-preview",
    "file-manager",
    "ports",
    "server-status",
  ],
  "plugin-development": [
    "agentation",
    "agentation-mentions",
    "bb-ui-reference",
    "traces",
  ],
  "task-tracking": ["agent-checklists", "taskboard"],
  automation: ["global-workflows", "auto-archive"],
} as const satisfies Record<PluginCatalogCategoryId, readonly string[]>;

const REVIEWED_ENTRY_IDS = Object.values(
  EXPECTED_REVIEWED_ENTRY_IDS_BY_CATEGORY,
).flat();

function entry(
  id: string,
  category?: MarketplaceEntry["category"],
): MarketplaceEntry {
  return {
    id,
    displayName: id,
    description: id,
    icon: "Zap",
    ...(category === undefined ? {} : { category }),
    author: { name: "Test" },
    source: { npm: { package: `bb-plugin-${id}` } },
  };
}

describe("plugin category registry", () => {
  it("keeps the sixteen reviewed stable ids and display names together", () => {
    expect(PLUGIN_CATALOG_CATEGORIES.map((category) => category.id)).toEqual(
      PLUGIN_CATALOG_CATEGORY_IDS,
    );
    expect(
      PLUGIN_CATALOG_CATEGORIES.map((category) => category.displayName),
    ).toEqual([
      "Themes & Appearance",
      "Thread Lists & Navigation",
      "Thread Messages & Timelines",
      "Composer & Prompts",
      "Memory & Context",
      "Agent Tools",
      "Security",
      "Agents & Providers",
      "Token Usage & Cost",
      "Notifications & Attention",
      "Code & Reviews",
      "Files & Viewers",
      "Machines & Hosts",
      "Plugin Development",
      "Task Tracking",
      "Automation",
    ]);
  });

  it("records the confirmed 81-entry community publisher handoff", () => {
    expect(Object.keys(REVIEWED_COMMUNITY_ENTRY_CATEGORIES).sort()).toEqual(
      [...REVIEWED_ENTRY_IDS].sort(),
    );
    expect(REVIEWED_ENTRY_IDS).toHaveLength(81);
    expect(new Set(REVIEWED_ENTRY_IDS).size).toBe(81);
    for (const [category, ids] of Object.entries(
      EXPECTED_REVIEWED_ENTRY_IDS_BY_CATEGORY,
    )) {
      for (const id of ids) {
        expect(REVIEWED_COMMUNITY_ENTRY_CATEGORIES[id]).toBe(category);
      }
    }
  });

  it("uses v2 declarations and preserves category absence for v1", () => {
    expect(
      marketplaceEntryCategoryId({
        schemaVersion: 2,
        entry: entry("later-entry", "security"),
      }),
    ).toBe("security");
    expect(
      marketplaceEntryCategoryId({
        schemaVersion: 1,
        entry: entry("later-entry"),
      }),
    ).toBeUndefined();
    expect(
      marketplaceEntryCategoryId({
        schemaVersion: 1,
        entry: entry("advisor", "agent-tools"),
      }),
    ).toBeUndefined();
  });

  it("files every bundled plugin under one reviewed category", () => {
    const validIds = new Set(PLUGIN_CATALOG_CATEGORY_IDS);
    expect(BUNDLED_PLUGINS).not.toHaveLength(0);
    for (const plugin of BUNDLED_PLUGINS) {
      expect(validIds.has(plugin.category)).toBe(true);
    }
  });
});

// @vitest-environment jsdom

import { createStore } from "jotai";
import { afterEach, describe, expect, it, vi } from "vitest";

const LEGACY_EXTENSIONS_NAV_ROW_KEY = "__builtin__/tools";
const LEGACY_HIDDEN_PLUGIN_NAV_PANELS_STORAGE_KEY =
  "bb.sidebar.hiddenPluginPanels";
const SIDEBAR_EXTENSIONS_VISIBLE_STORAGE_KEY = "bb.sidebar.extensionsVisible";

class MemoryStorage {
  readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}

function seedLegacyHiddenKeys(
  storage: MemoryStorage,
  keys: readonly unknown[],
): void {
  storage.setItem(
    LEGACY_HIDDEN_PLUGIN_NAV_PANELS_STORAGE_KEY,
    JSON.stringify(keys),
  );
}

function runPhaseThreePluginPageMigration(storage: MemoryStorage): void {
  const value = storage.getItem(LEGACY_HIDDEN_PLUGIN_NAV_PANELS_STORAGE_KEY);
  if (value === null) return;
  const parsed: unknown = JSON.parse(value);
  if (!Array.isArray(parsed)) return;
  storage.setItem(
    LEGACY_HIDDEN_PLUGIN_NAV_PANELS_STORAGE_KEY,
    JSON.stringify(
      parsed.filter(
        (key) => typeof key === "string" && key.startsWith("__builtin__/"),
      ),
    ),
  );
}

afterEach(() => {
  window.localStorage.clear();
  vi.resetModules();
});

describe("top-region sidebar item preferences", () => {
  it("defaults both fixed rows on for a fresh install", async () => {
    const { sidebarExtensionsVisibleAtom, sidebarNewThreadVisibleAtom } =
      await import("./sidebarTopRegionItemPreferences");
    const store = createStore();

    expect(store.get(sidebarNewThreadVisibleAtom)).toBe(true);
    expect(store.get(sidebarExtensionsVisibleAtom)).toBe(true);
  });

  it("synchronously keeps legacy-hidden Extensions off and clears only its key", async () => {
    window.localStorage.setItem(
      LEGACY_HIDDEN_PLUGIN_NAV_PANELS_STORAGE_KEY,
      JSON.stringify([
        "docs/main",
        LEGACY_EXTENSIONS_NAV_ROW_KEY,
        "github/main",
      ]),
    );

    const { sidebarExtensionsVisibleAtom } =
      await import("./sidebarTopRegionItemPreferences");
    const store = createStore();

    expect(store.get(sidebarExtensionsVisibleAtom)).toBe(false);
    expect(
      window.localStorage.getItem(SIDEBAR_EXTENSIONS_VISIBLE_STORAGE_KEY),
    ).toBe("false");
    expect(
      JSON.parse(
        window.localStorage.getItem(
          LEGACY_HIDDEN_PLUGIN_NAV_PANELS_STORAGE_KEY,
        ) ?? "[]",
      ),
    ).toEqual(["docs/main", "github/main"]);
  });

  it.each(["toggles-first", "plugins-first"] as const)(
    "composes with the plugin-page migration when %s",
    async (order) => {
      const { migrateLegacyHiddenExtensions } =
        await import("./sidebarTopRegionItemPreferences");
      const storage = new MemoryStorage();
      seedLegacyHiddenKeys(storage, [
        "docs/main",
        LEGACY_EXTENSIONS_NAV_ROW_KEY,
        "github/main",
      ]);

      if (order === "toggles-first") {
        expect(migrateLegacyHiddenExtensions(storage)).toBe(false);
        expect(
          JSON.parse(
            storage.getItem(LEGACY_HIDDEN_PLUGIN_NAV_PANELS_STORAGE_KEY) ??
              "[]",
          ),
        ).toEqual(["docs/main", "github/main"]);
        runPhaseThreePluginPageMigration(storage);
      } else {
        runPhaseThreePluginPageMigration(storage);
        expect(
          JSON.parse(
            storage.getItem(LEGACY_HIDDEN_PLUGIN_NAV_PANELS_STORAGE_KEY) ??
              "[]",
          ),
        ).toEqual([LEGACY_EXTENSIONS_NAV_ROW_KEY]);
        expect(migrateLegacyHiddenExtensions(storage)).toBe(false);
      }

      expect(
        JSON.parse(
          storage.getItem(LEGACY_HIDDEN_PLUGIN_NAV_PANELS_STORAGE_KEY) ?? "[]",
        ),
      ).toEqual([]);
      expect(storage.getItem(SIDEBAR_EXTENSIONS_VISIBLE_STORAGE_KEY)).toBe(
        "false",
      );
    },
  );

  it("is idempotent and preserves an existing explicit preference", async () => {
    const { migrateLegacyHiddenExtensions } =
      await import("./sidebarTopRegionItemPreferences");
    const storage = new MemoryStorage();
    storage.setItem(SIDEBAR_EXTENSIONS_VISIBLE_STORAGE_KEY, "true");
    seedLegacyHiddenKeys(storage, [
      LEGACY_EXTENSIONS_NAV_ROW_KEY,
      "docs/main",
      LEGACY_EXTENSIONS_NAV_ROW_KEY,
    ]);

    expect(migrateLegacyHiddenExtensions(storage)).toBe(true);
    expect(migrateLegacyHiddenExtensions(storage)).toBe(true);
    expect(storage.getItem(SIDEBAR_EXTENSIONS_VISIBLE_STORAGE_KEY)).toBe(
      "true",
    );
    expect(
      JSON.parse(
        storage.getItem(LEGACY_HIDDEN_PLUGIN_NAV_PANELS_STORAGE_KEY) ?? "[]",
      ),
    ).toEqual(["docs/main"]);
  });

  it("leaves malformed legacy storage untouched instead of deleting unowned data", async () => {
    const { migrateLegacyHiddenExtensions } =
      await import("./sidebarTopRegionItemPreferences");
    const storage = new MemoryStorage();
    storage.setItem(
      LEGACY_HIDDEN_PLUGIN_NAV_PANELS_STORAGE_KEY,
      "not valid json",
    );

    expect(migrateLegacyHiddenExtensions(storage)).toBe(true);
    expect(storage.getItem(LEGACY_HIDDEN_PLUGIN_NAV_PANELS_STORAGE_KEY)).toBe(
      "not valid json",
    );
    expect(storage.getItem(SIDEBAR_EXTENSIONS_VISIBLE_STORAGE_KEY)).toBeNull();
  });
});

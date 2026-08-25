import { describe, expect, it } from "vitest";
import {
  HIDDEN_PLUGIN_NAV_PANELS_STORAGE_KEY,
  PLUGIN_NAV_PANEL_ORDER_STORAGE_KEY,
} from "./pluginNavSidebarAtoms";
import {
  HIDDEN_PLUGIN_NAV_PANELS_MIGRATION_STORAGE_KEY,
  migrateHiddenPluginNavPanels,
} from "./pluginNavSidebarMigration";

class MemoryStorage {
  readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}

class SerializedLockManager {
  private tail = Promise.resolve();

  request<T>(_name: string, callback: () => Promise<T>): Promise<T> {
    const result = this.tail.then(callback);
    this.tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
}

const registrationOrder = [
  "docs/main",
  "github/main",
  "tasks/main",
  "notes/main",
];

describe("migrateHiddenPluginNavPanels", () => {
  it("appends legacy hidden pages in registration order and clears hiding", async () => {
    const storage = new MemoryStorage();
    storage.setItem(
      PLUGIN_NAV_PANEL_ORDER_STORAGE_KEY,
      JSON.stringify(["tasks/main", "docs/main", "github/main"]),
    );
    storage.setItem(
      HIDDEN_PLUGIN_NAV_PANELS_STORAGE_KEY,
      JSON.stringify(["tasks/main", "github/main"]),
    );

    await expect(
      migrateHiddenPluginNavPanels({
        storage,
        registrationOrder,
        lockManager: null,
      }),
    ).resolves.toEqual([
      "docs/main",
      "notes/main",
      "github/main",
      "tasks/main",
    ]);
    expect(storage.getItem(HIDDEN_PLUGIN_NAV_PANELS_STORAGE_KEY)).toBe("[]");
    expect(
      storage.getItem(HIDDEN_PLUGIN_NAV_PANELS_MIGRATION_STORAGE_KEY),
    ).toBe("1");
  });

  it("never re-demotes a migrated page that the user moved to the top", async () => {
    const storage = new MemoryStorage();
    storage.setItem(
      HIDDEN_PLUGIN_NAV_PANELS_STORAGE_KEY,
      JSON.stringify(["tasks/main"]),
    );
    await migrateHiddenPluginNavPanels({
      storage,
      registrationOrder,
      lockManager: null,
    });
    storage.setItem(
      PLUGIN_NAV_PANEL_ORDER_STORAGE_KEY,
      JSON.stringify(["tasks/main", "docs/main", "github/main", "notes/main"]),
    );
    storage.setItem(
      HIDDEN_PLUGIN_NAV_PANELS_STORAGE_KEY,
      JSON.stringify(["tasks/main"]),
    );

    await expect(
      migrateHiddenPluginNavPanels({
        storage,
        registrationOrder,
        lockManager: null,
      }),
    ).resolves.toEqual([
      "tasks/main",
      "docs/main",
      "github/main",
      "notes/main",
    ]);
    expect(storage.getItem(HIDDEN_PLUGIN_NAV_PANELS_STORAGE_KEY)).toBe("[]");
  });

  it("serializes concurrent windows and dedupes the order on read", async () => {
    const storage = new MemoryStorage();
    const lockManager = new SerializedLockManager();
    storage.setItem(
      PLUGIN_NAV_PANEL_ORDER_STORAGE_KEY,
      JSON.stringify(["docs/main", "docs/main", "tasks/main"]),
    );
    storage.setItem(
      HIDDEN_PLUGIN_NAV_PANELS_STORAGE_KEY,
      JSON.stringify(["tasks/main"]),
    );

    const [first, second] = await Promise.all([
      migrateHiddenPluginNavPanels({ storage, registrationOrder, lockManager }),
      migrateHiddenPluginNavPanels({ storage, registrationOrder, lockManager }),
    ]);
    expect(first).toEqual([
      "docs/main",
      "github/main",
      "notes/main",
      "tasks/main",
    ]);
    expect(second).toEqual(first);
    expect(
      JSON.parse(storage.getItem(PLUGIN_NAV_PANEL_ORDER_STORAGE_KEY) ?? "[]"),
    ).toEqual(first);
  });
});

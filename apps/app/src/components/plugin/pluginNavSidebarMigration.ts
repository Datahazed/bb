import {
  HIDDEN_PLUGIN_NAV_PANELS_STORAGE_KEY,
  PLUGIN_NAV_PANEL_ORDER_STORAGE_KEY,
} from "./pluginNavSidebarAtoms";
import { normalizePluginNavPanelOrder } from "./pluginNavSidebarOrder";

export const HIDDEN_PLUGIN_NAV_PANELS_MIGRATION_STORAGE_KEY =
  "bb.sidebar.hiddenPluginPanelsMigrated.v1";
const HIDDEN_PLUGIN_NAV_PANELS_MIGRATION_LOCK =
  "bb.sidebar.hiddenPluginPanelsMigration.v1";
const MIGRATION_COMPLETE = "1";

interface PluginNavPanelMigrationStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

interface PluginNavPanelMigrationLockManager {
  request<T>(name: string, callback: () => Promise<T>): Promise<T>;
}

interface MigrateHiddenPluginNavPanelsArgs {
  storage: PluginNavPanelMigrationStorage;
  registrationOrder: readonly string[];
  lockManager?: PluginNavPanelMigrationLockManager | null;
}

function readStoredKeys(
  storage: PluginNavPanelMigrationStorage,
  key: string,
): string[] {
  const value = storage.getItem(key);
  if (value === null) return [];
  try {
    return normalizePluginNavPanelOrder(JSON.parse(value));
  } catch {
    return [];
  }
}

function migrateUnderLock(
  storage: PluginNavPanelMigrationStorage,
  registrationOrderValue: readonly string[],
): string[] {
  const registrationOrder = normalizePluginNavPanelOrder(
    registrationOrderValue,
  );
  const currentOrder = normalizePluginNavPanelOrder([
    ...readStoredKeys(storage, PLUGIN_NAV_PANEL_ORDER_STORAGE_KEY),
    ...registrationOrder,
  ]);

  if (
    storage.getItem(HIDDEN_PLUGIN_NAV_PANELS_MIGRATION_STORAGE_KEY) ===
    MIGRATION_COMPLETE
  ) {
    storage.setItem(HIDDEN_PLUGIN_NAV_PANELS_STORAGE_KEY, "[]");
    return currentOrder;
  }

  const hiddenKeys = readStoredKeys(
    storage,
    HIDDEN_PLUGIN_NAV_PANELS_STORAGE_KEY,
  );
  const hiddenSet = new Set(hiddenKeys);
  const nextOrder = [
    ...currentOrder.filter((key) => !hiddenSet.has(key)),
    ...registrationOrder.filter((key) => hiddenSet.has(key)),
    ...hiddenKeys.filter((key) => !registrationOrder.includes(key)),
  ];
  const normalizedOrder = normalizePluginNavPanelOrder(nextOrder);

  storage.setItem(
    PLUGIN_NAV_PANEL_ORDER_STORAGE_KEY,
    JSON.stringify(normalizedOrder),
  );
  storage.setItem(
    HIDDEN_PLUGIN_NAV_PANELS_MIGRATION_STORAGE_KEY,
    MIGRATION_COMPLETE,
  );
  storage.setItem(HIDDEN_PLUGIN_NAV_PANELS_STORAGE_KEY, "[]");
  return normalizedOrder;
}

export async function migrateHiddenPluginNavPanels({
  storage,
  registrationOrder,
  lockManager = typeof navigator === "undefined"
    ? null
    : ((navigator.locks as PluginNavPanelMigrationLockManager | undefined) ??
      null),
}: MigrateHiddenPluginNavPanelsArgs): Promise<string[]> {
  if (lockManager === null) {
    return migrateUnderLock(storage, registrationOrder);
  }
  return lockManager.request(
    HIDDEN_PLUGIN_NAV_PANELS_MIGRATION_LOCK,
    async () => migrateUnderLock(storage, registrationOrder),
  );
}

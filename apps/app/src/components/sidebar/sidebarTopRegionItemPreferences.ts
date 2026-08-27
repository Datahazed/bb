import { atomWithStorage } from "jotai/utils";
import {
  createJsonLocalStorage,
  type SyncStorage,
} from "@/lib/browser-storage";
import { AUTOMATIONS_PLUGIN_ID } from "@/lib/route-paths";

export const SIDEBAR_TOP_REGION_ITEMS_STORAGE_KEY = "bb.sidebar.topRegionItems";
export const LEGACY_NEW_THREAD_VISIBLE_STORAGE_KEY =
  "bb.sidebar.newThreadVisible";
export const LEGACY_EXTENSIONS_VISIBLE_STORAGE_KEY =
  "bb.sidebar.extensionsVisible";
export const LEGACY_HIDDEN_PLUGIN_NAV_PANELS_STORAGE_KEY =
  "bb.sidebar.hiddenPluginPanels";
export const LEGACY_EXTENSIONS_NAV_ROW_KEY = "__builtin__/tools";

export const SIDEBAR_TOP_REGION_ITEM_IDS = [
  "new-thread",
  "extensions",
  "automations",
] as const;

export type SidebarTopRegionItemId =
  (typeof SIDEBAR_TOP_REGION_ITEM_IDS)[number];

export interface SidebarTopRegionItemPreferences {
  order: SidebarTopRegionItemId[];
  hiddenIds: SidebarTopRegionItemId[];
}

export const DEFAULT_SIDEBAR_TOP_REGION_ITEM_PREFERENCES: SidebarTopRegionItemPreferences =
  {
    order: [...SIDEBAR_TOP_REGION_ITEM_IDS],
    hiddenIds: [],
  };

interface SidebarItemMigrationStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function isSidebarTopRegionItemId(
  value: unknown,
): value is SidebarTopRegionItemId {
  return SIDEBAR_TOP_REGION_ITEM_IDS.some((id) => id === value);
}

function normalizeIds(value: unknown): SidebarTopRegionItemId[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter(isSidebarTopRegionItemId))];
}

export function normalizeSidebarTopRegionItemPreferences(
  value: unknown,
): SidebarTopRegionItemPreferences {
  const candidate =
    typeof value === "object" && value !== null
      ? (value as { order?: unknown; hiddenIds?: unknown })
      : {};
  const presentOrder = normalizeIds(candidate.order);
  const order = [
    ...presentOrder,
    ...SIDEBAR_TOP_REGION_ITEM_IDS.filter((id) => !presentOrder.includes(id)),
  ];
  const hiddenIds = normalizeIds(candidate.hiddenIds).filter((id) =>
    order.includes(id),
  );
  return { order, hiddenIds };
}

function readJson(storage: SidebarItemMigrationStorage, key: string): unknown {
  const value = storage.getItem(key);
  if (value === null) return undefined;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return undefined;
  }
}

function readStoredBoolean(
  storage: SidebarItemMigrationStorage,
  key: string,
): boolean | null {
  const value = readJson(storage, key);
  return typeof value === "boolean" ? value : null;
}

function readLegacyHiddenKeys(
  storage: SidebarItemMigrationStorage,
): unknown[] | null {
  const value = readJson(storage, LEGACY_HIDDEN_PLUGIN_NAV_PANELS_STORAGE_KEY);
  return Array.isArray(value) ? value : null;
}

function isLegacyAutomationsPanelKey(value: unknown): value is string {
  return (
    typeof value === "string" && value.startsWith(`${AUTOMATIONS_PLUGIN_ID}/`)
  );
}

function consumeOwnedLegacyHiddenKeys(
  storage: SidebarItemMigrationStorage,
  legacyHiddenKeys: readonly unknown[] | null,
): void {
  if (legacyHiddenKeys === null) return;
  const remaining = legacyHiddenKeys.filter(
    (key) =>
      key !== LEGACY_EXTENSIONS_NAV_ROW_KEY &&
      !isLegacyAutomationsPanelKey(key),
  );
  if (remaining.length === 0) {
    storage.removeItem(LEGACY_HIDDEN_PLUGIN_NAV_PANELS_STORAGE_KEY);
  } else {
    storage.setItem(
      LEGACY_HIDDEN_PLUGIN_NAV_PANELS_STORAGE_KEY,
      JSON.stringify(remaining),
    );
  }
}

function consumeLegacyBooleanPreferences(
  storage: SidebarItemMigrationStorage,
): void {
  storage.removeItem(LEGACY_NEW_THREAD_VISIBLE_STORAGE_KEY);
  storage.removeItem(LEGACY_EXTENSIONS_VISIBLE_STORAGE_KEY);
}

/**
 * Moves the stack's two booleans and the shipped plugin-hide choices into the
 * one top-region preference. The combined value wins once it exists, while
 * owned legacy keys are still consumed so the plugin-page migration cannot
 * reintroduce Automations as a traditional row.
 */
export function migrateLegacySidebarTopRegionItems(
  storage: SidebarItemMigrationStorage,
): SidebarTopRegionItemPreferences {
  const legacyHiddenKeys = readLegacyHiddenKeys(storage);
  const storedValue = readJson(storage, SIDEBAR_TOP_REGION_ITEMS_STORAGE_KEY);
  if (storedValue !== undefined) {
    const normalized = normalizeSidebarTopRegionItemPreferences(storedValue);
    storage.setItem(
      SIDEBAR_TOP_REGION_ITEMS_STORAGE_KEY,
      JSON.stringify(normalized),
    );
    consumeOwnedLegacyHiddenKeys(storage, legacyHiddenKeys);
    consumeLegacyBooleanPreferences(storage);
    return normalized;
  }

  const hiddenIds: SidebarTopRegionItemId[] = [];
  if (
    readStoredBoolean(storage, LEGACY_NEW_THREAD_VISIBLE_STORAGE_KEY) === false
  ) {
    hiddenIds.push("new-thread");
  }
  if (
    readStoredBoolean(storage, LEGACY_EXTENSIONS_VISIBLE_STORAGE_KEY) ===
      false ||
    legacyHiddenKeys?.includes(LEGACY_EXTENSIONS_NAV_ROW_KEY)
  ) {
    hiddenIds.push("extensions");
  }
  if (legacyHiddenKeys?.some(isLegacyAutomationsPanelKey)) {
    hiddenIds.push("automations");
  }

  const migrated = normalizeSidebarTopRegionItemPreferences({
    order: SIDEBAR_TOP_REGION_ITEM_IDS,
    hiddenIds,
  });
  storage.setItem(
    SIDEBAR_TOP_REGION_ITEMS_STORAGE_KEY,
    JSON.stringify(migrated),
  );
  consumeOwnedLegacyHiddenKeys(storage, legacyHiddenKeys);
  consumeLegacyBooleanPreferences(storage);
  return migrated;
}

export function reorderSidebarTopRegionItems(
  current: SidebarTopRegionItemPreferences,
  activeId: SidebarTopRegionItemId,
  overId: SidebarTopRegionItemId,
): SidebarTopRegionItemPreferences {
  const activeIndex = current.order.indexOf(activeId);
  const overIndex = current.order.indexOf(overId);
  if (activeIndex === -1 || overIndex === -1 || activeIndex === overIndex) {
    return current;
  }
  const order = [...current.order];
  const [moved] = order.splice(activeIndex, 1);
  if (moved === undefined) return current;
  order.splice(overIndex, 0, moved);
  return { ...current, order };
}

export function setSidebarTopRegionItemVisible(
  current: SidebarTopRegionItemPreferences,
  id: SidebarTopRegionItemId,
  visible: boolean,
): SidebarTopRegionItemPreferences {
  const hiddenIds = visible
    ? current.hiddenIds.filter((candidate) => candidate !== id)
    : [...new Set([...current.hiddenIds, id])];
  return { ...current, hiddenIds };
}

const jsonStorage = createJsonLocalStorage<unknown>();
const topRegionItemStorage: SyncStorage<SidebarTopRegionItemPreferences> = {
  getItem: (_key, initialValue) => {
    if (typeof window === "undefined") return initialValue;
    return migrateLegacySidebarTopRegionItems(window.localStorage);
  },
  setItem: (key, value) => {
    jsonStorage.setItem(key, normalizeSidebarTopRegionItemPreferences(value));
  },
  removeItem: jsonStorage.removeItem,
  subscribe: (key, callback, initialValue) =>
    jsonStorage.subscribe?.(
      key,
      (value) => callback(normalizeSidebarTopRegionItemPreferences(value)),
      initialValue,
    ),
};

export const sidebarTopRegionItemPreferencesAtom =
  atomWithStorage<SidebarTopRegionItemPreferences>(
    SIDEBAR_TOP_REGION_ITEMS_STORAGE_KEY,
    DEFAULT_SIDEBAR_TOP_REGION_ITEM_PREFERENCES,
    topRegionItemStorage,
    { getOnInit: true },
  );

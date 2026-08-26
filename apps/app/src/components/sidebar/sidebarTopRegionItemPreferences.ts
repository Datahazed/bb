import { atomWithStorage } from "jotai/utils";
import {
  createJsonLocalStorage,
  type SyncStorage,
} from "@/lib/browser-storage";

export const SIDEBAR_NEW_THREAD_VISIBLE_STORAGE_KEY =
  "bb.sidebar.newThreadVisible";
export const SIDEBAR_EXTENSIONS_VISIBLE_STORAGE_KEY =
  "bb.sidebar.extensionsVisible";
export const LEGACY_HIDDEN_PLUGIN_NAV_PANELS_STORAGE_KEY =
  "bb.sidebar.hiddenPluginPanels";
export const LEGACY_EXTENSIONS_NAV_ROW_KEY = "__builtin__/tools";

interface SidebarItemMigrationStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function readStoredBoolean(
  storage: SidebarItemMigrationStorage,
  key: string,
): boolean | null {
  const value = storage.getItem(key);
  if (value === null) return null;
  try {
    const parsed: unknown = JSON.parse(value);
    return typeof parsed === "boolean" ? parsed : null;
  } catch {
    return null;
  }
}

function readLegacyHiddenKeys(
  storage: SidebarItemMigrationStorage,
): unknown[] | null {
  const value = storage.getItem(LEGACY_HIDDEN_PLUGIN_NAV_PANELS_STORAGE_KEY);
  if (value === null) return null;
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Migrates only the host-owned Extensions row from the legacy plugin hide set.
 *
 * The migration deliberately has no completion marker. Removing the owned key
 * is the marker, which makes partial reruns safe and lets this cleanup compose
 * with the plugin-page migration whichever one observes the shared array first.
 */
export function migrateLegacyHiddenExtensions(
  storage: SidebarItemMigrationStorage,
): boolean {
  const storedPreference = readStoredBoolean(
    storage,
    SIDEBAR_EXTENSIONS_VISIBLE_STORAGE_KEY,
  );
  const legacyHiddenKeys = readLegacyHiddenKeys(storage);
  if (
    legacyHiddenKeys === null ||
    !legacyHiddenKeys.includes(LEGACY_EXTENSIONS_NAV_ROW_KEY)
  ) {
    return storedPreference ?? true;
  }

  const extensionsVisible = storedPreference ?? false;
  // Write the replacement preference before consuming the legacy key so a
  // partially completed rerun cannot reset a previously hidden Extensions row.
  if (storedPreference === null) {
    storage.setItem(
      SIDEBAR_EXTENSIONS_VISIBLE_STORAGE_KEY,
      JSON.stringify(extensionsVisible),
    );
  }
  storage.setItem(
    LEGACY_HIDDEN_PLUGIN_NAV_PANELS_STORAGE_KEY,
    JSON.stringify(
      legacyHiddenKeys.filter((key) => key !== LEGACY_EXTENSIONS_NAV_ROW_KEY),
    ),
  );
  return extensionsVisible;
}

const jsonBooleanStorage = createJsonLocalStorage<unknown>();
const normalizedBooleanStorage: SyncStorage<boolean> = {
  getItem: (key, initialValue) => {
    const value = jsonBooleanStorage.getItem(key, initialValue);
    return typeof value === "boolean" ? value : initialValue;
  },
  setItem: (key, value) => {
    jsonBooleanStorage.setItem(key, value);
  },
  removeItem: (key) => {
    jsonBooleanStorage.removeItem(key);
  },
  subscribe: (key, callback, initialValue) =>
    jsonBooleanStorage.subscribe?.(
      key,
      (value) => callback(typeof value === "boolean" ? value : initialValue),
      initialValue,
    ),
};

const extensionsVisibilityStorage: SyncStorage<boolean> = {
  getItem: (_key, _initialValue) => {
    if (typeof window === "undefined") return true;
    return migrateLegacyHiddenExtensions(window.localStorage);
  },
  setItem: normalizedBooleanStorage.setItem,
  removeItem: normalizedBooleanStorage.removeItem,
  subscribe: normalizedBooleanStorage.subscribe,
};

export const sidebarNewThreadVisibleAtom = atomWithStorage<boolean>(
  SIDEBAR_NEW_THREAD_VISIBLE_STORAGE_KEY,
  true,
  normalizedBooleanStorage,
  { getOnInit: true },
);

export const sidebarExtensionsVisibleAtom = atomWithStorage<boolean>(
  SIDEBAR_EXTENSIONS_VISIBLE_STORAGE_KEY,
  true,
  extensionsVisibilityStorage,
  { getOnInit: true },
);

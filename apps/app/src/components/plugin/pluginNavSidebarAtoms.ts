import { atomWithStorage } from "jotai/utils";
import {
  createJsonLocalStorage,
  type SyncStorage,
} from "@/lib/browser-storage";
import { AUTOMATIONS_PLUGIN_ID } from "@/lib/route-paths";
import { migrateLegacyHiddenPluginNavPanelOrder } from "./pluginNavSidebarOrder";

const PLUGIN_NAV_PANEL_ORDER_STORAGE_KEY = "bb.sidebar.pluginPanelOrder";
const HIDDEN_PLUGIN_NAV_PANELS_STORAGE_KEY = "bb.sidebar.hiddenPluginPanels";

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [
    ...new Set(
      value.filter((item): item is string => typeof item === "string"),
    ),
  ];
}

function isAutomationsPanelKey(key: string): boolean {
  return key.startsWith(`${AUTOMATIONS_PLUGIN_ID}/`);
}

function preserveLegacyAutomationsHiddenKeys(
  storage: SyncStorage<unknown>,
  hiddenKeys: readonly string[],
): void {
  const automationsKeys = hiddenKeys.filter(isAutomationsPanelKey);
  if (automationsKeys.length === 0) {
    storage.removeItem(HIDDEN_PLUGIN_NAV_PANELS_STORAGE_KEY);
  } else {
    // The later top-region preference layer translates this legacy choice to
    // its host-owned Automations visibility. Do not erase it while migrating
    // traditional plugin rows to positional overflow.
    storage.setItem(HIDDEN_PLUGIN_NAV_PANELS_STORAGE_KEY, automationsKeys);
  }
}

function createPluginNavPanelOrderStorage(): SyncStorage<string[]> {
  const storage = createJsonLocalStorage<unknown>();
  return {
    getItem(key, initialValue) {
      const order = normalizeStringArray(storage.getItem(key, initialValue));
      const legacyHidden = normalizeStringArray(
        storage.getItem(HIDDEN_PLUGIN_NAV_PANELS_STORAGE_KEY, []),
      );
      const traditionalHidden = legacyHidden.filter(
        (panelKey) => !isAutomationsPanelKey(panelKey),
      );
      if (traditionalHidden.length === 0) return order;

      const migrated = migrateLegacyHiddenPluginNavPanelOrder(
        order,
        traditionalHidden,
      );
      storage.setItem(key, migrated);
      preserveLegacyAutomationsHiddenKeys(storage, legacyHidden);
      return migrated;
    },
    setItem(key, value) {
      storage.setItem(key, normalizeStringArray(value));
      const legacyHidden = normalizeStringArray(
        storage.getItem(HIDDEN_PLUGIN_NAV_PANELS_STORAGE_KEY, []),
      );
      preserveLegacyAutomationsHiddenKeys(storage, legacyHidden);
    },
    removeItem(key) {
      storage.removeItem(key);
      const legacyHidden = normalizeStringArray(
        storage.getItem(HIDDEN_PLUGIN_NAV_PANELS_STORAGE_KEY, []),
      );
      preserveLegacyAutomationsHiddenKeys(storage, legacyHidden);
    },
    subscribe: (key, callback, initialValue) =>
      storage.subscribe?.(
        key,
        (value) => callback(normalizeStringArray(value)),
        initialValue,
      ),
  };
}

/**
 * User-chosen order of traditional plugin panel rows, as
 * `<pluginId>/<panelId>` keys. Positions 0–4 render above the overflow and all
 * later positions render below it. Empty until the registry first normalizes
 * the order. Client-local, like the other sidebar layout preferences.
 */
export const pluginNavPanelOrderAtom = atomWithStorage<string[]>(
  PLUGIN_NAV_PANEL_ORDER_STORAGE_KEY,
  [],
  createPluginNavPanelOrderStorage(),
  { getOnInit: true },
);

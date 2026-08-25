import { atomWithStorage } from "jotai/utils";
import {
  createBooleanPreferenceAtom,
  createJsonLocalStorage,
  type SyncStorage,
} from "@/lib/browser-storage";
import { normalizePluginNavPanelOrder } from "./pluginNavSidebarOrder";

export const PLUGIN_NAV_PANEL_ORDER_STORAGE_KEY = "bb.sidebar.pluginPanelOrder";
export const HIDDEN_PLUGIN_NAV_PANELS_STORAGE_KEY =
  "bb.sidebar.hiddenPluginPanels";
export const PLUGIN_NAV_PANEL_OVERFLOW_EXPANDED_STORAGE_KEY =
  "bb.sidebar.pluginPanelOverflowExpanded";

const jsonStringArrayStorage = createJsonLocalStorage<unknown>();
const normalizedStringArrayStorage: SyncStorage<string[]> = {
  getItem: (key, initialValue) =>
    normalizePluginNavPanelOrder(
      jsonStringArrayStorage.getItem(key, initialValue),
    ),
  setItem: (key, value) => {
    jsonStringArrayStorage.setItem(key, normalizePluginNavPanelOrder(value));
  },
  removeItem: (key) => {
    jsonStringArrayStorage.removeItem(key);
  },
  subscribe: (key, callback, initialValue) =>
    jsonStringArrayStorage.subscribe?.(
      key,
      (value) => callback(normalizePluginNavPanelOrder(value)),
      initialValue,
    ),
};

/**
 * User-chosen order of every sidebar plugin panel row, as
 * `<pluginId>/<panelId>` keys. Reads dedupe malformed stored values so two
 * windows cannot make one panel render twice. Empty means registry order.
 */
export const pluginNavPanelOrderAtom = atomWithStorage<string[]>(
  PLUGIN_NAV_PANEL_ORDER_STORAGE_KEY,
  [],
  normalizedStringArrayStorage,
  { getOnInit: true },
);

/**
 * Legacy hidden page keys. Phase 3 reads this atom only to migrate those pages
 * to the end of the one order, then clears it.
 */
export const hiddenPluginNavPanelsAtom = atomWithStorage<string[]>(
  HIDDEN_PLUGIN_NAV_PANELS_STORAGE_KEY,
  [],
  normalizedStringArrayStorage,
  { getOnInit: true },
);

export const pluginNavPanelOverflowExpandedAtom = createBooleanPreferenceAtom(
  PLUGIN_NAV_PANEL_OVERFLOW_EXPANDED_STORAGE_KEY,
  false,
);

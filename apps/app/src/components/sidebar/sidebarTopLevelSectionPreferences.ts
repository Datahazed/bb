import { atomWithStorage } from "jotai/utils";
import {
  createJsonLocalStorage,
  type SyncStorage,
} from "@/lib/browser-storage";

export const SIDEBAR_TOP_LEVEL_SECTION_IDS = [
  "new-thread-extensions",
  "plugin-pages",
  "thread-list",
] as const;

export type SidebarTopLevelSectionId =
  (typeof SIDEBAR_TOP_LEVEL_SECTION_IDS)[number];

export interface SidebarTopLevelSectionDefinition {
  id: SidebarTopLevelSectionId;
  label: string;
  hideable: boolean;
}

export const SIDEBAR_TOP_LEVEL_SECTION_DEFINITIONS = [
  {
    id: "new-thread-extensions",
    label: "New thread / Extensions",
    hideable: true,
  },
  { id: "plugin-pages", label: "Plugin pages", hideable: true },
  { id: "thread-list", label: "Thread list", hideable: false },
] as const satisfies readonly SidebarTopLevelSectionDefinition[];

const SIDEBAR_TOP_LEVEL_SECTION_ORDER_STORAGE_KEY =
  "bb.sidebar.topLevelSectionOrder";
const HIDDEN_SIDEBAR_TOP_LEVEL_SECTIONS_STORAGE_KEY =
  "bb.sidebar.hiddenTopLevelSections";

const SIDEBAR_TOP_LEVEL_SECTION_ID_SET = new Set<string>(
  SIDEBAR_TOP_LEVEL_SECTION_IDS,
);
const HIDEABLE_SIDEBAR_TOP_LEVEL_SECTION_ID_SET = new Set<string>(
  SIDEBAR_TOP_LEVEL_SECTION_DEFINITIONS.filter(
    (section) => section.hideable,
  ).map((section) => section.id),
);

function isSidebarTopLevelSectionId(
  value: unknown,
): value is SidebarTopLevelSectionId {
  return (
    typeof value === "string" && SIDEBAR_TOP_LEVEL_SECTION_ID_SET.has(value)
  );
}

export function normalizeSidebarTopLevelSectionOrder(
  value: unknown,
): SidebarTopLevelSectionId[] {
  const normalized: SidebarTopLevelSectionId[] = [];
  const seen = new Set<SidebarTopLevelSectionId>();
  if (Array.isArray(value)) {
    for (const item of value) {
      if (!isSidebarTopLevelSectionId(item) || seen.has(item)) continue;
      seen.add(item);
      normalized.push(item);
    }
  }
  for (const id of SIDEBAR_TOP_LEVEL_SECTION_IDS) {
    if (seen.has(id)) continue;
    normalized.push(id);
  }
  return normalized;
}

export function normalizeHiddenSidebarTopLevelSectionIds(
  value: unknown,
): SidebarTopLevelSectionId[] {
  if (!Array.isArray(value)) return [];
  const normalized: SidebarTopLevelSectionId[] = [];
  const seen = new Set<SidebarTopLevelSectionId>();
  for (const item of value) {
    if (
      !isSidebarTopLevelSectionId(item) ||
      !HIDEABLE_SIDEBAR_TOP_LEVEL_SECTION_ID_SET.has(item) ||
      seen.has(item)
    ) {
      continue;
    }
    seen.add(item);
    normalized.push(item);
  }
  return normalized;
}

export function moveSidebarTopLevelSection(
  value: unknown,
  id: SidebarTopLevelSectionId,
  offset: -1 | 1,
): SidebarTopLevelSectionId[] {
  const order = normalizeSidebarTopLevelSectionOrder(value);
  const from = order.indexOf(id);
  const to = from + offset;
  if (from === -1 || to < 0 || to >= order.length) return order;
  const next = [...order];
  next.splice(from, 1);
  next.splice(to, 0, id);
  return next;
}

export function setSidebarTopLevelSectionHidden(
  value: unknown,
  id: SidebarTopLevelSectionId,
  hidden: boolean,
): SidebarTopLevelSectionId[] {
  const current = normalizeHiddenSidebarTopLevelSectionIds(value);
  if (!HIDEABLE_SIDEBAR_TOP_LEVEL_SECTION_ID_SET.has(id)) return current;
  if (hidden) {
    return current.includes(id) ? current : [...current, id];
  }
  return current.filter((sectionId) => sectionId !== id);
}

function createNormalizedSectionStorage(
  normalize: (value: unknown) => SidebarTopLevelSectionId[],
): SyncStorage<SidebarTopLevelSectionId[]> {
  const storage = createJsonLocalStorage<unknown>();
  return {
    getItem: (key, initialValue) =>
      normalize(storage.getItem(key, initialValue)),
    setItem: (key, value) => storage.setItem(key, normalize(value)),
    removeItem: storage.removeItem,
    subscribe: (key, callback, initialValue) =>
      storage.subscribe?.(
        key,
        (value) => callback(normalize(value)),
        initialValue,
      ),
  };
}

export const sidebarTopLevelSectionOrderAtom = atomWithStorage<
  SidebarTopLevelSectionId[]
>(
  SIDEBAR_TOP_LEVEL_SECTION_ORDER_STORAGE_KEY,
  [...SIDEBAR_TOP_LEVEL_SECTION_IDS],
  createNormalizedSectionStorage(normalizeSidebarTopLevelSectionOrder),
  { getOnInit: true },
);

export const hiddenSidebarTopLevelSectionIdsAtom = atomWithStorage<
  SidebarTopLevelSectionId[]
>(
  HIDDEN_SIDEBAR_TOP_LEVEL_SECTIONS_STORAGE_KEY,
  [],
  createNormalizedSectionStorage(normalizeHiddenSidebarTopLevelSectionIds),
  { getOnInit: true },
);

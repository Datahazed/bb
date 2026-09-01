import { atomWithStorage } from "jotai/utils";
import {
  createJsonLocalStorage,
  type SyncStorage,
} from "@/lib/browser-storage";

export const SIDEBAR_REGION_ORDER_STORAGE_KEY =
  "bb.sidebar.topLevelSectionOrder";

export const SIDEBAR_REGION_IDS = [
  "bb-controls",
  "plugins",
  "threads",
] as const;

const SIDEBAR_REORDERABLE_REGION_IDS = ["bb-controls", "plugins"] as const;

export type SidebarRegionId = (typeof SIDEBAR_REGION_IDS)[number];

const LEGACY_SECTION_ID_BY_REGION: Readonly<Record<SidebarRegionId, string>> = {
  "bb-controls": "new-thread-extensions",
  plugins: "plugin-pages",
  threads: "thread-list",
};

const REGION_BY_LEGACY_SECTION_ID: Readonly<
  Partial<Record<string, SidebarRegionId>>
> = {
  "new-thread-extensions": "bb-controls",
  "plugin-pages": "plugins",
  "thread-list": "threads",
};

export const DEFAULT_SIDEBAR_REGION_ORDER: SidebarRegionId[] = [
  ...SIDEBAR_REGION_IDS,
];

function isSidebarRegionId(value: unknown): value is SidebarRegionId {
  return SIDEBAR_REGION_IDS.some((id) => id === value);
}

function toSidebarRegionId(value: unknown): SidebarRegionId | null {
  if (isSidebarRegionId(value)) return value;
  if (typeof value !== "string") return null;
  return REGION_BY_LEGACY_SECTION_ID[value] ?? null;
}

export function normalizeSidebarRegionOrder(value: unknown): SidebarRegionId[] {
  const presentOrder: SidebarRegionId[] = [];
  if (Array.isArray(value)) {
    for (const candidate of value) {
      const id = toSidebarRegionId(candidate);
      if (id !== null && id !== "threads" && !presentOrder.includes(id)) {
        presentOrder.push(id);
      }
    }
  }
  return [
    ...presentOrder,
    ...SIDEBAR_REORDERABLE_REGION_IDS.filter(
      (id) => !presentOrder.includes(id),
    ),
    "threads",
  ];
}

export function reorderSidebarRegions(
  current: readonly SidebarRegionId[],
  activeId: SidebarRegionId,
  overId: SidebarRegionId,
): SidebarRegionId[] {
  const normalized = normalizeSidebarRegionOrder(current);
  if (activeId === "threads" || overId === "threads") return normalized;
  const activeIndex = normalized.indexOf(activeId);
  const overIndex = normalized.indexOf(overId);
  if (activeIndex === -1 || overIndex === -1 || activeIndex === overIndex) {
    return normalized;
  }

  const order = [...normalized];
  const [moved] = order.splice(activeIndex, 1);
  if (moved === undefined) return normalized;
  order.splice(overIndex, 0, moved);
  return order;
}

const jsonStorage = createJsonLocalStorage<unknown>();
function serializeRegionOrder(value: unknown): string[] {
  return normalizeSidebarRegionOrder(value).map(
    (id) => LEGACY_SECTION_ID_BY_REGION[id],
  );
}

const regionOrderStorage: SyncStorage<SidebarRegionId[]> = {
  getItem: (key, initialValue) => {
    const order = normalizeSidebarRegionOrder(
      jsonStorage.getItem(key, initialValue),
    );
    jsonStorage.setItem(key, serializeRegionOrder(order));
    return order;
  },
  setItem: (key, value) => {
    jsonStorage.setItem(key, serializeRegionOrder(value));
  },
  removeItem: jsonStorage.removeItem,
  subscribe: (key, callback, initialValue) =>
    jsonStorage.subscribe?.(
      key,
      (value) => callback(normalizeSidebarRegionOrder(value)),
      initialValue,
    ),
};

export const sidebarRegionOrderAtom = atomWithStorage<SidebarRegionId[]>(
  SIDEBAR_REGION_ORDER_STORAGE_KEY,
  DEFAULT_SIDEBAR_REGION_ORDER,
  regionOrderStorage,
  { getOnInit: true },
);

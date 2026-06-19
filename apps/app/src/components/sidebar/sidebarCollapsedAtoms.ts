import { atomWithStorage } from "jotai/utils";
import { createJsonLocalStorage } from "@/lib/browser-storage";

const COLLAPSED_PROJECTS_STORAGE_KEY = "bb.sidebar.collapsedProjects";
const COLLAPSED_THREADS_STORAGE_KEY = "bb.sidebar.collapsedThreads";
const COLLAPSED_ENVIRONMENTS_STORAGE_KEY = "bb.sidebar.collapsedEnvironments";
const COLLAPSED_SIDEBAR_SECTIONS_STORAGE_KEY = "bb.sidebar.collapsedSections";
const SIDEBAR_SECTION_ORDER_STORAGE_KEY = "bb.sidebar.sectionOrder";
const ORGANIZATION_MODE_STORAGE_KEY = "bb.sidebar.organizationMode";
const CHRONOLOGICAL_SORT_STORAGE_KEY = "bb.sidebar.chronologicalSort";
const GROUP_BY_STORAGE_KEY = "bb.sidebar.groupBy";
const COLLAPSED_FOLDERS_STORAGE_KEY = "bb.sidebar.collapsedFolders";
const FOLDER_ONBOARDING_SEEN_STORAGE_KEY = "bb.sidebar.folderOnboardingSeen";
const MANUAL_ORDER_STORAGE_KEY = "bb.sidebar.manualOrder";

export type SidebarSectionId = "pinned" | "projects" | "threads";
export type CollapsibleSidebarSectionId = "projects" | "threads";

// "project" keeps the per-project grouping; "chronological" flattens every
// non-pinned thread into a single All Threads bucket.
export type SidebarOrganizationMode = "project" | "chronological";
// Controls thread ordering in both grouped and ungrouped sidebar views.
// "updated" reuses the status-aware activity heuristic; "created" sorts by
// the literal createdAt field; "none" applies the user's local manual order.
export type SidebarChronologicalSort = "updated" | "created" | "none";
// Whether "/" in a thread title renders as nested folders. Orthogonal to the
// organization mode and sort: "none" keeps today's flat behavior (literal
// titles), "folder" buckets top-level threads into derived folders.
export type SidebarGroupBy = "none" | "folder";
// Per-parent manual order for Sort: None. Keys are section/folder parent keys;
// values are child thread ids and child folder keys.
export type SidebarManualOrder = Record<string, string[]>;

export const DEFAULT_SIDEBAR_SECTION_ORDER: readonly SidebarSectionId[] = [
  "pinned",
  "projects",
  "threads",
];

export const collapsedProjectIdsAtom = atomWithStorage<string[]>(
  COLLAPSED_PROJECTS_STORAGE_KEY,
  [],
  createJsonLocalStorage<string[]>(),
  { getOnInit: true },
);

export const collapsedThreadIdsAtom = atomWithStorage<string[]>(
  COLLAPSED_THREADS_STORAGE_KEY,
  [],
  createJsonLocalStorage<string[]>(),
  { getOnInit: true },
);

export const collapsedEnvironmentIdsAtom = atomWithStorage<string[]>(
  COLLAPSED_ENVIRONMENTS_STORAGE_KEY,
  [],
  createJsonLocalStorage<string[]>(),
  { getOnInit: true },
);

export const collapsedSidebarSectionIdsAtom = atomWithStorage<
  CollapsibleSidebarSectionId[]
>(
  COLLAPSED_SIDEBAR_SECTIONS_STORAGE_KEY,
  [],
  createJsonLocalStorage<CollapsibleSidebarSectionId[]>(),
  { getOnInit: true },
);

export const sidebarSectionOrderAtom = atomWithStorage<SidebarSectionId[]>(
  SIDEBAR_SECTION_ORDER_STORAGE_KEY,
  [...DEFAULT_SIDEBAR_SECTION_ORDER],
  createJsonLocalStorage<SidebarSectionId[]>(),
  { getOnInit: true },
);

export const sidebarOrganizationModeAtom =
  atomWithStorage<SidebarOrganizationMode>(
    ORGANIZATION_MODE_STORAGE_KEY,
    "project",
    createJsonLocalStorage<SidebarOrganizationMode>(),
    { getOnInit: true },
  );

export const sidebarChronologicalSortAtom =
  atomWithStorage<SidebarChronologicalSort>(
    CHRONOLOGICAL_SORT_STORAGE_KEY,
    "updated",
    createJsonLocalStorage<SidebarChronologicalSort>(),
    { getOnInit: true },
  );

// Opt-in folder grouping. Default "none" keeps the current sidebar layout.
export const sidebarGroupByAtom = atomWithStorage<SidebarGroupBy>(
  GROUP_BY_STORAGE_KEY,
  "none",
  createJsonLocalStorage<SidebarGroupBy>(),
  { getOnInit: true },
);

// Collapsed folder keys (see buildFolderKey in folderPath.ts). A plain
// string[], matching collapsedThreadIds / collapsedProjectIds.
export const sidebarCollapsedFoldersAtom = atomWithStorage<string[]>(
  COLLAPSED_FOLDERS_STORAGE_KEY,
  [],
  createJsonLocalStorage<string[]>(),
  { getOnInit: true },
);

// Whether the first-folder onboarding modal has been accepted. Set on accept
// (not on open), so a declined modal still teaches on a later attempt.
export const folderOnboardingSeenAtom = atomWithStorage<boolean>(
  FOLDER_ONBOARDING_SEEN_STORAGE_KEY,
  false,
  createJsonLocalStorage<boolean>(),
  { getOnInit: true },
);

export const sidebarManualOrderAtom = atomWithStorage<SidebarManualOrder>(
  MANUAL_ORDER_STORAGE_KEY,
  {},
  createJsonLocalStorage<SidebarManualOrder>(),
  { getOnInit: true },
);

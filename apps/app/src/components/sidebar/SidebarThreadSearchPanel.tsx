import { useEffect, useMemo } from "react";
import type { ThreadListEntry } from "@bb/domain";
import type { ThreadSearchMatch } from "@bb/server-contract";
import { CHROME_SECTION_LABEL_CLASS } from "@bb/shared-ui/chrome-style-tokens";
import {
  COARSE_POINTER_TEXT_SM_CLASS,
  COARSE_POINTER_ICON_SIZE_CLASS,
} from "@bb/shared-ui/coarse-pointer-sizing";
import { Icon, type IconName } from "@bb/shared-ui/icon";
import { Button } from "@bb/shared-ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@bb/shared-ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@bb/shared-ui/tooltip";
import { useThreadSearch } from "@/hooks/queries/thread-queries";
import { hasThreadSearchableQuery } from "@/hooks/queries/thread-queries";
import {
  useNewThreadDraftSlots,
  type NewThreadDraftRow,
} from "@/hooks/useNewThreadDraftSlots";
import { cn } from "@bb/shared-ui/lib/utils";
import {
  getSidebarDraftSearchMatch,
  getSidebarThreadSearchOptionId,
  isSidebarThreadTitleMatch,
  SIDEBAR_THREAD_SEARCH_LISTBOX_ID,
  SIDEBAR_THREAD_SEARCH_LIFECYCLE_STATES,
  type SidebarThreadSearchNavigationItem,
  type SidebarThreadSearchLifecycleCounts,
  type SidebarThreadSearchLifecycleFilterController,
  type SidebarThreadSearchLifecycleState,
  useSidebarThreadSearchLifecycleFilter,
} from "./sidebarThreadSearch";
import {
  DraftSearchResultRow,
  ThreadSearchResultRow,
} from "./ThreadSearchResultRow";

interface SidebarThreadSearchPanelProps {
  activeIndex: number;
  sectionNamesById?: ReadonlyMap<string, string>;
  isRecentsLoading: boolean;
  onActiveIndexChange: (index: number) => void;
  onNavigationItemsChange: (
    items: readonly SidebarThreadSearchNavigationItem[],
  ) => void;
  onSelect: (item: SidebarThreadSearchNavigationItem) => void;
  projectNamesById: ReadonlyMap<string, string>;
  query: string;
  recentArchivedThreads?: readonly ThreadListEntry[];
  recentThreads: readonly ThreadListEntry[];
  lifecycleFilter?: SidebarThreadSearchLifecycleFilterController;
  showSectionLabels?: boolean;
}

interface ThreadSearchRenderableThreadRow {
  kind: "thread";
  id: string;
  matches: readonly ThreadSearchMatch[];
  thread: ThreadListEntry;
}

interface ThreadSearchRenderableDraftRow {
  kind: "draft";
  draft: NewThreadDraftRow;
  id: string;
  matches: ThreadSearchMatch["highlightRanges"];
  primaryText: string;
}

type ThreadSearchRenderableRow =
  | ThreadSearchRenderableThreadRow
  | ThreadSearchRenderableDraftRow;

interface ThreadSearchSection {
  id: SidebarThreadSearchLifecycleState;
  label: string;
  rows: readonly ThreadSearchRenderableRow[];
  total: number;
}

interface ThreadSearchMessageProps {
  iconName: IconName;
  isLoading?: boolean;
  text: string;
}

const RECENT_THREAD_LIMIT = 20;
const EMPTY_MATCHES: readonly ThreadSearchMatch[] = [];
const EMPTY_SECTION_NAMES_BY_ID = new Map<string, string>();
// The message (non-title) match drives the deep-link target. Mirrors the row's
// snippet selection so clicking a result lands on the message shown in the row.
function getMessageMatchSeq(
  matches: readonly ThreadSearchMatch[],
): number | null {
  for (const match of matches) {
    if (!isSidebarThreadTitleMatch(match) && match.sourceSeq !== null) {
      return match.sourceSeq;
    }
  }
  return null;
}

function toNavigationItem(
  row: ThreadSearchRenderableRow,
): SidebarThreadSearchNavigationItem {
  if (row.kind === "draft") {
    return {
      kind: "draft",
      draftSlotId: row.draft.id,
      id: row.id,
      optionId: getSidebarThreadSearchOptionId(row.id),
    };
  }
  return {
    kind: "thread",
    id: row.id,
    optionId: getSidebarThreadSearchOptionId(row.id),
    projectId: row.thread.projectId,
    threadId: row.thread.id,
    messageSeq: getMessageMatchSeq(row.matches),
  };
}

const LIFECYCLE_STATE_LABELS: Record<
  SidebarThreadSearchLifecycleState,
  string
> = {
  active: "Threads",
  drafts: "Drafts",
  archived: "Archived threads",
};

export function SidebarThreadSearchShowMenu({
  lifecycleFilter,
}: {
  lifecycleFilter: SidebarThreadSearchLifecycleFilterController;
}) {
  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              size="icon"
              variant="ghost"
              aria-label={`Search show options${lifecycleFilter.isFiltered ? " (filtered)" : ""}`}
              className="relative h-6 w-6 shrink-0 rounded-md p-0 text-muted-foreground ring-sidebar-ring hover:bg-sidebar-border/60 hover:text-sidebar-foreground focus-visible:ring-2 max-md:pointer-coarse:h-8 max-md:pointer-coarse:w-8"
            >
              <Icon
                name="SlidersHorizontal"
                className="size-3.5 max-md:pointer-coarse:size-5"
              />
              {lifecycleFilter.isFiltered ? (
                <span
                  aria-hidden="true"
                  className="absolute right-0.5 top-0.5 size-1.5 rounded-full bg-primary"
                />
              ) : null}
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="px-2 py-1">
          Show search results
        </TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="end" mobileTitle="Search show options">
        <DropdownMenuLabel className={CHROME_SECTION_LABEL_CLASS}>
          Show
        </DropdownMenuLabel>
        <DropdownMenuGroup aria-label="Show search results">
          {SIDEBAR_THREAD_SEARCH_LIFECYCLE_STATES.map((state) => {
            const isSelected = lifecycleFilter.selectedStates.includes(state);
            return (
              <DropdownMenuCheckboxItem
                key={state}
                checked={isSelected}
                onCheckedChange={(checked) =>
                  lifecycleFilter.onStateCheckedChange(state, checked)
                }
              >
                <span>{LIFECYCLE_STATE_LABELS[state]}</span>
                <span className="ml-auto pl-4 text-xs tabular-nums text-muted-foreground">
                  {lifecycleFilter.counts[state]}
                </span>
              </DropdownMenuCheckboxItem>
            );
          })}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function ThreadSearchMessage({
  iconName,
  isLoading = false,
  text,
}: ThreadSearchMessageProps) {
  return (
    <div
      className={cn(
        "flex items-center gap-2 px-3 py-2 text-muted-foreground",
        COARSE_POINTER_TEXT_SM_CLASS,
      )}
    >
      <Icon
        name={iconName}
        className={cn(
          COARSE_POINTER_ICON_SIZE_CLASS,
          isLoading && "animate-spin",
        )}
      />
      <span>{text}</span>
    </div>
  );
}

function renderSectionRows({
  activeIndex,
  sectionNamesById,
  onActiveIndexChange,
  onSelect,
  projectNamesById,
  section,
  showSectionLabels,
  startIndex,
}: {
  activeIndex: number;
  sectionNamesById: ReadonlyMap<string, string>;
  onActiveIndexChange: (index: number) => void;
  onSelect: (item: SidebarThreadSearchNavigationItem) => void;
  projectNamesById: ReadonlyMap<string, string>;
  section: ThreadSearchSection;
  showSectionLabels: boolean;
  startIndex: number;
}) {
  if (section.rows.length === 0) {
    return null;
  }

  return (
    <section
      key={section.id}
      role="group"
      aria-label={section.label}
      className="space-y-1"
    >
      <div
        className={cn(
          CHROME_SECTION_LABEL_CLASS,
          "sticky top-0 z-10 rounded-none bg-sidebar px-2",
        )}
      >
        <span className="min-w-0 truncate">{section.label}</span>
        <span className="ml-auto shrink-0 text-xs font-normal tabular-nums text-muted-foreground">
          {section.total}
        </span>
      </div>
      <div className="space-y-0.5">
        {section.rows.map((row, rowIndex) => {
          const index = startIndex + rowIndex;
          const item = toNavigationItem(row);
          if (row.kind === "draft") {
            return (
              <DraftSearchResultRow
                key={row.id}
                id={item.optionId}
                isActive={activeIndex === index}
                matches={row.matches}
                onActive={() => onActiveIndexChange(index)}
                onSelect={() => onSelect(item)}
                primaryText={row.primaryText}
                projectId={row.draft.destination.projectId}
                projectName={projectNamesById.get(
                  row.draft.destination.projectId,
                )}
                sectionLabel={
                  showSectionLabels && row.draft.destination.sectionId
                    ? (sectionNamesById.get(row.draft.destination.sectionId) ??
                      "Section")
                    : null
                }
                title={row.draft.title}
                updatedAt={row.draft.lastEditedAt}
              />
            );
          }
          return (
            <ThreadSearchResultRow
              key={row.id}
              id={item.optionId}
              isActive={activeIndex === index}
              matches={row.matches}
              sectionLabel={
                showSectionLabels && row.thread.sectionId
                  ? (sectionNamesById.get(row.thread.sectionId) ?? "Section")
                  : null
              }
              projectName={projectNamesById.get(row.thread.projectId)}
              thread={row.thread}
              onActive={() => onActiveIndexChange(index)}
              onSelect={() => onSelect(item)}
            />
          );
        })}
      </div>
    </section>
  );
}

export function SidebarThreadSearchPanel({
  activeIndex,
  sectionNamesById = EMPTY_SECTION_NAMES_BY_ID,
  isRecentsLoading,
  onActiveIndexChange,
  onNavigationItemsChange,
  onSelect,
  projectNamesById,
  query,
  recentArchivedThreads = [],
  recentThreads,
  lifecycleFilter: providedLifecycleFilter,
  showSectionLabels = false,
}: SidebarThreadSearchPanelProps) {
  const internalLifecycleFilter = useSidebarThreadSearchLifecycleFilter();
  const lifecycleFilter = providedLifecycleFilter ?? internalLifecycleFilter;
  const {
    onCountsChange: onLifecycleCountsChange,
    reset: resetLifecycleFilter,
    selectedStates: selectedLifecycleStates,
  } = lifecycleFilter;
  const draftRows = useNewThreadDraftSlots();
  const trimmedQuery = query.trim();
  const liveQueryIsSearchable = hasThreadSearchableQuery(trimmedQuery);
  const threadSearch = useThreadSearch({ active: true, query });
  const searchResultsAreCurrent =
    !liveQueryIsSearchable || threadSearch.debouncedQuery === trimmedQuery;
  const allSections = useMemo<ThreadSearchSection[]>(() => {
    if (!liveQueryIsSearchable) {
      const activeRows: ThreadSearchRenderableThreadRow[] = recentThreads
        .slice(0, RECENT_THREAD_LIMIT)
        .map((thread) => ({
          kind: "thread",
          id: `active:${thread.id}`,
          matches: EMPTY_MATCHES,
          thread,
        }));
      const recentDraftRows: ThreadSearchRenderableDraftRow[] = draftRows
        .slice(0, RECENT_THREAD_LIMIT)
        .map((draft) => ({
          kind: "draft",
          draft,
          id: `draft:${draft.id}`,
          matches: [],
          primaryText: draft.title,
        }));
      const archivedRows: ThreadSearchRenderableThreadRow[] =
        recentArchivedThreads.slice(0, RECENT_THREAD_LIMIT).map((thread) => ({
          kind: "thread",
          id: `archived:${thread.id}`,
          matches: EMPTY_MATCHES,
          thread,
        }));
      return [
        {
          id: "active",
          label: "Threads",
          rows: activeRows,
          total: activeRows.length,
        },
        {
          id: "drafts",
          label: "Drafts",
          rows: recentDraftRows,
          total: recentDraftRows.length,
        },
        {
          id: "archived",
          label: "Archived threads",
          rows: archivedRows,
          total: archivedRows.length,
        },
      ];
    }

    if (!searchResultsAreCurrent) {
      return SIDEBAR_THREAD_SEARCH_LIFECYCLE_STATES.map((state) => ({
        id: state,
        label: LIFECYCLE_STATE_LABELS[state],
        rows: [],
        total: 0,
      }));
    }

    const activeRows: ThreadSearchRenderableThreadRow[] =
      threadSearch.data?.active.results.map((result) => ({
        kind: "thread",
        id: `active:${result.thread.id}`,
        matches: result.matches,
        thread: result.thread,
      })) ?? [];
    const matchingDraftRows: ThreadSearchRenderableDraftRow[] =
      draftRows.flatMap((draft) => {
        const match = getSidebarDraftSearchMatch({
          query: trimmedQuery,
          text: draft.draft.text,
          title: draft.title,
        });
        return match === null
          ? []
          : [
              {
                kind: "draft" as const,
                draft,
                id: `draft:${draft.id}`,
                matches: match.highlightRanges,
                primaryText: match.text,
              },
            ];
      });
    const archivedRows: ThreadSearchRenderableThreadRow[] =
      threadSearch.data?.archived.results.map((result) => ({
        kind: "thread",
        id: `archived:${result.thread.id}`,
        matches: result.matches,
        thread: result.thread,
      })) ?? [];
    return [
      {
        id: "active",
        label: "Threads",
        rows: activeRows,
        total: threadSearch.data?.active.total ?? 0,
      },
      {
        id: "drafts",
        label: "Drafts",
        rows: matchingDraftRows,
        total: matchingDraftRows.length,
      },
      {
        id: "archived",
        label: "Archived threads",
        rows: archivedRows,
        total: threadSearch.data?.archived.total ?? 0,
      },
    ];
  }, [
    draftRows,
    liveQueryIsSearchable,
    recentArchivedThreads,
    recentThreads,
    searchResultsAreCurrent,
    threadSearch.data,
    trimmedQuery,
  ]);
  const lifecycleCounts = useMemo<SidebarThreadSearchLifecycleCounts>(
    () => ({
      active:
        allSections.find((section) => section.id === "active")?.total ?? 0,
      drafts:
        allSections.find((section) => section.id === "drafts")?.total ?? 0,
      archived:
        allSections.find((section) => section.id === "archived")?.total ?? 0,
    }),
    [allSections],
  );
  const sections = useMemo(() => {
    const selectedStates = new Set(selectedLifecycleStates);
    return allSections.filter((section) => selectedStates.has(section.id));
  }, [allSections, selectedLifecycleStates]);
  const rows = useMemo(
    () => sections.flatMap((section) => section.rows),
    [sections],
  );
  const navigationItems = useMemo(() => rows.map(toNavigationItem), [rows]);

  useEffect(() => {
    onNavigationItemsChange(navigationItems);
  }, [navigationItems, onNavigationItemsChange]);

  useEffect(() => {
    onLifecycleCountsChange(lifecycleCounts);
  }, [lifecycleCounts, onLifecycleCountsChange]);

  useEffect(
    () => () => {
      resetLifecycleFilter();
    },
    [resetLifecycleFilter],
  );

  const isLoading =
    liveQueryIsSearchable &&
    (!searchResultsAreCurrent ||
      threadSearch.isDebouncing ||
      (threadSearch.isLoading && threadSearch.data === undefined));
  const hasRows = rows.length > 0;
  const showRecentLoading = !liveQueryIsSearchable && isRecentsLoading;
  const showError =
    liveQueryIsSearchable && threadSearch.isError && !isLoading && !hasRows;
  const showNoSearchResults =
    liveQueryIsSearchable && !isLoading && !showError && !hasRows;
  const showTypeToSearch =
    !liveQueryIsSearchable &&
    !showRecentLoading &&
    allSections.every((section) => section.rows.length === 0);
  let startIndex = 0;

  return (
    <div
      id={SIDEBAR_THREAD_SEARCH_LISTBOX_ID}
      role="listbox"
      aria-label="Thread search results"
      // Rows and section labels own their horizontal inset (the standard 8px
      // row padding), matching the rest of the sidebar. A container `px-*` here
      // would stack on top of that and squeeze the results narrower than every
      // other sidebar row.
      className="space-y-3 pb-3 group-data-[collapsible=icon]:hidden"
    >
      {showRecentLoading ? (
        <ThreadSearchMessage
          iconName="Spinner"
          isLoading
          text="Loading threads..."
        />
      ) : null}
      {isLoading ? (
        <ThreadSearchMessage
          iconName="Spinner"
          isLoading
          text="Searching threads..."
        />
      ) : null}
      {showError ? (
        <ThreadSearchMessage iconName="AlertCircle" text="Search failed." />
      ) : null}
      {showNoSearchResults ? (
        <ThreadSearchMessage
          iconName="MessageQuestion"
          text="No matching threads"
        />
      ) : null}
      {showTypeToSearch ? (
        <ThreadSearchMessage iconName="Search" text="Type to search threads." />
      ) : null}
      {sections.map((section) => {
        const renderedSection = renderSectionRows({
          activeIndex,
          sectionNamesById,
          onActiveIndexChange,
          onSelect,
          projectNamesById,
          section,
          showSectionLabels,
          startIndex,
        });
        startIndex += section.rows.length;
        return renderedSection;
      })}
    </div>
  );
}

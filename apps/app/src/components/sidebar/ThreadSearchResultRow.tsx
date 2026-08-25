import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type MouseEventHandler,
  type ReactNode,
} from "react";
import type { ThreadListEntry } from "@bb/domain";
import type { ThreadSearchMatch } from "@bb/server-contract";
import { PERSONAL_PROJECT_ID } from "@bb/domain";
import { formatRelativeTime } from "@/lib/relative-time";
import {
  hasActiveBackgroundAgentActivity,
  hasActiveBackgroundCommandActivity,
  hasActiveGoalActivity,
  hasActivePlanModeActivity,
  hasActiveWorkflowActivity,
  isRuntimeBusyThread,
  isUnreadDoneThread,
  resolveThreadListIndicator,
  type ThreadListIndicatorState,
} from "@bb/client-core";
import { getThreadDisplayTitle } from "@/lib/thread-title";
import { cn } from "@bb/shared-ui/lib/utils";
import { ThreadStatusGlyph } from "./ThreadRow";
import {
  getSidebarThreadSearchMatchWindow,
  isSidebarThreadTitleMatch,
} from "./sidebarThreadSearch";
import { usePromptDraftHasInput } from "@/hooks/usePromptDraftStorage";
import {
  SIDEBAR_ROW_BASE_CLASS,
  SIDEBAR_ROW_INTERACTIVE_STATE_CLASS,
  SIDEBAR_STANDARD_ROW_PADDING_CLASS,
} from "./sidebarRowClasses";

interface ThreadSearchResultRowProps {
  id: string;
  isActive: boolean;
  matches: readonly ThreadSearchMatch[];
  onActive: () => void;
  onSelect: () => void;
  projectName: string | undefined;
  /**
   * Pre-formatted section path (e.g. "Infra › CI") shown in place of the project
   * when the sidebar is organized by section. The caller derives it from the
   * thread's section + the Organize-by setting; absent → falls back to project.
   */
  sectionLabel?: string | null;
  thread: ThreadListEntry;
}

interface HighlightedTextProps {
  ranges: ThreadSearchMatch["highlightRanges"];
  text: string;
}

interface SearchResultRowLayoutProps {
  id: string;
  isActive: boolean;
  metadataText: string;
  onActive: () => void;
  onSelect: () => void;
  primaryHighlightRanges: ThreadSearchMatch["highlightRanges"];
  primaryText: string;
  trailingIndicator?: ReactNode;
}

export interface DraftSearchResultRowProps {
  id: string;
  isActive: boolean;
  matches: ThreadSearchMatch["highlightRanges"];
  onActive: () => void;
  onSelect: () => void;
  primaryText: string;
  projectId: string;
  projectName: string | undefined;
  sectionLabel?: string | null;
  title: string;
  updatedAt: number;
}

function clampRange(
  range: ThreadSearchMatch["highlightRanges"][number],
  textLength: number,
): ThreadSearchMatch["highlightRanges"][number] | null {
  const start = Math.max(0, Math.min(range.start, textLength));
  const end = Math.max(start, Math.min(range.end, textLength));
  return end > start ? { start, end } : null;
}

function HighlightedText({ ranges, text }: HighlightedTextProps) {
  if (ranges.length === 0 || text.length === 0) {
    return text;
  }

  const nodes: ReactNode[] = [];
  let cursor = 0;
  const sortedRanges = ranges
    .map((range) => clampRange(range, text.length))
    .filter((range): range is NonNullable<typeof range> => range !== null)
    .sort((left, right) => left.start - right.start || left.end - right.end);

  for (const [rangeIndex, range] of sortedRanges.entries()) {
    if (range.start < cursor) {
      continue;
    }
    if (range.start > cursor) {
      nodes.push(text.slice(cursor, range.start));
    }
    nodes.push(
      <mark
        key={`${range.start}:${range.end}`}
        data-sidebar-search-first-match={rangeIndex === 0 ? "true" : undefined}
        className="mx-0.5 rounded-sm bg-[var(--sidebar-search-match)] px-px text-sidebar-accent-foreground shadow-[0_0_0_1px_var(--sidebar-search-match-border)]"
      >
        {text.slice(range.start, range.end)}
      </mark>,
    );
    cursor = range.end;
  }
  if (cursor < text.length) {
    nodes.push(text.slice(cursor));
  }

  return nodes;
}

function getTitleMatch(
  title: string,
  matches: readonly ThreadSearchMatch[],
): ThreadSearchMatch | undefined {
  return matches.find(
    (match) => isSidebarThreadTitleMatch(match) && match.text === title,
  );
}

function getSnippetMatch(
  matches: readonly ThreadSearchMatch[],
): ThreadSearchMatch | undefined {
  return matches.find((match) => !isSidebarThreadTitleMatch(match));
}

function isNonEmptyMetadataPart(value: string | null): value is string {
  return value !== null && value.length > 0;
}

function SearchResultRowLayout({
  id,
  isActive,
  metadataText,
  onActive,
  onSelect,
  primaryHighlightRanges,
  primaryText,
  trailingIndicator,
}: SearchResultRowLayoutProps) {
  const rowRef = useRef<HTMLButtonElement | null>(null);
  const matchProbeRef = useRef<HTMLSpanElement | null>(null);
  const [matchIsHidden, setMatchIsHidden] = useState(false);
  const displayMatch = useMemo(
    () =>
      getSidebarThreadSearchMatchWindow({
        highlightRanges: primaryHighlightRanges,
        matchIsHidden,
        text: primaryText,
      }),
    [matchIsHidden, primaryHighlightRanges, primaryText],
  );
  const handleMouseEnter = useCallback<
    MouseEventHandler<HTMLButtonElement>
  >(() => {
    onActive();
  }, [onActive]);

  useLayoutEffect(() => {
    const probe = matchProbeRef.current;
    if (probe === null || primaryHighlightRanges.length === 0) {
      setMatchIsHidden(false);
      return;
    }

    const measure = () => {
      const firstMatch = probe.querySelector<HTMLElement>(
        '[data-sidebar-search-first-match="true"]',
      );
      const firstMatchRect = firstMatch?.getClientRects()[0];
      if (firstMatchRect === undefined) {
        // jsdom and display:none surfaces have no measurable line boxes. Keep
        // the ordinary clamp until the row enters a measurable layout.
        setMatchIsHidden(false);
        return;
      }
      const probeRect = probe.getBoundingClientRect();
      setMatchIsHidden(
        firstMatchRect.top >= probeRect.bottom - 0.5 ||
          firstMatchRect.bottom > probeRect.bottom + 0.5,
      );
    };

    measure();
    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", measure);
      return () => window.removeEventListener("resize", measure);
    }
    const observer = new ResizeObserver(measure);
    observer.observe(probe);
    return () => observer.disconnect();
  }, [primaryHighlightRanges, primaryText]);

  useEffect(() => {
    if (!isActive) {
      return;
    }
    rowRef.current?.scrollIntoView({ block: "nearest" });
  }, [isActive]);

  return (
    <button
      ref={rowRef}
      id={id}
      type="button"
      role="option"
      aria-selected={isActive}
      className={cn(
        SIDEBAR_ROW_BASE_CLASS,
        SIDEBAR_STANDARD_ROW_PADDING_CLASS,
        SIDEBAR_ROW_INTERACTIVE_STATE_CLASS,
        "min-h-10 py-1.5 pr-2 text-left outline-none ring-sidebar-ring focus-visible:ring-2",
        isActive && "bg-sidebar-accent text-sidebar-accent-foreground",
      )}
      onMouseEnter={handleMouseEnter}
      onFocus={onActive}
      onClick={onSelect}
    >
      <span className="min-w-0 flex-1 space-y-0.5">
        <span className="relative block min-w-0">
          {primaryHighlightRanges.length > 0 ? (
            <span
              ref={matchProbeRef}
              aria-hidden="true"
              className="pointer-events-none invisible absolute inset-x-0 top-0 block min-w-0 line-clamp-2 break-words"
            >
              <HighlightedText
                text={primaryText}
                ranges={primaryHighlightRanges}
              />
            </span>
          ) : null}
          <span className="block min-w-0 line-clamp-2 break-words">
            <HighlightedText
              text={displayMatch.text}
              ranges={displayMatch.highlightRanges}
            />
          </span>
        </span>
        <span
          className="block min-w-0 truncate text-xs leading-4 text-muted-foreground"
          title={metadataText}
        >
          {metadataText}
        </span>
      </span>
      {trailingIndicator}
    </button>
  );
}

export function DraftSearchResultRow({
  id,
  isActive,
  matches,
  onActive,
  onSelect,
  primaryText,
  projectId,
  projectName,
  sectionLabel,
  title,
  updatedAt,
}: DraftSearchResultRowProps) {
  const projectMetadata =
    projectId !== PERSONAL_PROJECT_ID && projectName ? projectName : null;
  const contextLabel = sectionLabel ?? projectMetadata;
  const relativeTime = formatRelativeTime({
    timestamp: updatedAt,
    now: Date.now(),
  });
  const metadataText = [
    primaryText === title ? null : title,
    contextLabel,
    relativeTime,
  ]
    .filter(isNonEmptyMetadataPart)
    .join(" · ");

  return (
    <SearchResultRowLayout
      id={id}
      isActive={isActive}
      metadataText={metadataText}
      onActive={onActive}
      onSelect={onSelect}
      primaryHighlightRanges={matches}
      primaryText={primaryText}
    />
  );
}

function ThreadSearchResultRowComponent({
  id,
  isActive,
  matches,
  onActive,
  onSelect,
  projectName,
  sectionLabel,
  thread,
}: ThreadSearchResultRowProps) {
  const title = getThreadDisplayTitle(thread);
  const titleMatch = getTitleMatch(title, matches);
  const snippetMatch = getSnippetMatch(matches);
  const primaryMatch = snippetMatch ?? titleMatch;
  const primaryText = primaryMatch?.text ?? title;
  const primaryHighlightRanges = primaryMatch?.highlightRanges ?? [];
  const hasPendingInteraction = thread.hasPendingInteraction;
  const threadUnreadDone = isUnreadDoneThread(thread);
  const hasUnsubmittedDraft = usePromptDraftHasInput({
    kind: "thread",
    projectId: thread.projectId,
    threadId: thread.id,
  });
  const indicatorState: ThreadListIndicatorState = {
    hasPendingInteraction,
    hasUnsubmittedDraft,
    hasUnreadError: threadUnreadDone && thread.status === "error",
    hasUnreadSuccess: threadUnreadDone && thread.status !== "error",
    isBackgroundAgentActive: hasActiveBackgroundAgentActivity(thread),
    isBackgroundCommandActive: hasActiveBackgroundCommandActivity(thread),
    isGoalActive: hasActiveGoalActivity(thread),
    isPlanModeActive: hasActivePlanModeActivity(thread),
    isRuntimeActive: isRuntimeBusyThread(thread),
    isWorkflowActive: hasActiveWorkflowActivity(thread),
  };
  const indicatorKind = resolveThreadListIndicator(indicatorState);
  // For recents and title-only matches, the second line shows the project and
  // when the thread was last active.
  const projectMetadata =
    thread.projectId !== PERSONAL_PROJECT_ID && projectName
      ? projectName
      : null;
  // Section takes the project's place on the metadata line when the sidebar is
  // organized by section (the caller supplies a sectionLabel only then).
  const contextLabel = sectionLabel ?? projectMetadata;
  const relativeTime = formatRelativeTime({
    timestamp: thread.updatedAt,
    now: Date.now(),
  });
  const metadataText = [snippetMatch ? title : null, contextLabel, relativeTime]
    .filter(isNonEmptyMetadataPart)
    .join(" · ");
  return (
    <SearchResultRowLayout
      id={id}
      isActive={isActive}
      metadataText={metadataText}
      onActive={onActive}
      onSelect={onSelect}
      primaryHighlightRanges={primaryHighlightRanges}
      primaryText={primaryText}
      trailingIndicator={
        indicatorKind !== "none" ? (
          <span className="inline-flex size-4 shrink-0 items-center justify-center">
            <ThreadStatusGlyph {...indicatorState} />
          </span>
        ) : null
      }
    />
  );
}

export const ThreadSearchResultRow = memo(ThreadSearchResultRowComponent);

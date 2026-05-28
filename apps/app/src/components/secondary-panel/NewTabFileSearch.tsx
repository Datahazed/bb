import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import type { ThreadType } from "@bb/domain";
import { Button } from "@/components/ui/button.js";
import { Icon } from "@/components/ui/icon.js";
import { Input } from "@/components/ui/input.js";
import { TruncateStart } from "@/components/ui/truncate-start.js";
import { ResolvedAppIcon } from "./AppIcon";
import {
  useFileSearchSuggestions,
  type FileSearchSuggestion,
} from "@/hooks/useFileSearchSuggestions";
import { usePromptDraftStorage } from "@/hooks/usePromptDraftStorage";
import type { FileSearchSelection } from "./useThreadFileTabs";
import { cn } from "@/lib/utils";
import { isPromptDraftEmpty, type PromptDraftState } from "@/lib/prompt-draft";

export const CREATE_APP_PROMPT_TEMPLATE = `Create a new bb app called "[NAME]" that [DESCRIBE WHAT IT SHOULD DO].

Use the bb apps system. Run \`bb guide app\` for the full reference. Layout:
- apps/<id>/manifest.json — { manifestVersion: 1, id, name, icon | logo.svg, entry, contributions: ["thread.app"], capabilities: ["data"?, "message"?] }
- apps/<id>/assets/index.html — self-contained inline HTML/CSS/JS/SVG so no build step is needed
- apps/<id>/data/state.json — initial state if the app uses window.bb.data

In the page, use window.bb.data for live state (read / write / delete / list / onChange; onChange replays + streams) and window.bb.message(text) to send the thread a prompt. Guard with window.bb?.data?.… because capabilities are advisory.

Make the app self-contained and aesthetically polished: design tokens, useful animation only, and accessible UI.`;

const CREATE_APP_PROMPT_DRAFT = {
  text: CREATE_APP_PROMPT_TEMPLATE,
  attachments: [],
} satisfies PromptDraftState;

export interface NewTabFileSearchProps {
  projectId: string | undefined;
  environmentId: string | null;
  currentThreadId: string;
  currentThreadType: ThreadType | undefined;
  focusRequest: number;
  initialQuery?: string;
  onSelect: (selection: FileSearchSelection) => void;
  onCreateAppPromptPrefill?: CreateAppPromptPrefillHandler;
}

interface FileSearchResultRowProps {
  id: string;
  suggestion: FileSearchSuggestion;
  isActive: boolean;
  onActivate: () => void;
  onSelect: (suggestion: FileSearchSuggestion) => void;
}

interface FileSearchMessageProps {
  iconName: "AlertCircle" | "File" | "FileQuestion" | "Spinner";
  iconClassName?: string;
  message: string;
}

interface FileSearchSectionItem {
  suggestion: FileSearchSuggestion;
  index: number;
}

interface FileSearchSection {
  kind: FileSearchSectionKind;
  label: string;
  items: FileSearchSectionItem[];
}

interface SplitPathResult {
  name: string;
  directory: string;
}

type SearchInputKeyDownHandler = (
  event: KeyboardEvent<HTMLInputElement>,
) => void;
type CreateAppPromptPrefillHandler = () => void;
type FileSearchSource = FileSearchSuggestion["source"];
type FileSearchSectionKind = "apps" | "files";

interface GetAvailableFileSearchSourcesArgs {
  projectId: string | undefined;
  currentThreadId: string;
  currentThreadType: ThreadType | undefined;
}

interface GroupFileSearchSectionsArgs {
  suggestions: readonly FileSearchSuggestion[];
  availableSources: readonly FileSearchSource[];
}

const FILE_SEARCH_LIMIT = 20;
const FILE_SEARCH_SECTION_ORDER: readonly FileSearchSectionKind[] = [
  "apps",
  "files",
];

const FILE_SEARCH_SECTION_LABELS = {
  apps: "Apps",
  files: "Files",
} satisfies Record<FileSearchSectionKind, string>;

const FILE_SEARCH_SOURCE_LABELS = {
  app: "App",
  workspace: "Workspace",
  "thread-storage": "Manager Storage",
} satisfies Record<FileSearchSource, string>;

function getAvailableFileSearchSources({
  projectId,
  currentThreadId,
  currentThreadType,
}: GetAvailableFileSearchSourcesArgs): readonly FileSearchSource[] {
  const sources: FileSearchSource[] = [];
  if (currentThreadId.length > 0) {
    sources.push("app");
  }
  if (projectId) {
    sources.push("workspace");
  }
  if (currentThreadType === "manager" && currentThreadId.length > 0) {
    sources.push("thread-storage");
  }
  return sources;
}

function getFileSearchResultId(suggestion: FileSearchSuggestion): string {
  const idSegment =
    suggestion.entryKind === "app" ? suggestion.appId : suggestion.path;
  return `file-search-result-${suggestion.source}-${encodeURIComponent(
    idSegment,
  )}`;
}

function splitPath(path: string): SplitPathResult {
  const lastSlash = path.lastIndexOf("/");
  if (lastSlash === -1) {
    return { name: path, directory: "" };
  }
  return {
    name: path.slice(lastSlash + 1),
    directory: path.slice(0, lastSlash),
  };
}

function getFileSearchResultTitle(suggestion: FileSearchSuggestion): string {
  if (suggestion.entryKind === "app") {
    return `${FILE_SEARCH_SOURCE_LABELS.app}: ${suggestion.name}`;
  }
  return `${FILE_SEARCH_SOURCE_LABELS[suggestion.source]}: ${suggestion.path}`;
}

function getFileSearchSectionKind(
  suggestion: FileSearchSuggestion,
): FileSearchSectionKind {
  return suggestion.entryKind === "app" ? "apps" : "files";
}

function groupFileSearchSections({
  availableSources,
  suggestions,
}: GroupFileSearchSectionsArgs): FileSearchSection[] {
  const allowedSources = new Set<FileSearchSource>(availableSources);
  const sectionsByKind = new Map<FileSearchSectionKind, FileSearchSection>();

  for (const suggestion of suggestions) {
    const source = suggestion.source;
    if (!allowedSources.has(source)) {
      continue;
    }
    const sectionKind = getFileSearchSectionKind(suggestion);
    const existing = sectionsByKind.get(sectionKind);
    if (existing) {
      existing.items.push({
        suggestion,
        index: existing.items.length,
      });
      continue;
    }

    sectionsByKind.set(sectionKind, {
      kind: sectionKind,
      label: FILE_SEARCH_SECTION_LABELS[sectionKind],
      items: [{ suggestion, index: 0 }],
    });
  }

  let nextIndex = 0;
  return FILE_SEARCH_SECTION_ORDER.flatMap((sectionKind) => {
    const section = sectionsByKind.get(sectionKind);
    if (!section) {
      return [];
    }
    return [
      {
        ...section,
        items: section.items.map(({ suggestion }) => {
          const index = nextIndex;
          nextIndex += 1;
          return { suggestion, index };
        }),
      },
    ];
  });
}

function FileSearchMessage({
  iconName,
  iconClassName,
  message,
}: FileSearchMessageProps) {
  return (
    <div className="flex min-h-24 items-center justify-center rounded-md border border-dashed border-border bg-surface-raised px-3 py-6 text-center text-sm text-muted-foreground">
      <div className="flex max-w-64 flex-col items-center gap-2">
        <Icon name={iconName} className={cn("size-4", iconClassName)} />
        <p>{message}</p>
      </div>
    </div>
  );
}

function FileSearchResultRow({
  id,
  suggestion,
  isActive,
  onActivate,
  onSelect,
}: FileSearchResultRowProps) {
  const handleSelect = useCallback(() => {
    onSelect(suggestion);
  }, [onSelect, suggestion]);

  if (suggestion.entryKind === "app") {
    return (
      <button
        type="button"
        id={id}
        role="option"
        aria-selected={isActive}
        onClick={handleSelect}
        onMouseEnter={onActivate}
        title={getFileSearchResultTitle(suggestion)}
        className={cn(
          "w-full scroll-mt-7 rounded px-2 py-1.5 text-left text-xs transition-colors",
          isActive ? "bg-state-active" : "hover:bg-state-hover",
        )}
      >
        <div className="flex min-w-0 items-center gap-1.5">
          <ResolvedAppIcon icon={suggestion.app.icon} className="size-3.5" />
          <span className="truncate">{suggestion.name}</span>
          {suggestion.appId !== suggestion.name ? (
            <TruncateStart className="text-muted-foreground [flex-shrink:9999]">
              {suggestion.appId}
            </TruncateStart>
          ) : null}
        </div>
      </button>
    );
  }

  const { directory } = splitPath(suggestion.path);
  const secondaryDirectory = directory || null;

  return (
    <button
      type="button"
      id={id}
      role="option"
      aria-selected={isActive}
      onClick={handleSelect}
      onMouseEnter={onActivate}
      title={getFileSearchResultTitle(suggestion)}
      className={cn(
        "w-full scroll-mt-7 rounded px-2 py-1.5 text-left text-xs transition-colors",
        isActive ? "bg-state-active" : "hover:bg-state-hover",
      )}
    >
      <div className="flex min-w-0 items-center gap-1.5">
        <Icon
          name="File"
          className="size-3.5 shrink-0 text-muted-foreground"
          aria-hidden
        />
        <span className="truncate">{suggestion.name}</span>
        {secondaryDirectory !== null ? (
          <TruncateStart className="text-muted-foreground [flex-shrink:9999]">
            {secondaryDirectory}
          </TruncateStart>
        ) : null}
      </div>
    </button>
  );
}

export function NewTabFileSearch({
  projectId,
  environmentId,
  currentThreadId,
  currentThreadType,
  focusRequest,
  initialQuery = "",
  onSelect,
  onCreateAppPromptPrefill,
}: NewTabFileSearchProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState(initialQuery);
  const [activeIndex, setActiveIndex] = useState(-1);
  const promptDraft = usePromptDraftStorage({
    projectId,
    threadId: currentThreadId.length > 0 ? currentThreadId : null,
  });
  const trimmedQuery = query.trim();
  const hasQuery = trimmedQuery.length > 0;
  const canPrefillCreateAppPrompt =
    promptDraft.storageKey !== null && currentThreadId.length > 0;
  const { suggestions, isLoading, isError, isDebouncing, isUnavailable } =
    useFileSearchSuggestions({
      projectId,
      query,
      limit: FILE_SEARCH_LIMIT,
      environmentId,
      currentThreadId,
      currentThreadType,
    });
  const availableSources = useMemo(
    () =>
      getAvailableFileSearchSources({
        projectId,
        currentThreadId,
        currentThreadType,
      }),
    [currentThreadId, currentThreadType, projectId],
  );
  const sections = useMemo(
    () => groupFileSearchSections({ availableSources, suggestions }),
    [availableSources, suggestions],
  );
  const visualSuggestions = useMemo(
    () =>
      sections.flatMap((section) =>
        section.items.map(({ suggestion }) => suggestion),
      ),
    [sections],
  );
  const activeSuggestion = useMemo(
    () =>
      activeIndex >= 0 && activeIndex < visualSuggestions.length
        ? (visualSuggestions[activeIndex] ?? null)
        : null,
    [activeIndex, visualSuggestions],
  );

  useEffect(() => {
    // Focus synchronously, then again on the next frame to win the focus race
    // against the panel/tab content mounting in the same commit, which can
    // otherwise pull focus away from the input.
    inputRef.current?.focus();
    const frame = requestAnimationFrame(() => {
      inputRef.current?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [focusRequest]);

  useEffect(() => {
    setActiveIndex(visualSuggestions.length > 0 ? 0 : -1);
  }, [visualSuggestions]);

  const handleSuggestionSelect = useCallback(
    (suggestion: FileSearchSuggestion) => {
      if (suggestion.entryKind === "app") {
        onSelect({
          source: "app",
          appId: suggestion.appId,
        });
        return;
      }

      onSelect({
        source: suggestion.source,
        path: suggestion.path,
      });
    },
    [onSelect],
  );

  const handleCreateAppPromptPrefill = useCallback(() => {
    if (!canPrefillCreateAppPrompt) {
      return;
    }

    const currentDraft = promptDraft.getCurrent();
    if (
      !isPromptDraftEmpty(currentDraft) &&
      !window.confirm(
        "Replace the current composer draft with a Create App prompt?",
      )
    ) {
      return;
    }

    promptDraft.setDraft(CREATE_APP_PROMPT_DRAFT);
    onCreateAppPromptPrefill?.();
  }, [
    canPrefillCreateAppPrompt,
    onCreateAppPromptPrefill,
    promptDraft.getCurrent,
    promptDraft.setDraft,
  ]);

  const handleInputKeyDown = useCallback<SearchInputKeyDownHandler>(
    (event) => {
      if (visualSuggestions.length === 0) {
        return;
      }

      if (event.key === "ArrowDown") {
        event.preventDefault();
        setActiveIndex((current) => (current + 1) % visualSuggestions.length);
        return;
      }

      if (event.key === "ArrowUp") {
        event.preventDefault();
        setActiveIndex((current) =>
          current <= 0 ? visualSuggestions.length - 1 : current - 1,
        );
        return;
      }

      if (event.key === "Enter" && activeSuggestion) {
        event.preventDefault();
        handleSuggestionSelect(activeSuggestion);
      }
    },
    [activeSuggestion, handleSuggestionSelect, visualSuggestions.length],
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <div className="relative">
        <Icon
          name="Search"
          className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
        />
        <Input
          ref={inputRef}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={handleInputKeyDown}
          disabled={isUnavailable}
          aria-label="Search apps and files"
          aria-activedescendant={
            activeSuggestion
              ? getFileSearchResultId(activeSuggestion)
              : undefined
          }
          placeholder={
            isUnavailable ? "No searchable source" : "Search apps and files"
          }
          className="h-8 pl-8 pr-8 text-xs focus-visible:ring-0"
        />
        {isDebouncing ? (
          <Icon
            name="Spinner"
            className="pointer-events-none absolute right-2.5 top-1/2 size-3.5 -translate-y-1/2 animate-spin text-muted-foreground"
          />
        ) : null}
      </div>

      <Button
        type="button"
        variant="outline"
        size="sm"
        className="h-8 w-full justify-start px-2.5 text-xs"
        disabled={!canPrefillCreateAppPrompt}
        onClick={handleCreateAppPromptPrefill}
        title={
          canPrefillCreateAppPrompt
            ? "Prefill the composer with a new-app prompt"
            : "Composer is unavailable"
        }
      >
        <Icon name="Plus" className="size-3.5" aria-hidden />
        <span>Create App…</span>
      </Button>

      {isUnavailable ? (
        <FileSearchMessage
          iconName="FileQuestion"
          message="No searchable app or file source is available."
        />
      ) : sections.length > 0 ? (
        <div
          role="listbox"
          aria-label="App and file search results"
          className="min-h-0 flex-1 overflow-y-auto pb-1"
        >
          {sections.map((section, sectionIndex) => (
            <div key={section.kind} className={cn(sectionIndex > 0 && "mt-2")}>
              <div
                className={cn(
                  "sticky top-0 z-10 bg-background px-2 pb-1 text-xs text-muted-foreground",
                  sectionIndex === 0 ? "pt-0" : "pt-1.5",
                )}
              >
                {section.label}
              </div>
              <div className="flex flex-col gap-px">
                {section.items.map(({ suggestion, index }) => (
                  <FileSearchResultRow
                    key={`${suggestion.source}:${
                      suggestion.entryKind === "app"
                        ? suggestion.appId
                        : suggestion.path
                    }`}
                    id={getFileSearchResultId(suggestion)}
                    suggestion={suggestion}
                    isActive={index === activeIndex}
                    onActivate={() => setActiveIndex(index)}
                    onSelect={handleSuggestionSelect}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : isError ? (
        <FileSearchMessage
          iconName="AlertCircle"
          message="App and file search failed."
        />
      ) : isLoading ? (
        <FileSearchMessage
          iconName="Spinner"
          iconClassName="animate-spin"
          message="Searching apps and files..."
        />
      ) : (
        <FileSearchMessage
          iconName={hasQuery ? "FileQuestion" : "File"}
          message={
            hasQuery
              ? "No apps or files match."
              : "Type to search apps and files."
          }
        />
      )}
    </div>
  );
}

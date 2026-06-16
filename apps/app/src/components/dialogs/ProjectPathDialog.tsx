import {
  useEffect,
  useId,
  useMemo,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import { useQuery } from "@tanstack/react-query";
import {
  deriveProjectNameFromPath,
  getProjectPathValidationMessage,
  normalizeProjectPathInput,
} from "@bb/domain";
import type {
  GitDirectorySuggestion,
  GitDirectorySuggestionsRequest,
  GitDirectorySuggestionsResponse,
  HostPlatform,
} from "@bb/host-daemon-contract";
import { useDebounceValue } from "usehooks-ts";
import { Button } from "@/components/ui/button.js";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog.js";
import { Icon } from "@/components/ui/icon.js";
import { Input } from "@/components/ui/input.js";
import { cn } from "@/lib/utils";

export type ProjectPathDialogTarget =
  | {
      kind: "create";
    }
  | {
      kind: "update";
      projectId: string;
      projectName: string;
      currentPath: string;
    }
  | {
      kind: "add-source";
      projectId: string;
      projectName: string;
    };

export type ProjectPathDialogSubmitHandler = (
  target: ProjectPathDialogTarget,
  path: string,
) => Promise<void> | void;

export type ProjectGitDirectorySuggestionLoader = (
  request: GitDirectorySuggestionsRequest,
) => Promise<GitDirectorySuggestionsResponse>;

interface ProjectPathDialogProps {
  target: ProjectPathDialogTarget | null;
  pending?: boolean;
  platform: HostPlatform | null;
  hostName: string | null;
  listGitDirectories?: ProjectGitDirectorySuggestionLoader | null;
  onOpenChange: (open: boolean) => void;
  onSubmit: ProjectPathDialogSubmitHandler;
}

export function ProjectPathDialog({
  target,
  pending = false,
  platform,
  hostName,
  listGitDirectories,
  onOpenChange,
  onSubmit,
}: ProjectPathDialogProps) {
  return (
    <Dialog open={target !== null} onOpenChange={onOpenChange}>
      <DialogContent>
        {target ? (
          <ProjectPathDialogContent
            key={target.kind === "create" ? "create" : target.projectId}
            target={target}
            pending={pending}
            platform={platform}
            hostName={hostName}
            listGitDirectories={listGitDirectories}
            onSubmit={onSubmit}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

export interface ProjectPathDialogContentProps {
  target: ProjectPathDialogTarget;
  pending: boolean;
  platform: HostPlatform | null;
  hostName: string | null;
  listGitDirectories?: ProjectGitDirectorySuggestionLoader | null;
  onSubmit: ProjectPathDialogSubmitHandler;
}

interface PlatformCopy {
  description: string;
  placeholder: string;
}

const PROJECT_PATH_GIT_DIRECTORY_SUGGESTION_LIMIT = 8;
const PROJECT_PATH_GIT_DIRECTORY_SUGGESTION_DEBOUNCE_MS = 120;

function getDialogTitle(kind: ProjectPathDialogTarget["kind"]): string {
  switch (kind) {
    case "create":
      return "Add project";
    case "update":
      return "Update project path";
    case "add-source":
      return "Add project source";
  }
}

function getDialogSubmitLabel(kind: ProjectPathDialogTarget["kind"]): string {
  switch (kind) {
    case "create":
      return "Add project";
    case "update":
      return "Save path";
    case "add-source":
      return "Add source";
  }
}

function getPlatformCopy(
  platform: HostPlatform | null,
  hostName: string | null,
): PlatformCopy {
  const placeholder = "/path/to/project";
  // The path is resolved on the host machine, not the device showing this
  // dialog — name the host so remote users don't type a local path.
  const hostSuffix = hostName ? ` on ${hostName}` : "";
  if (platform === "wsl") {
    return {
      description: `Enter an absolute WSL path${hostSuffix} to the project folder, such as /home/me/repo or /mnt/c/...`,
      placeholder,
    };
  }
  return {
    description: `Enter an absolute path${hostSuffix} to the project folder.`,
    placeholder,
  };
}

function getAbsolutePathSuggestionRequest(
  input: string,
): GitDirectorySuggestionsRequest | null {
  if (!input.startsWith("/")) {
    return null;
  }

  if (input === "/") {
    return {
      mode: "children",
      parentPath: "/",
      limit: PROJECT_PATH_GIT_DIRECTORY_SUGGESTION_LIMIT,
    };
  }

  if (input.endsWith("/")) {
    return {
      mode: "children",
      parentPath: normalizeProjectPathInput(input),
      limit: PROJECT_PATH_GIT_DIRECTORY_SUGGESTION_LIMIT,
    };
  }

  const lastSlashIndex = input.lastIndexOf("/");
  const parentPath =
    lastSlashIndex === 0 ? "/" : input.slice(0, lastSlashIndex);
  const query = input.slice(lastSlashIndex + 1);
  return {
    mode: "children",
    parentPath,
    ...(query ? { query } : {}),
    limit: PROJECT_PATH_GIT_DIRECTORY_SUGGESTION_LIMIT,
  };
}

function getProjectPathSuggestionRequest(
  input: string,
): GitDirectorySuggestionsRequest | null {
  const trimmedInput = input.trim();
  if (!trimmedInput) {
    return null;
  }

  const absoluteRequest = getAbsolutePathSuggestionRequest(trimmedInput);
  if (absoluteRequest) {
    return absoluteRequest;
  }

  if (trimmedInput.includes("/") || trimmedInput.length < 2) {
    return null;
  }

  return {
    mode: "known-roots",
    query: trimmedInput,
    limit: PROJECT_PATH_GIT_DIRECTORY_SUGGESTION_LIMIT,
  };
}

interface ProjectPathGitDirectorySuggestionsProps {
  activeIndex: number;
  isError: boolean;
  isLoading: boolean;
  onSelect: (suggestion: GitDirectorySuggestion) => void;
  suggestions: readonly GitDirectorySuggestion[];
}

function ProjectPathGitDirectorySuggestions({
  activeIndex,
  isError,
  isLoading,
  onSelect,
  suggestions,
}: ProjectPathGitDirectorySuggestionsProps) {
  return (
    <div className="overflow-hidden rounded-md border border-border bg-popover text-popover-foreground">
      {isLoading && suggestions.length === 0 ? (
        <div className="flex items-center gap-2 px-3 py-2 text-xs text-muted-foreground">
          <Icon name="Spinner" className="size-3.5 animate-spin" />
          <span>Searching repositories...</span>
        </div>
      ) : null}
      {isError ? (
        <div className="px-3 py-2 text-xs text-destructive">
          Failed to load repository suggestions
        </div>
      ) : null}
      {suggestions.length > 0 ? (
        <div role="listbox" className="max-h-48 overflow-y-auto p-1">
          {suggestions.map((suggestion, index) => (
            <button
              key={suggestion.path}
              type="button"
              role="option"
              aria-selected={index === activeIndex}
              title={suggestion.path}
              className={cn(
                "flex w-full min-w-0 items-center gap-2 rounded px-2 py-1.5 text-left text-xs",
                index === activeIndex
                  ? "bg-state-active text-foreground"
                  : "hover:bg-state-hover",
              )}
              onMouseDown={(event) => {
                event.preventDefault();
                onSelect(suggestion);
              }}
            >
              <Icon
                name="FolderGit"
                className="size-3.5 shrink-0 text-muted-foreground"
                aria-hidden
              />
              <span className="shrink-0 font-medium text-foreground">
                {suggestion.name}
              </span>
              <span className="truncate text-muted-foreground">
                {suggestion.path}
              </span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function ProjectPathDialogContent({
  target,
  pending,
  platform,
  hostName,
  listGitDirectories,
  onSubmit,
}: ProjectPathDialogContentProps) {
  const inputId = useId();
  const [pathValue, setPathValue] = useState(
    target.kind === "update" ? target.currentPath : "",
  );
  const [validationMessage, setValidationMessage] = useState<string | null>(
    null,
  );
  const [suggestionsOpen, setSuggestionsOpen] = useState(true);
  const [dismissedSuggestionPath, setDismissedSuggestionPath] = useState<
    string | null
  >(null);
  const [activeSuggestionIndex, setActiveSuggestionIndex] = useState(0);
  const derivedProjectName = deriveProjectNameFromPath(pathValue);
  const copy = getPlatformCopy(platform, hostName);
  const placeholder =
    target.kind === "update"
      ? target.currentPath || copy.placeholder
      : copy.placeholder;

  useEffect(() => {
    setValidationMessage(null);
  }, [pathValue]);

  const [debouncedPathValue] = useDebounceValue(
    pathValue,
    PROJECT_PATH_GIT_DIRECTORY_SUGGESTION_DEBOUNCE_MS,
  );
  const suggestionRequest = useMemo(
    () => getProjectPathSuggestionRequest(debouncedPathValue),
    [debouncedPathValue],
  );
  const suggestionsEnabled =
    target.kind === "create" &&
    !pending &&
    listGitDirectories != null &&
    suggestionRequest !== null;
  const suggestionsQuery = useQuery({
    queryKey: ["project-path-git-directories", suggestionRequest],
    queryFn: () => {
      if (!listGitDirectories || !suggestionRequest) {
        throw new Error("Git directory suggestions are unavailable");
      }
      return listGitDirectories(suggestionRequest);
    },
    enabled: suggestionsEnabled,
    staleTime: 5_000,
    retry: false,
    refetchOnWindowFocus: false,
    placeholderData: (previousData) => previousData,
  });
  const suggestions = suggestionsQuery.data?.directories ?? [];
  const visibleSuggestions =
    suggestionsOpen &&
    pathValue !== dismissedSuggestionPath &&
    suggestionsEnabled &&
    (suggestionsQuery.isLoading ||
      suggestionsQuery.isError ||
      suggestions.length > 0);
  const clampedActiveSuggestionIndex =
    suggestions.length === 0
      ? -1
      : Math.min(activeSuggestionIndex, suggestions.length - 1);

  useEffect(() => {
    setActiveSuggestionIndex(0);
  }, [debouncedPathValue]);

  const applySuggestion = (suggestion: GitDirectorySuggestion) => {
    const normalizedPath = normalizeProjectPathInput(suggestion.path);
    setPathValue(normalizedPath);
    setValidationMessage(null);
    setSuggestionsOpen(false);
    setDismissedSuggestionPath(normalizedPath);
  };

  const handleInputKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (!visibleSuggestions || suggestions.length === 0) {
      return;
    }

    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveSuggestionIndex((current) =>
        current >= suggestions.length - 1 ? 0 : current + 1,
      );
      return;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveSuggestionIndex((current) =>
        current <= 0 ? suggestions.length - 1 : current - 1,
      );
      return;
    }

    if (event.key === "Enter" && clampedActiveSuggestionIndex >= 0) {
      const suggestion = suggestions[clampedActiveSuggestionIndex];
      if (!suggestion) {
        return;
      }
      event.preventDefault();
      applySuggestion(suggestion);
      return;
    }

    if (event.key === "Escape") {
      event.preventDefault();
      setSuggestionsOpen(false);
      setDismissedSuggestionPath(pathValue);
    }
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (pending) return;

    const normalizedPath = normalizeProjectPathInput(pathValue);
    const pathValidationMessage =
      getProjectPathValidationMessage(normalizedPath);
    if (pathValidationMessage) {
      setValidationMessage(pathValidationMessage);
      return;
    }

    if (
      target.kind === "create" &&
      !deriveProjectNameFromPath(normalizedPath)
    ) {
      setValidationMessage("Could not derive a project name from that path.");
      return;
    }

    void onSubmit(target, normalizedPath);
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>{getDialogTitle(target.kind)}</DialogTitle>
        <DialogDescription>{copy.description}</DialogDescription>
      </DialogHeader>
      <form className="space-y-4" onSubmit={handleSubmit}>
        <div className="space-y-2">
          <Input
            id={inputId}
            aria-label="Project path"
            value={pathValue}
            autoFocus
            disabled={pending}
            placeholder={placeholder}
            onChange={(event) => {
              setPathValue(event.target.value);
              setSuggestionsOpen(true);
              setDismissedSuggestionPath(null);
            }}
            onKeyDown={handleInputKeyDown}
          />
          {visibleSuggestions ? (
            <ProjectPathGitDirectorySuggestions
              activeIndex={clampedActiveSuggestionIndex}
              isError={suggestionsQuery.isError}
              isLoading={suggestionsQuery.isLoading}
              suggestions={suggestions}
              onSelect={applySuggestion}
            />
          ) : null}
          {target.kind === "create" && derivedProjectName ? (
            <p className="text-sm text-muted-foreground">
              Project name:{" "}
              <span className="font-medium text-foreground">
                {derivedProjectName}
              </span>
            </p>
          ) : null}
          {validationMessage ? (
            <p className="text-sm text-destructive">{validationMessage}</p>
          ) : null}
        </div>
        <DialogFooter>
          <Button type="submit" disabled={pending}>
            {getDialogSubmitLabel(target.kind)}
          </Button>
        </DialogFooter>
      </form>
    </>
  );
}

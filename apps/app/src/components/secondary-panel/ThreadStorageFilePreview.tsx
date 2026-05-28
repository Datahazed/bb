import { useMemo } from "react";
import {
  FilePreview as FilePreviewSurface,
  type FilePreviewFile,
  type FilePreviewHeaderMode,
} from "./FilePreview";
import {
  MANAGER_STATUS_MARKDOWN_FILE_PATH,
  isManagerStatusStorageFilePath,
} from "./managerStorage";
import {
  useThreadStatusMarkdownPreview,
  useThreadStatusVersion,
} from "@/hooks/queries/thread-queries";
import { HttpError } from "@/lib/api";
import {
  buildThreadStatusContentUrl,
  buildThreadStorageRawContentUrl,
} from "@/lib/file-content-urls";
import { createAssetMarkdownUrlTransform } from "@/lib/markdown-url-transform";
import type { ThreadStatusVersionResponse } from "@bb/server-contract";
import type {
  FilePreview,
  TextFilePreview,
  WorkspaceFilePreviewStatusLabel,
} from "@/lib/file-preview";
import { isHtmlFilePreviewPath } from "@/lib/file-preview";

// Generic HTML comes from arbitrary worktree/storage files. Allow scripts for
// realistic previews, but omit allow-same-origin so the frame gets an opaque
// origin and cannot read bb app cookies, storage, or same-origin APIs.
const GENERIC_HTML_IFRAME_SANDBOX = "allow-scripts";
const MANAGER_STATUS_HEADER_MODE: FilePreviewHeaderMode = "none";

interface FilePreviewBaseProps {
  activePath: string;
  copyPath?: string | null;
  error?: Error | null;
  filePreview: FilePreview | undefined;
  isLoading: boolean;
  lineNumber?: number | null;
  onOpenInEditor?: (path: string) => void;
}

interface ThreadStorageFilePreviewProps extends FilePreviewBaseProps {
  pinnedPath: string;
  threadId: string;
}

interface SecondaryPanelFilePreviewProps extends FilePreviewBaseProps {
  htmlPreviewUrl?: string | null;
  pendingNotFoundPath?: string;
  statusLabel?: WorkspaceFilePreviewStatusLabel | null;
}

interface BuildTextPreviewFileArgs {
  activePath: string;
  filePreview: TextFilePreview;
}

function buildTextPreviewFile({
  activePath,
  filePreview,
}: BuildTextPreviewFileArgs): FilePreviewFile {
  return {
    name: filePreview.name ?? activePath,
    contents: filePreview.content,
  };
}

function buildManagerStatusPreviewUrl(
  threadId: string,
  version: ThreadStatusVersionResponse,
): string {
  return buildThreadStatusContentUrl(threadId, version.hash);
}

export function SecondaryPanelFilePreview({
  activePath,
  copyPath = null,
  error,
  filePreview,
  htmlPreviewUrl = null,
  isLoading,
  lineNumber = null,
  onOpenInEditor,
  pendingNotFoundPath,
  statusLabel = null,
}: SecondaryPanelFilePreviewProps) {
  if (error) {
    const isNotFound = error instanceof HttpError && error.status === 404;
    if (isNotFound && activePath === pendingNotFoundPath) {
      return (
        <FilePreviewSurface
          path={activePath}
          copyPath={copyPath}
          onOpenInEditor={onOpenInEditor}
          statusLabel={statusLabel}
          state={{ kind: "manager-status-pending" }}
        />
      );
    }
    return (
      <FilePreviewSurface
        path={activePath}
        copyPath={copyPath}
        onOpenInEditor={onOpenInEditor}
        statusLabel={statusLabel}
        state={{ kind: isNotFound ? "not-found" : "error" }}
      />
    );
  }

  if (isLoading || !filePreview || filePreview.path !== activePath) {
    return (
      <FilePreviewSurface
        path={activePath}
        copyPath={copyPath}
        onOpenInEditor={onOpenInEditor}
        statusLabel={statusLabel}
        state={{ kind: "loading" }}
      />
    );
  }

  if (htmlPreviewUrl !== null && isHtmlFilePreviewPath(activePath)) {
    if (filePreview.kind !== "text") {
      return (
        <FilePreviewSurface
          path={activePath}
          copyPath={copyPath}
          onOpenInEditor={onOpenInEditor}
          statusLabel={statusLabel}
          state={{
            kind: "iframe",
            sandbox: GENERIC_HTML_IFRAME_SANDBOX,
            title: activePath,
            url: htmlPreviewUrl,
          }}
        />
      );
    }

    return (
      <FilePreviewSurface
        path={activePath}
        copyPath={copyPath}
        onOpenInEditor={onOpenInEditor}
        statusLabel={statusLabel}
        state={{
          kind: "html",
          file: buildTextPreviewFile({ activePath, filePreview }),
          iframe: {
            sandbox: GENERIC_HTML_IFRAME_SANDBOX,
            title: activePath,
            url: htmlPreviewUrl,
          },
          lineNumber,
        }}
      />
    );
  }

  if (filePreview.kind === "text") {
    if (filePreview.content.length === 0) {
      return (
        <FilePreviewSurface
          path={activePath}
          copyPath={copyPath}
          onOpenInEditor={onOpenInEditor}
          statusLabel={statusLabel}
          state={{ kind: "empty" }}
        />
      );
    }
    return (
      <FilePreviewSurface
        path={activePath}
        copyPath={copyPath}
        onOpenInEditor={onOpenInEditor}
        statusLabel={statusLabel}
        state={{
          kind: "ready",
          lineNumber,
          showMarkdownModeToggle: true,
          file: buildTextPreviewFile({ activePath, filePreview }),
        }}
      />
    );
  }

  if (filePreview.kind === "image") {
    return (
      <FilePreviewSurface
        path={activePath}
        copyPath={copyPath}
        onOpenInEditor={onOpenInEditor}
        statusLabel={statusLabel}
        state={{ kind: "image", url: filePreview.url }}
      />
    );
  }

  return (
    <FilePreviewSurface
      path={activePath}
      copyPath={copyPath}
      onOpenInEditor={onOpenInEditor}
      statusLabel={statusLabel}
      state={{
        kind: "error",
        message: `Preview not available for ${filePreview.mimeType}.`,
      }}
    />
  );
}

export function ThreadStorageFilePreview({
  activePath,
  copyPath,
  error,
  filePreview,
  isLoading,
  lineNumber,
  onOpenInEditor,
  pinnedPath,
  threadId,
}: ThreadStorageFilePreviewProps) {
  const isManagerStatusTab = isManagerStatusStorageFilePath(activePath);
  const statusVersion = useThreadStatusVersion(threadId, {
    enabled: isManagerStatusTab,
  });
  const statusMarkdownPreview = useThreadStatusMarkdownPreview(
    threadId,
    statusVersion.data?.hash,
    {
      enabled: isManagerStatusTab && statusVersion.data?.source === "md",
    },
  );
  const statusMarkdownAssetBaseUrl = useMemo(
    () => buildThreadStatusContentUrl(threadId),
    [threadId],
  );
  const statusMarkdownUrlTransform = useMemo(() => {
    return createAssetMarkdownUrlTransform(statusMarkdownAssetBaseUrl);
  }, [statusMarkdownAssetBaseUrl]);

  if (isManagerStatusTab) {
    if (statusVersion.isError) {
      return (
        <FilePreviewSurface
          path={activePath}
          copyPath={copyPath}
          headerMode={MANAGER_STATUS_HEADER_MODE}
          state={{
            kind: "error",
            message:
              statusVersion.error instanceof Error
                ? statusVersion.error.message
                : "Failed to load manager status.",
          }}
        />
      );
    }

    if (!statusVersion.data) {
      return (
        <FilePreviewSurface
          path={activePath}
          copyPath={copyPath}
          headerMode={MANAGER_STATUS_HEADER_MODE}
          state={{ kind: "loading" }}
        />
      );
    }

    if (statusVersion.data.source === "empty") {
      return (
        <FilePreviewSurface
          path={activePath}
          copyPath={copyPath}
          headerMode={MANAGER_STATUS_HEADER_MODE}
          state={{ kind: "manager-status-pending" }}
        />
      );
    }

    if (statusVersion.data.source === "md") {
      if (statusMarkdownPreview.isError) {
        return (
          <FilePreviewSurface
            path={activePath}
            copyPath={copyPath}
            headerMode={MANAGER_STATUS_HEADER_MODE}
            state={{
              kind: "error",
              message:
                statusMarkdownPreview.error instanceof Error
                  ? statusMarkdownPreview.error.message
                  : "Failed to load manager status.",
            }}
          />
        );
      }

      if (!statusMarkdownPreview.data) {
        return (
          <FilePreviewSurface
            path={activePath}
            copyPath={copyPath}
            headerMode={MANAGER_STATUS_HEADER_MODE}
            state={{ kind: "loading" }}
          />
        );
      }

      if (statusMarkdownPreview.data.kind !== "text") {
        return (
          <FilePreviewSurface
            path={activePath}
            copyPath={copyPath}
            headerMode={MANAGER_STATUS_HEADER_MODE}
            state={{
              kind: "error",
              message: `Preview not available for ${statusMarkdownPreview.data.mimeType}.`,
            }}
          />
        );
      }

      return (
        <FilePreviewSurface
          path={activePath}
          copyPath={copyPath}
          headerMode={MANAGER_STATUS_HEADER_MODE}
          state={{
            kind: "ready",
            lineNumber: null,
            showMarkdownModeToggle: false,
            markdownUrlTransform: statusMarkdownUrlTransform,
            file: {
              name:
                statusMarkdownPreview.data.name ??
                MANAGER_STATUS_MARKDOWN_FILE_PATH,
              contents: statusMarkdownPreview.data.content,
            },
          }}
        />
      );
    }

    return (
      <FilePreviewSurface
        path={activePath}
        copyPath={copyPath}
        headerMode={MANAGER_STATUS_HEADER_MODE}
        state={{
          kind: "iframe",
          sandbox: null,
          title: "Manager status",
          url: buildManagerStatusPreviewUrl(threadId, statusVersion.data),
        }}
      />
    );
  }

  return (
    <SecondaryPanelFilePreview
      activePath={activePath}
      copyPath={copyPath}
      error={error}
      filePreview={filePreview}
      htmlPreviewUrl={buildThreadStorageRawContentUrl(threadId, activePath)}
      isLoading={isLoading}
      lineNumber={lineNumber}
      onOpenInEditor={onOpenInEditor}
      pendingNotFoundPath={pinnedPath}
    />
  );
}

import { useMemo } from "react";
import {
  useThreadApp,
  useThreadAppMarkdownPreview,
} from "@/hooks/queries/thread-queries";
import {
  buildThreadAppAssetBaseUrl,
  buildThreadAppEntryUrl,
} from "@/lib/file-content-urls";
import { createAssetMarkdownUrlTransform } from "@/lib/markdown-url-transform";
import { FilePreview as FilePreviewSurface } from "./FilePreview";

const APP_HEADER_MODE = "none";

export interface AppTabContentProps {
  appId: string;
  threadId: string;
}

export function AppTabContent({ appId, threadId }: AppTabContentProps) {
  const appDetail = useThreadApp(threadId, appId);
  const markdownEntryPath =
    appDetail.data?.entry.kind === "md" ? appDetail.data.entry.path : null;
  const markdownPreview = useThreadAppMarkdownPreview(
    threadId,
    appId,
    markdownEntryPath,
    {
      enabled: markdownEntryPath !== null,
    },
  );
  const markdownAssetBaseUrl = useMemo(() => {
    if (markdownEntryPath === null) {
      return null;
    }
    return buildThreadAppAssetBaseUrl(threadId, appId, markdownEntryPath);
  }, [appId, markdownEntryPath, threadId]);
  const markdownUrlTransform = useMemo(() => {
    if (markdownAssetBaseUrl === null) {
      return undefined;
    }
    return createAssetMarkdownUrlTransform(markdownAssetBaseUrl);
  }, [markdownAssetBaseUrl]);

  if (appDetail.isError) {
    return (
      <FilePreviewSurface
        path={appId}
        headerMode={APP_HEADER_MODE}
        state={{
          kind: "error",
          message:
            appDetail.error instanceof Error
              ? appDetail.error.message
              : "Failed to load app.",
        }}
      />
    );
  }

  if (!appDetail.data) {
    return (
      <FilePreviewSurface
        path={appId}
        headerMode={APP_HEADER_MODE}
        state={{ kind: "loading" }}
      />
    );
  }

  if (appDetail.data.entry.kind === "html") {
    return (
      <FilePreviewSurface
        path={appDetail.data.name}
        headerMode={APP_HEADER_MODE}
        state={{
          kind: "iframe",
          sandbox: null,
          title: appDetail.data.name,
          url: buildThreadAppEntryUrl(threadId, appId),
        }}
      />
    );
  }

  if (markdownPreview.isError) {
    return (
      <FilePreviewSurface
        path={appDetail.data.name}
        headerMode={APP_HEADER_MODE}
        state={{
          kind: "error",
          message:
            markdownPreview.error instanceof Error
              ? markdownPreview.error.message
              : "Failed to load app entry.",
        }}
      />
    );
  }

  if (!markdownPreview.data) {
    return (
      <FilePreviewSurface
        path={appDetail.data.name}
        headerMode={APP_HEADER_MODE}
        state={{ kind: "loading" }}
      />
    );
  }

  if (markdownPreview.data.kind !== "text") {
    return (
      <FilePreviewSurface
        path={appDetail.data.name}
        headerMode={APP_HEADER_MODE}
        state={{
          kind: "error",
          message: `Preview not available for ${markdownPreview.data.mimeType}.`,
        }}
      />
    );
  }

  if (markdownPreview.data.content.length === 0) {
    return (
      <FilePreviewSurface
        path={appDetail.data.name}
        headerMode={APP_HEADER_MODE}
        state={{ kind: "empty" }}
      />
    );
  }

  return (
    <FilePreviewSurface
      path={appDetail.data.name}
      headerMode={APP_HEADER_MODE}
      state={{
        kind: "ready",
        lineNumber: null,
        showMarkdownModeToggle: false,
        markdownUrlTransform,
        file: {
          name: markdownPreview.data.name ?? appDetail.data.entry.path,
          contents: markdownPreview.data.content,
        },
      }}
    />
  );
}

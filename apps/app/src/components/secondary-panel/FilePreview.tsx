import { lazy, Suspense } from "react";
import type { FilePreviewProps } from "./FilePreviewImpl";

const FilePreviewImpl = lazy(() =>
  import("./FilePreviewImpl").then((module) => ({
    default: module.FilePreview,
  })),
);

export function FilePreview(props: FilePreviewProps) {
  return (
    <Suspense
      fallback={
        <div
          className="flex h-full items-center justify-center text-sm text-muted-foreground"
          aria-busy="true"
        >
          Loading file preview
        </div>
      }
    >
      <FilePreviewImpl {...props} />
    </Suspense>
  );
}

export type {
  FilePreviewFile,
  FilePreviewHeaderMode,
  FilePreviewProps,
  FilePreviewState,
  IframeFilePreviewTarget,
  IframePreviewSandbox,
  TextFilePreviewKind,
} from "./FilePreviewImpl";

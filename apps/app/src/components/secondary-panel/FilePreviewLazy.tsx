import { lazy, Suspense } from "react";
import { Skeleton } from "@bb/shared-ui/skeleton";
import type { FilePreviewProps } from "./FilePreview";

export type {
  FilePreviewFile,
  FilePreviewProps,
  TextFilePreviewKind,
} from "./FilePreview";

/**
 * Loads the file viewer only when a user opens a file.
 *
 * `FilePreview` renders through `@pierre/diffs`, which carries Shiki and its
 * grammars — about 1 MB of JavaScript. The secondary panel mounts on every
 * thread page, so a static import puts that megabyte on the thread route's
 * preload set before anyone opens a file.
 */
const FilePreviewSurface = lazy(() =>
  import("./FilePreview").then((module) => ({ default: module.FilePreview })),
);

export function FilePreview(props: FilePreviewProps) {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-0 flex-1 flex-col gap-1.5 p-3">
          <Skeleton className="h-3 w-full rounded-sm" />
          <Skeleton className="h-3 w-[94%] rounded-sm" />
          <Skeleton className="h-3 w-[90%] rounded-sm" />
          <Skeleton className="h-3 w-[86%] rounded-sm" />
        </div>
      }
    >
      <FilePreviewSurface {...props} />
    </Suspense>
  );
}

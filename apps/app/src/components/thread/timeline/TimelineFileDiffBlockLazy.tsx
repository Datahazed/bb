import { lazy, Suspense } from "react";
import { Skeleton } from "@bb/shared-ui/skeleton";
import type { TimelineFileDiffBlockProps } from "./TimelineFileDiffBlock.js";

/**
 * Loads the timeline's diff renderer only when a row actually shows a diff.
 *
 * `TimelineFileDiffBlock` reaches `@pierre/diffs` and Shiki, about 1 MB of
 * JavaScript. The timeline itself renders on every thread page, so a static
 * import puts that megabyte on the thread route's preload set even for a
 * thread that never touched a file.
 */
const TimelineFileDiffBlockContent = lazy(() =>
  import("./TimelineFileDiffBlock.js").then((module) => ({
    default: module.TimelineFileDiffBlock,
  })),
);

export function TimelineFileDiffBlock(props: TimelineFileDiffBlockProps) {
  return (
    <Suspense
      fallback={
        <div className="mt-1 space-y-1.5 rounded-lg border border-border bg-background p-2">
          <Skeleton className="h-3 w-48 max-w-full rounded-sm" />
          <Skeleton className="h-3 w-full rounded-sm" />
          <Skeleton className="h-3 w-[90%] rounded-sm" />
        </div>
      }
    >
      <TimelineFileDiffBlockContent {...props} />
    </Suspense>
  );
}

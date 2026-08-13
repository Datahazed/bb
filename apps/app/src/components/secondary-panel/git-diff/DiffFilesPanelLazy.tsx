import { lazy, Suspense } from "react";
import { Skeleton } from "@bb/shared-ui/skeleton";
import type { DiffFilesPanelProps } from "./DiffFilesPanel";

export type { DiffFilesPanelProps } from "./DiffFilesPanel";

/**
 * Loads the diff tab's renderer only when a user opens the diff tab.
 *
 * `DiffFilesPanel` reaches `@pierre/diffs` and Shiki through `DiffFileCard`.
 * The secondary panel mounts on every thread page, so a static import puts
 * about 1 MB of JavaScript on the thread route's preload set.
 */
const DiffFilesPanelSurface = lazy(() =>
  import("./DiffFilesPanel").then((module) => ({
    default: module.DiffFilesPanel,
  })),
);

export function DiffFilesPanel(props: DiffFilesPanelProps) {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-0 flex-1 flex-col gap-1.5 px-4 pb-3">
          <Skeleton className="h-3 w-full rounded-sm" />
          <Skeleton className="h-3 w-[94%] rounded-sm" />
          <Skeleton className="h-3 w-[90%] rounded-sm" />
          <Skeleton className="h-3 w-[86%] rounded-sm" />
        </div>
      }
    >
      <DiffFilesPanelSurface {...props} />
    </Suspense>
  );
}

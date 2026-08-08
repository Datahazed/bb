import { lazy, Suspense } from "react";
import type { ThreadTimelineRowsProps } from "./ThreadTimelineRows.js";

const ThreadTimelineRowsImpl = lazy(() =>
  import("./ThreadTimelineRows.js").then((module) => ({
    default: module.ThreadTimelineRows,
  })),
);

export function ThreadTimelineRows(props: ThreadTimelineRowsProps) {
  return (
    <Suspense
      fallback={
        <div className="space-y-3 py-4" aria-busy="true">
          <div className="h-16 w-3/4 animate-pulse rounded-lg bg-surface-recessed" />
          <div className="ml-auto h-10 w-1/2 animate-pulse rounded-lg bg-surface-recessed" />
        </div>
      }
    >
      <ThreadTimelineRowsImpl {...props} />
    </Suspense>
  );
}

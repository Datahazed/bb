import type { SidebarBootstrapResponse } from "@bb/server-contract";
import { isUnreadDoneThread } from "@bb/client-core";

/**
 * App-icon badge = threads that want the user's attention on the active
 * server: root threads that finished (idle / error) since they were last
 * read, plus threads blocked on a pending interaction. Derived client-side
 * from the sidebar bootstrap (`GET /system/attention` is only a boolean).
 */
export function badgeCountFromSidebar(
  bootstrap: Pick<SidebarBootstrapResponse, "projects" | "personalProject">,
): number {
  let count = 0;
  const projects = [...bootstrap.projects, bootstrap.personalProject];
  for (const project of projects) {
    for (const thread of project.threads) {
      if (thread.archivedAt !== null || thread.deletedAt !== null) continue;
      if (thread.parentThreadId !== null) continue;
      if (thread.hasPendingInteraction || isUnreadDoneThread(thread)) {
        count += 1;
      }
    }
  }
  return count;
}

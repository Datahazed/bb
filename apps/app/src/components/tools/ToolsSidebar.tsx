import type { MouseEvent as ReactMouseEvent } from "react";
import { Link, useLocation } from "react-router-dom";
import { Button } from "@bb/shared-ui/button";
import { Icon } from "@bb/shared-ui/icon";
import {
  SectionSidebar,
  SectionSidebarIcon,
  SectionSidebarLabel,
  SectionSidebarRow,
} from "@/components/sidebar/SectionSidebar";
import { getPluginsRoutePath } from "@/lib/route-paths";
import { resolveToolsActivePage, TOOLS_PAGES } from "./tools-navigation";

const TOOLS_SIDEBAR_GROUPS = [
  {
    id: "discover",
    label: "Discover",
    description: "Find plugins and reusable agent skills.",
    pageIds: ["plugins-browse", "skills-browse"],
  },
  {
    id: "manage",
    label: "Manage",
    description: "Review what is installed on this bb.",
    pageIds: ["plugins-installed", "skills-installed"],
  },
  {
    id: "build",
    label: "Build",
    description: "Manage extensions you can publish or maintain.",
    pageIds: ["plugins-my", "skills-my"],
  },
] as const;

/**
 * The Extensions navigation, in the settings-sidebar treatment: each section
 * is a label and each of its pages is a row, so the sidebar is the one place
 * that lists every page — the pages themselves carry no tab layer.
 *
 * Rows and active-state come from `tools-navigation`'s canonical tables, so
 * the highlight always agrees with the ownership the breadcrumb resolver and
 * detail-route origin encode.
 */
export function ToolsSidebar({
  appRoutePath,
  isResizing,
  mobileHosted,
  onResizeMouseDown,
  showTopReserve,
}: {
  appRoutePath: string;
  isResizing: boolean;
  /** Render the body only, inside a compact drawer panel owned by the caller. */
  mobileHosted?: boolean;
  onResizeMouseDown: (event: ReactMouseEvent<HTMLDivElement>) => void;
  showTopReserve: boolean;
}) {
  const location = useLocation();
  const activePage = resolveToolsActivePage(location.pathname, location.search);

  return (
    <SectionSidebar
      backLabel="Back to app"
      backTo={appRoutePath}
      isResizing={isResizing}
      mobileHosted={mobileHosted}
      onResizeMouseDown={onResizeMouseDown}
      showTopReserve={showTopReserve}
      testIdPrefix="tools"
    >
      <div className="flex min-h-full flex-col pb-3">
        <div>
          {TOOLS_SIDEBAR_GROUPS.map((group, index) => (
            <section
              key={group.id}
              className={index > 0 ? "mt-5" : undefined}
              aria-labelledby={`tools-sidebar-${group.id}`}
            >
              <SectionSidebarLabel>
                <span id={`tools-sidebar-${group.id}`}>{group.label}</span>
              </SectionSidebarLabel>
              <p className="px-2 pb-1 text-2xs leading-relaxed text-subtle-foreground">
                {group.description}
              </p>
              <div className="space-y-0.5">
                {group.pageIds.map((pageId) => {
                  const page = TOOLS_PAGES.find(
                    (candidate) => candidate.id === pageId,
                  );
                  if (page === undefined) return null;
                  return (
                    <SectionSidebarRow
                      key={page.id}
                      active={activePage === page.id}
                      label={page.label}
                      to={page.to}
                    >
                      <SectionSidebarIcon name={page.icon} />
                    </SectionSidebarRow>
                  );
                })}
              </div>
            </section>
          ))}
        </div>

        <aside className="mt-auto pt-6">
          <div className="rounded-lg border border-sidebar-border bg-sidebar-accent/45 p-3">
            <div className="flex items-center gap-2 text-xs font-medium text-sidebar-foreground">
              <Icon name="Puzzle" className="size-3.5" aria-hidden />
              Build for bb
            </div>
            <p className="mt-1.5 text-2xs leading-relaxed text-subtle-foreground">
              Describe an extension and start it from a prompt.
            </p>
            <Button
              asChild
              variant="outline"
              size="sm"
              className="mt-3 h-7 w-full justify-start gap-2 bg-background px-2 text-xs font-normal"
            >
              <Link to={`${getPluginsRoutePath()}?view=create`}>
                <Icon name="MessageSquarePlus" className="size-3.5" />
                Create a plugin
              </Link>
            </Button>
          </div>
        </aside>
      </div>
    </SectionSidebar>
  );
}

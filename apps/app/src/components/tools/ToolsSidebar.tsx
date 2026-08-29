import type { MouseEvent as ReactMouseEvent } from "react";
import { useLocation } from "react-router-dom";
import { Icon } from "@bb/shared-ui/icon";
import {
  SectionSidebar,
  SectionSidebarLabel,
  SectionSidebarRow,
} from "@/components/sidebar/SectionSidebar";
import { usePluginList } from "@/hooks/queries/plugin-settings-queries";
import { resolveToolsActivePage, TOOLS_PAGES } from "./tools-navigation";

/**
 * Extensions has exactly two things in it, so the sidebar says so: one group
 * per noun, each carrying that noun's icon. The rows below a group are its
 * three views, and they stay plain text — an icon per row competed with the
 * group mark and gave the eye four things to read where the group heading
 * already answers "which of the two is this".
 */
const TOOLS_SIDEBAR_GROUPS = [
  {
    id: "plugins",
    label: "Plugins",
    icon: "ElectricPlugs",
    pageIds: ["plugins-browse", "plugins-installed", "plugins-my"],
  },
  {
    id: "skills",
    label: "Skills",
    icon: "Zap",
    pageIds: ["skills-browse", "skills-installed", "skills-my"],
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
  const pluginList = usePluginList({ enabled: true });
  // Installed is absent until the shared query proves there is something to
  // manage, so an empty account never sees the row flash and disappear.
  const showInstalledPlugins = (pluginList.data?.plugins.length ?? 0) > 0;

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
      <div className="pb-3">
        {TOOLS_SIDEBAR_GROUPS.map((group, index) => (
          <section
            key={group.id}
            className={index > 0 ? "mt-4" : undefined}
            aria-labelledby={`tools-sidebar-${group.id}`}
          >
            <SectionSidebarLabel>
              <span
                id={`tools-sidebar-${group.id}`}
                className="flex items-center gap-1.5"
              >
                <Icon name={group.icon} className="size-3.5" aria-hidden />
                {group.label}
              </span>
            </SectionSidebarLabel>
            <div className="mt-1 space-y-0.5">
              {group.pageIds.map((pageId) => {
                if (
                  pageId === "plugins-installed" &&
                  !showInstalledPlugins
                ) {
                  return null;
                }
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
                    {null}
                  </SectionSidebarRow>
                );
              })}
            </div>
          </section>
        ))}
      </div>
    </SectionSidebar>
  );
}

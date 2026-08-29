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

export function ToolsSidebar({
  appRoutePath,
  isResizing,
  mobileHosted,
  onResizeMouseDown,
  showTopReserve,
}: {
  appRoutePath: string;
  isResizing: boolean;
  mobileHosted?: boolean;
  onResizeMouseDown: (event: ReactMouseEvent<HTMLDivElement>) => void;
  showTopReserve: boolean;
}) {
  const location = useLocation();
  const activePage = resolveToolsActivePage(location.pathname, location.search);
  const pluginList = usePluginList({ enabled: true });
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

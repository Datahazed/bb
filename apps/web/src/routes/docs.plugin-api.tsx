import { useEffect, useMemo, useState } from "react";
import { createFileRoute, Outlet, useLocation } from "@tanstack/react-router";

import appCss from "../styles.css?url";
import docsCss from "../docs-plugin-api/docs.css?url";
import { DocsShell } from "../docs-plugin-api/docs-shell";
import { SurfacesNav } from "../docs-plugin-api/surfaces-nav";
import { SURFACES_BY_ID } from "@bb/plugin-api-map";

export const Route = createFileRoute("/docs/plugin-api")({
  head: () => ({
    meta: [
      { title: "Plugin API — bb" },
      {
        name: "description",
        content:
          "Reference documentation for the bb plugin SDK: the backend BbPluginApi, the frontend app surface, host workers, provider bridges, and the testing harnesses.",
      },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "stylesheet", href: docsCss },
    ],
  }),
  component: DocsLayout,
});

function DocsLayout() {
  const location = useLocation();

  // Sidebar state: hover highlights a row, a click expands it in place.
  const [activeId, setActiveId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // Client-side navigations keep the document, so drive hash targets and
  // page-top scrolling ourselves. A #surface-<id> hash expands its nav row.
  useEffect(() => {
    if (location.hash) {
      const anchor = decodeURIComponent(location.hash.replace(/^#/, ""));
      const surfaceMatch = anchor.match(/^surface-(.+)$/);
      if (surfaceMatch && SURFACES_BY_ID.has(surfaceMatch[1])) {
        setExpandedId(surfaceMatch[1]);
        return;
      }
      const target = document.getElementById(anchor);
      if (target) {
        target.scrollIntoView({ block: "start" });
        return;
      }
    }
    window.scrollTo(0, 0);
  }, [location.pathname, location.hash]);

  const navState = useMemo(
    () => ({ activeId, setActiveId, expandedId, setExpandedId }),
    [activeId, expandedId],
  );

  // Only the product map runs without a sidebar.
  const pathname = location.pathname.replace(/\/$/, "");
  const isProductMap = pathname === "/docs/plugin-api";

  // The layout gallery renders whole candidate layouts, sidebar included, so
  // the shell stays out of its way. Unlinked; delete with the gallery.
  if (pathname === "/docs/plugin-api/layouts") {
    return <Outlet />;
  }

  return (
    // The map is the diagram and nothing else: annotations open cards beside
    // the skeleton, so it ships no sidebar. Reference pages keep the standard
    // sidebar and chrome.
    <DocsShell
      renderNav={
        isProductMap
          ? undefined
          : ({ onNavigate }) => (
              <SurfacesNav state={navState} onNavigate={onNavigate} />
            )
      }
    >
      <Outlet />
    </DocsShell>
  );
}

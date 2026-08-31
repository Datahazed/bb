import { lazy, useEffect, useMemo } from "react";
import {
  matchPath,
  Navigate,
  useLocation,
  useNavigate,
} from "react-router-dom";
import { useAtomValue } from "jotai";
import { splitLayoutAtom } from "@/lib/split-layout/atoms";
import { holdsPluginDetailPane } from "@/lib/split-layout/openPaneContentInSplit";
import "@bb/shared-ui/icon-extended";
import {
  APP_ROOT_ROUTE_PATH,
  LEGACY_PROJECT_COMPOSE_ROUTE_PATH,
  PLUGIN_PANEL_ROUTE_PATH,
  TOOLS_PLUGIN_DETAIL_ROUTE_PATH,
} from "@/lib/route-paths";
import type { PaneContent } from "@/lib/split-layout";
import { createNewThreadDraftSlotId } from "@/lib/prompt-draft-slots";
import {
  readRootComposeDraftSlotId,
  withRootComposeDraftSlotId,
} from "@/lib/root-compose-location-state";
import { useRouteState } from "@/hooks/useRouteState";
import { LegacyProjectComposeRedirect } from "./RootComposeView";
import { SplitThreadArea } from "./thread-detail/SplitThreadArea";

function createDraftSlotForLocationEntry(_locationKey: string): string {
  return createNewThreadDraftSlotId();
}

const ToolsView = lazy(() =>
  import("./ToolsView").then((m) => ({ default: m.ToolsView })),
);

export default function SplitWorkspaceRoute() {
  const location = useLocation();
  const navigate = useNavigate();
  const { projectId, threadId, isThreadView } = useRouteState();
  const pluginMatch = matchPath(PLUGIN_PANEL_ROUTE_PATH, location.pathname);
  const pluginDetailMatch = matchPath(
    TOOLS_PLUGIN_DETAIL_ROUTE_PATH,
    location.pathname,
  );
  const legacyProjectMatch = matchPath(
    LEGACY_PROJECT_COMPOSE_ROUTE_PATH,
    location.pathname,
  );
  const pluginId = pluginMatch?.params.pluginId;
  const panelPath = pluginMatch?.params.panelPath;
  const pluginSubPath = pluginMatch?.params["*"] ?? "";
  const detailPluginId = pluginDetailMatch?.params.pluginId;

  const rootComposeDraftSlotId = useMemo(() => {
    if (location.pathname !== APP_ROOT_ROUTE_PATH) return null;
    const explicitDraftSlotId = readRootComposeDraftSlotId(location.state);
    if (explicitDraftSlotId !== null) return explicitDraftSlotId;
    return createDraftSlotForLocationEntry(location.key);
  }, [location.key, location.pathname, location.state]);

  useEffect(() => {
    if (
      location.pathname !== APP_ROOT_ROUTE_PATH ||
      rootComposeDraftSlotId === null ||
      readRootComposeDraftSlotId(location.state) !== null
    ) {
      return;
    }
    void navigate(
      {
        pathname: location.pathname,
        search: location.search,
        hash: location.hash,
      },
      {
        replace: true,
        state: withRootComposeDraftSlotId(
          location.state,
          rootComposeDraftSlotId,
        ),
      },
    );
  }, [
    location.hash,
    location.pathname,
    location.search,
    location.state,
    navigate,
    rootComposeDraftSlotId,
  ]);

  const routeContent = useMemo<PaneContent | null>(() => {
    if (
      location.pathname === APP_ROOT_ROUTE_PATH &&
      rootComposeDraftSlotId !== null
    ) {
      return {
        kind: "new-thread",
        draftSlotId: rootComposeDraftSlotId,
      };
    }
    if (isThreadView && projectId && threadId) {
      return { kind: "thread", projectId, threadId };
    }
    if (detailPluginId) {
      return { kind: "plugin-detail", pluginId: detailPluginId };
    }
    if (pluginId && panelPath) {
      return {
        kind: "plugin-panel",
        pluginId,
        panelPath,
        subPath: pluginSubPath,
      };
    }
    return null;
  }, [
    detailPluginId,
    isThreadView,
    location.pathname,
    panelPath,
    pluginId,
    pluginSubPath,
    projectId,
    rootComposeDraftSlotId,
    threadId,
  ]);

  const layout = useAtomValue(splitLayoutAtom);

  const legacyProjectId = legacyProjectMatch?.params.projectId;
  if (legacyProjectId) {
    return <LegacyProjectComposeRedirect projectId={legacyProjectId} />;
  }
  if (routeContent === null) {
    return <Navigate to={APP_ROOT_ROUTE_PATH} replace />;
  }
  if (
    routeContent.kind === "plugin-detail" &&
    !holdsPluginDetailPane(layout, routeContent.pluginId)
  ) {
    return <ToolsView pluginId={routeContent.pluginId} />;
  }
  return <SplitThreadArea routeContent={routeContent} />;
}

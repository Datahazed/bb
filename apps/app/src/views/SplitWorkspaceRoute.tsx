import { useEffect, useMemo } from "react";
import {
  matchPath,
  Navigate,
  useLocation,
  useNavigate,
} from "react-router-dom";
// Route views render icons outside the shell's core set. Importing the
// extended registry here ships it as a static dependency of this route chunk,
// so those icons never flash blank waiting for an on-demand load.
import "@bb/shared-ui/icon-extended";
import {
  APP_ROOT_ROUTE_PATH,
  LEGACY_PROJECT_COMPOSE_ROUTE_PATH,
  PLUGIN_PANEL_ROUTE_PATH,
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

/**
 * Stable route owner for every page that can live in the split workspace.
 *
 * All supported URLs intentionally match the same outer `*` route in App.tsx.
 * Focus-driven URL changes therefore update `routeContent` without replacing
 * this component or remounting the split tree and its plugin/compose panes.
 */
export default function SplitWorkspaceRoute() {
  const location = useLocation();
  const navigate = useNavigate();
  const { projectId, threadId, isThreadView } = useRouteState();
  const pluginMatch = matchPath(PLUGIN_PANEL_ROUTE_PATH, location.pathname);
  const legacyProjectMatch = matchPath(
    LEGACY_PROJECT_COMPOSE_ROUTE_PATH,
    location.pathname,
  );
  const pluginId = pluginMatch?.params.pluginId;
  const panelPath = pluginMatch?.params.panelPath;
  const pluginSubPath = pluginMatch?.params["*"] ?? "";

  const rootComposeDraftSlotId = useMemo(() => {
    if (location.pathname !== APP_ROOT_ROUTE_PATH) return null;
    const explicitDraftSlotId = readRootComposeDraftSlotId(location.state);
    if (explicitDraftSlotId !== null) return explicitDraftSlotId;
    return createDraftSlotForLocationEntry(location.key);
  }, [location.key, location.pathname, location.state]);

  // Turn an implicit public compose arrival into an explicit history entry.
  // This preserves the generated binding across rerenders and reload/restore
  // without changing the existing one-shot compose seed fields.
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
    isThreadView,
    location.pathname,
    panelPath,
    pluginId,
    pluginSubPath,
    projectId,
    rootComposeDraftSlotId,
    threadId,
  ]);

  const legacyProjectId = legacyProjectMatch?.params.projectId;
  if (legacyProjectId) {
    return <LegacyProjectComposeRedirect projectId={legacyProjectId} />;
  }
  if (routeContent === null) {
    return <Navigate to={APP_ROOT_ROUTE_PATH} replace />;
  }
  return <SplitThreadArea routeContent={routeContent} />;
}

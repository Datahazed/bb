import { useEffect, useRef } from "react";
import { matchPath, useLocation } from "react-router-dom";
import { refreshNewThreadDraftSlots } from "@/hooks/usePromptDraftStorage";
import {
  initializeNewThreadDraftSlots,
  resolveNewThreadDraftDestination,
} from "@/lib/prompt-draft-slots";
import { readRootComposeSectionId } from "@/lib/root-compose-location-state";
import {
  APP_ROOT_ROUTE_PATH,
  LEGACY_PROJECT_COMPOSE_ROUTE_PATH,
} from "@/lib/route-paths";
import { readRootComposeProjectId } from "@/lib/root-compose-selection";

export function AppLocalStateInitialization() {
  const didInitializeDraftSlots = useRef(false);
  const location = useLocation();

  useEffect(() => {
    if (didInitializeDraftSlots.current) return;
    didInitializeDraftSlots.current = true;
    const legacyProjectMatch = matchPath(
      LEGACY_PROJECT_COMPOSE_ROUTE_PATH,
      location.pathname,
    );
    const isComposeRoute =
      location.pathname === APP_ROOT_ROUTE_PATH || legacyProjectMatch !== null;
    initializeNewThreadDraftSlots(
      resolveNewThreadDraftDestination({
        storedDestination: null,
        routeProjectId: legacyProjectMatch?.params.projectId ?? null,
        routeSectionId: isComposeRoute
          ? readRootComposeSectionId(location.state)
          : null,
        fallbackProjectId: readRootComposeProjectId(),
      }),
    );
    refreshNewThreadDraftSlots();
  }, [location.pathname, location.state]);

  return null;
}

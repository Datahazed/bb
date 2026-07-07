import { useLocation, useMatch } from "react-router-dom";
import { PERSONAL_PROJECT_ID } from "@bb/domain";

export interface RouteState {
  /** ID of the project in view (any project-scoped route), else undefined. */
  projectId: string | undefined;
  /** ID of the thread in view (thread detail only), else undefined. */
  threadId: string | undefined;
  /** On a thread detail URL. */
  isThreadView: boolean;
  /** On a project or projectless archived threads list. */
  isArchivedView: boolean;
  /** On the project settings page. */
  isSettingsView: boolean;
  /** On the Tools hub or one of its tool-type subroutes. */
  isToolsView: boolean;
  /**
   * On the Automations surface: the cross-project list
   * ("/tools/automations") or an automation detail page. True for both so the
   * Tools sidebar entry stays active.
   */
  isAutomationsView: boolean;
  /** On an automation detail page. */
  isAutomationDetailView: boolean;
  /** On the Skills surface ("/tools/skills"). */
  isSkillsView: boolean;
  /** ID of the automation in view (automation detail only), else undefined. */
  automationId: string | undefined;
  /** Owning project of the automation in view (automation detail only). */
  automationProjectId: string | undefined;
  /** On the root route ("/"). */
  isRootView: boolean;
  /** On a projectless surface: compose, thread detail, or archived threads. */
  isProjectlessView: boolean;
}

/**
 * Single source of truth for URL → logical route state. All route pattern
 * matching for "what view are we in" happens here so that shifts in the route
 * schema have one place to update instead of N scattered `useMatch` calls.
 */
export function useRouteState(): RouteState {
  const location = useLocation();
  // Wildcard match exists only to extract `projectId` from any
  // project-scoped subroute; specific-view detection uses exact matches so a
  // new subroute doesn't accidentally count as the root compose redirect.
  const projectMatch = useMatch("/projects/:projectId/*");
  const projectThreadMatch = useMatch(
    "/projects/:projectId/threads/:threadId/*",
  );
  const projectlessThreadMatch = useMatch("/threads/:threadId/*");
  const popoutProjectThreadMatch = useMatch(
    "/popout/projects/:projectId/threads/:threadId/*",
  );
  const popoutProjectlessThreadMatch = useMatch("/popout/threads/:threadId/*");
  const projectlessArchivedMatch = useMatch("/archived");
  const projectArchivedMatch = useMatch("/projects/:projectId/archived");
  const projectSettingsMatch = useMatch("/projects/:projectId/settings");
  const toolsAutomationDetailMatch = useMatch(
    "/tools/automations/:projectId/:automationId",
  );
  const legacyAutomationDetailMatch = useMatch(
    "/automations/:projectId/:automationId",
  );
  const automationDetailMatch =
    toolsAutomationDetailMatch ?? legacyAutomationDetailMatch;
  const isToolsView =
    location.pathname === "/tools" || location.pathname.startsWith("/tools/");
  const isRootView = location.pathname === "/";
  const isUnsupportedPersonalProjectThread =
    projectThreadMatch?.params.projectId === PERSONAL_PROJECT_ID ||
    popoutProjectThreadMatch?.params.projectId === PERSONAL_PROJECT_ID;
  const projectlessThreadId =
    projectlessThreadMatch?.params.threadId ??
    popoutProjectlessThreadMatch?.params.threadId;
  const threadId =
    projectlessThreadId ??
    (isUnsupportedPersonalProjectThread
      ? undefined
      : (projectThreadMatch?.params.threadId ??
        popoutProjectThreadMatch?.params.threadId));
  const projectRouteProjectId =
    projectMatch?.params.projectId ??
    popoutProjectThreadMatch?.params.projectId;
  const projectId =
    projectlessThreadId !== undefined || Boolean(projectlessArchivedMatch)
      ? PERSONAL_PROJECT_ID
      : isUnsupportedPersonalProjectThread
        ? undefined
        : projectRouteProjectId;

  return {
    projectId,
    threadId,
    isThreadView:
      Boolean(projectlessThreadMatch) ||
      Boolean(popoutProjectlessThreadMatch) ||
      ((Boolean(projectThreadMatch) || Boolean(popoutProjectThreadMatch)) &&
        !isUnsupportedPersonalProjectThread),
    isArchivedView:
      Boolean(projectArchivedMatch) || Boolean(projectlessArchivedMatch),
    isSettingsView: Boolean(projectSettingsMatch),
    isToolsView:
      isToolsView ||
      location.pathname === "/skills" ||
      location.pathname === "/automations" ||
      Boolean(legacyAutomationDetailMatch),
    isAutomationsView:
      location.pathname === "/tools/automations" ||
      location.pathname === "/automations" ||
      Boolean(automationDetailMatch),
    isAutomationDetailView: Boolean(automationDetailMatch),
    isSkillsView:
      location.pathname === "/tools/skills" || location.pathname === "/skills",
    automationId: automationDetailMatch?.params.automationId,
    automationProjectId: automationDetailMatch?.params.projectId,
    isRootView,
    isProjectlessView:
      isRootView ||
      projectlessThreadId !== undefined ||
      Boolean(projectlessArchivedMatch),
  };
}

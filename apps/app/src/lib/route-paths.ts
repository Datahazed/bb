import { PERSONAL_PROJECT_ID } from "@bb/domain";
import {
  POPOUT_ROUTE_PATH,
  getDesktopPopoutThreadRoutePath,
  type BbDesktopPopoutThreadRef,
} from "@bb/desktop-contract";
import { matchPath } from "react-router-dom";

export { POPOUT_ROUTE_PATH };

export const APP_ROOT_ROUTE_PATH = "/";
export const AUTH_CALLBACK_ROUTE_PATH = "/auth/callback";
export const POPOUT_PROJECTLESS_THREAD_DETAIL_ROUTE_PATH =
  "/popout/threads/:threadId";
export const POPOUT_THREAD_DETAIL_ROUTE_PATH =
  "/popout/projects/:projectId/threads/:threadId";
export const SETTINGS_ROUTE_PATH = "/settings";
export const SETTINGS_SECTION_ROUTE_PATH = "/settings/:section";
// Legacy Settings URLs redirect into the canonical Plugins resource surface.
export const SETTINGS_PLUGINS_ROUTE_PATH = "/settings/plugins";
export const SETTINGS_PLUGIN_ROUTE_PATH = "/settings/plugins/:pluginId";
export const TOOLS_ROUTE_PATH = "/tools";
export const TOOLS_SKILLS_ROUTE_PATH = "/tools/skills";
export const TOOLS_SKILL_DETAIL_ROUTE_PATH =
  "/tools/skills/installed/:scope/:providerId/:skillName";
export const TOOLS_REGISTRY_SKILLS_ROUTE_PATH = "/tools/skills/registry";
export const TOOLS_REGISTRY_SKILL_DETAIL_ROUTE_PATH =
  "/tools/skills/registry/:registrySkillId";
export const TOOLS_PLUGINS_ROUTE_PATH = "/tools/plugins";
export const TOOLS_PLUGIN_BROWSE_ROUTE_PATH = "/tools/plugins/browse";
export const TOOLS_PLUGIN_DETAIL_ROUTE_PATH = "/tools/plugins/:pluginId";
export const TOOLS_AUTOMATIONS_ROUTE_PATH = "/tools/automations";
export const TOOLS_AUTOMATION_BROWSE_ROUTE_PATH = "/tools/automations/browse";
export const TOOLS_AUTOMATION_DETAIL_ROUTE_PATH =
  "/tools/automations/:projectId/:automationId";
export const TOOLS_AUTOMATION_EDIT_ROUTE_PATH =
  "/tools/automations/:projectId/:automationId/edit";
export const LEGACY_AUTOMATIONS_ROUTE_PATH = "/automations";
export const LEGACY_AUTOMATION_DETAIL_ROUTE_PATH =
  "/automations/:projectId/:automationId";
export const LEGACY_SKILLS_ROUTE_PATH = "/skills";
export const AUTOMATIONS_PLUGIN_ID = "automations";
export const AUTOMATIONS_PLUGIN_PANEL_PATH = "automations";
export const AUTOMATIONS_ROUTE_PATH = TOOLS_AUTOMATIONS_ROUTE_PATH;
export const AUTOMATION_DETAIL_ROUTE_PATH = TOOLS_AUTOMATION_DETAIL_ROUTE_PATH;
export const SKILLS_ROUTE_PATH = TOOLS_SKILLS_ROUTE_PATH;
export const SETTINGS_PROVIDER_ROUTE_PATH = "/settings/providers/:providerId";
export const ROOT_COMPOSE_ROUTE_PATH = APP_ROOT_ROUTE_PATH;
export const LEGACY_PROJECT_COMPOSE_ROUTE_PATH = "/projects/:projectId";
export const PROJECTLESS_ARCHIVED_ROUTE_PATH = "/archived";
export const PROJECTLESS_THREAD_DETAIL_ROUTE_PATH = "/threads/:threadId";
export const PROJECT_SETTINGS_ROUTE_PATH = "/projects/:projectId/settings";
export const PROJECT_ARCHIVED_ROUTE_PATH = "/projects/:projectId/archived";
export const THREAD_DETAIL_ROUTE_PATH =
  "/projects/:projectId/threads/:threadId";
// Trailing splat: the remainder is the panel's `subPath` (empty at the root).
export const PLUGIN_PANEL_ROUTE_PATH = "/plugins/:pluginId/:panelPath/*";

export interface ThreadRoutePathArgs {
  projectId: string;
  threadId: string;
}

export type ThreadRouteSurface = "page" | "popout";

export interface SurfaceAwareThreadRoutePathArgs extends ThreadRoutePathArgs {
  surface: ThreadRouteSurface;
}

export interface IsRoutePathArgs {
  path: string;
}

export interface ResolveRouteHrefArgs {
  currentOrigin: string;
  href: string;
}

export interface RouteHrefResolution {
  path: string;
}

export function isProjectlessProjectId(
  projectId: string | null | undefined,
): boolean {
  return projectId === PERSONAL_PROJECT_ID;
}

export function getRootComposeRoutePath(): string {
  return ROOT_COMPOSE_ROUTE_PATH;
}

export function getAutomationsRoutePath(): string {
  return AUTOMATIONS_ROUTE_PATH;
}

export function getSkillsRoutePath(): string {
  return SKILLS_ROUTE_PATH;
}

export function getRegistrySkillsRoutePath(): string {
  return TOOLS_REGISTRY_SKILLS_ROUTE_PATH;
}

export interface SkillDetailRoutePathArgs {
  scope: string;
  providerId: string | null;
  skillName: string;
}

export function getSkillDetailRoutePath({
  scope,
  providerId,
  skillName,
}: SkillDetailRoutePathArgs): string {
  return `${TOOLS_SKILLS_ROUTE_PATH}/installed/${encodeURIComponent(
    scope,
  )}/${encodeURIComponent(providerId ?? "bb")}/${encodeURIComponent(
    skillName,
  )}`;
}

export interface RegistrySkillDetailRoutePathArgs {
  registrySkillId: string;
}

export function getRegistrySkillDetailRoutePath({
  registrySkillId,
}: RegistrySkillDetailRoutePathArgs): string {
  return `${TOOLS_SKILLS_ROUTE_PATH}/registry/${encodeURIComponent(
    registrySkillId,
  )}`;
}

export function getToolsRoutePath(): string {
  return TOOLS_ROUTE_PATH;
}

export function getPluginsRoutePath(): string {
  return TOOLS_PLUGINS_ROUTE_PATH;
}

export interface PluginDetailRoutePathArgs {
  pluginId: string;
}

export function getPluginDetailRoutePath({
  pluginId,
}: PluginDetailRoutePathArgs): string {
  return `${TOOLS_PLUGINS_ROUTE_PATH}/${encodeURIComponent(pluginId)}`;
}

export interface AutomationDetailRoutePathArgs {
  projectId: string;
  automationId: string;
}

export function getAutomationDetailRoutePath({
  projectId,
  automationId,
}: AutomationDetailRoutePathArgs): string {
  return `/tools/automations/${encodeURIComponent(
    projectId,
  )}/${encodeURIComponent(automationId)}`;
}

export function getAutomationEditRoutePath({
  projectId,
  automationId,
}: AutomationDetailRoutePathArgs): string {
  return `${getAutomationDetailRoutePath({ projectId, automationId })}/edit`;
}

export function getPopoutRoutePath(): string {
  return POPOUT_ROUTE_PATH;
}

export function getPopoutThreadRoutePath(args: ThreadRoutePathArgs): string {
  const thread: BbDesktopPopoutThreadRef = {
    projectId: args.projectId,
    threadId: args.threadId,
  };
  return getDesktopPopoutThreadRoutePath(thread);
}

export function getLegacyProjectComposeRoutePath(projectId: string): string {
  return `/projects/${projectId}`;
}

// Opens a project's compose view. The personal project has no `/projects/:id`
// surface — its compose view is the app root — so it routes there instead.
export function getProjectComposeRoutePath(projectId: string): string {
  return isProjectlessProjectId(projectId)
    ? getRootComposeRoutePath()
    : getLegacyProjectComposeRoutePath(projectId);
}

export function getSettingsRoutePath(section?: string): string {
  return section === undefined
    ? SETTINGS_ROUTE_PATH
    : `/settings/${encodeURIComponent(section)}`;
}

export function getSettingsProviderRoutePath(providerId: string): string {
  return `/settings/providers/${encodeURIComponent(providerId)}`;
}

export function getProjectSettingsRoutePath(projectId: string): string {
  return `/projects/${projectId}/settings`;
}

export function getProjectlessArchivedRoutePath(): string {
  return PROJECTLESS_ARCHIVED_ROUTE_PATH;
}

export function getProjectArchivedRoutePath(projectId: string): string {
  if (isProjectlessProjectId(projectId)) {
    return getProjectlessArchivedRoutePath();
  }
  return `/projects/${projectId}/archived`;
}

// Folders live in the personal/projectless section, so a folder's archived
// list reuses the projectless archived route, scoped by a `folderId` query param.
export function getFolderArchivedRoutePath(folderId: string): string {
  return `${PROJECTLESS_ARCHIVED_ROUTE_PATH}?folderId=${encodeURIComponent(
    folderId,
  )}`;
}

export interface PluginPanelRoutePathArgs {
  pluginId: string;
  /** The nav panel's registered `path` segment (validated: [a-zA-Z0-9_-]+). */
  path: string;
  /** Location inside the panel; segments are encoded, slashes preserved. */
  subPath?: string;
}

export function getPluginPanelRoutePath({
  pluginId,
  path,
  subPath,
}: PluginPanelRoutePathArgs): string {
  const root = `/plugins/${encodeURIComponent(pluginId)}/${encodeURIComponent(path)}`;
  if (subPath === undefined || subPath === "") {
    return root;
  }
  const encoded = subPath
    .split("/")
    .filter((segment) => segment.length > 0)
    .map((segment) => encodeURIComponent(segment))
    .join("/");
  return encoded.length > 0 ? `${root}/${encoded}` : root;
}

export function getThreadRoutePath(args: ThreadRoutePathArgs): string {
  return isProjectlessProjectId(args.projectId)
    ? `/threads/${args.threadId}`
    : `/projects/${args.projectId}/threads/${args.threadId}`;
}

export function getSurfaceAwareThreadRoutePath(
  args: SurfaceAwareThreadRoutePathArgs,
): string {
  return args.surface === "popout"
    ? getPopoutThreadRoutePath(args)
    : getThreadRoutePath(args);
}

const baseRoutePatterns: readonly string[] = [
  APP_ROOT_ROUTE_PATH,
  AUTH_CALLBACK_ROUTE_PATH,
  POPOUT_ROUTE_PATH,
  POPOUT_PROJECTLESS_THREAD_DETAIL_ROUTE_PATH,
  POPOUT_THREAD_DETAIL_ROUTE_PATH,
  SETTINGS_ROUTE_PATH,
  SETTINGS_SECTION_ROUTE_PATH,
  SETTINGS_PLUGINS_ROUTE_PATH,
  SETTINGS_PLUGIN_ROUTE_PATH,
  SETTINGS_PROVIDER_ROUTE_PATH,
  LEGACY_PROJECT_COMPOSE_ROUTE_PATH,
  PROJECTLESS_ARCHIVED_ROUTE_PATH,
  PROJECT_SETTINGS_ROUTE_PATH,
  PROJECT_ARCHIVED_ROUTE_PATH,
  PROJECTLESS_THREAD_DETAIL_ROUTE_PATH,
  THREAD_DETAIL_ROUTE_PATH,
  TOOLS_ROUTE_PATH,
  TOOLS_SKILLS_ROUTE_PATH,
  TOOLS_SKILL_DETAIL_ROUTE_PATH,
  TOOLS_REGISTRY_SKILL_DETAIL_ROUTE_PATH,
  TOOLS_PLUGINS_ROUTE_PATH,
  TOOLS_PLUGIN_BROWSE_ROUTE_PATH,
  TOOLS_PLUGIN_DETAIL_ROUTE_PATH,
  TOOLS_AUTOMATIONS_ROUTE_PATH,
  TOOLS_AUTOMATION_BROWSE_ROUTE_PATH,
  TOOLS_AUTOMATION_DETAIL_ROUTE_PATH,
  TOOLS_AUTOMATION_EDIT_ROUTE_PATH,
  LEGACY_SKILLS_ROUTE_PATH,
  LEGACY_AUTOMATIONS_ROUTE_PATH,
  LEGACY_AUTOMATION_DETAIL_ROUTE_PATH,
  PLUGIN_PANEL_ROUTE_PATH,
];

export const ROUTE_PATTERNS = baseRoutePatterns;

const ABSOLUTE_HTTP_URL_PATTERN = /^https?:\/\//iu;

function stripPathSuffix(path: string): string {
  const queryIndex = path.indexOf("?");
  const hashIndex = path.indexOf("#");
  const suffixIndex =
    queryIndex === -1
      ? hashIndex
      : hashIndex === -1
        ? queryIndex
        : Math.min(queryIndex, hashIndex);
  return suffixIndex === -1 ? path : path.slice(0, suffixIndex);
}

export function isRoutePath({ path }: IsRoutePathArgs): boolean {
  const pathname = stripPathSuffix(path);
  return ROUTE_PATTERNS.some(
    (pattern) => matchPath(pattern, pathname) !== null,
  );
}

export function resolveRouteHref({
  currentOrigin,
  href,
}: ResolveRouteHrefArgs): RouteHrefResolution | null {
  if (
    href.length === 0 ||
    href.startsWith("//") ||
    (!href.startsWith("/") && !ABSOLUTE_HTTP_URL_PATTERN.test(href))
  ) {
    return null;
  }

  let url: URL;
  try {
    url = new URL(href, currentOrigin);
  } catch {
    return null;
  }

  if (url.origin !== currentOrigin || !isRoutePath({ path: url.pathname })) {
    return null;
  }

  return {
    path: `${url.pathname}${url.search}${url.hash}`,
  };
}

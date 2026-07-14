import { useEffect, useState } from "react";
import { PERSONAL_PROJECT_ID } from "@bb/domain";
import { ResourceListState } from "@bb/shared-ui/resource-list";
import { automationsOverviewResponseSchema } from "bb-plugin-automations/rpc-types";
import {
  Navigate,
  Route,
  Routes,
  useLocation,
  useNavigate,
} from "react-router-dom";
import { usePluginFrontendBoot } from "@/hooks/usePluginFrontendBoot";
import { fetchPluginList } from "@/hooks/queries/plugin-settings-queries";
import * as api from "@/lib/api";
import {
  AUTOMATIONS_ROUTE_PATH,
  TOOLS_AUTOMATION_BROWSE_ROUTE_PATH,
  TOOLS_AUTOMATION_DETAIL_ROUTE_PATH,
  TOOLS_AUTOMATION_EDIT_ROUTE_PATH,
  TOOLS_PLUGIN_BROWSE_ROUTE_PATH,
  TOOLS_PLUGIN_DETAIL_ROUTE_PATH,
  TOOLS_PLUGINS_ROUTE_PATH,
  TOOLS_REGISTRY_SKILL_DETAIL_ROUTE_PATH,
  TOOLS_REGISTRY_SKILLS_ROUTE_PATH,
  TOOLS_SKILL_DETAIL_ROUTE_PATH,
  TOOLS_SKILLS_ROUTE_PATH,
  TOOLS_ROUTE_PATH,
  getAutomationDetailRoutePath,
  getAutomationEditRoutePath,
  getPluginDetailRoutePath,
  getPluginsRoutePath,
  getRegistrySkillDetailRoutePath,
  getSkillDetailRoutePath,
  getSkillsRoutePath,
} from "@/lib/route-paths";
import { fetchRegistrySkills } from "@/views/SkillsView";
import { ToolsView } from "@/views/ToolsView";

export default {
  title: "Tools/Pages live data",
};

type LivePath = string | (() => Promise<string>);

function storyPath(location: ReturnType<typeof useLocation>): string {
  return `${location.pathname}${location.search}`;
}

/**
 * Route-level Ladle harness for the production ToolsView. It intentionally
 * owns no resource fixtures: lists, detail identifiers, file contents,
 * marketplace results, settings, and automation history all come from this
 * checkout's running dev server through Ladle's Vite proxy. The target seeds
 * only the initial route so production links and controls can navigate freely.
 */
function LiveToolsPage({ target }: { target: LivePath }) {
  const navigate = useNavigate();
  const location = useLocation();
  const [resolvedLivePath, setResolvedLivePath] = useState<string | null>(null);
  const [openedLivePath, setOpenedLivePath] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const resolvedPath = typeof target === "string" ? target : resolvedLivePath;

  // Automations are a built-in plugin app surface, so stories boot the same
  // frontend bundle loader that production uses before mounting ToolsView.
  usePluginFrontendBoot();

  useEffect(() => {
    setError(null);
    if (typeof target === "string") {
      setResolvedLivePath(null);
      return;
    }
    setResolvedLivePath(null);
    let cancelled = false;
    void target().then(
      (path) => {
        if (!cancelled) setResolvedLivePath(path);
      },
      (reason: unknown) => {
        if (cancelled) return;
        setError(reason instanceof Error ? reason.message : String(reason));
      },
    );
    return () => {
      cancelled = true;
    };
  }, [target]);

  useEffect(() => {
    if (resolvedPath === null || openedLivePath === resolvedPath) return;
    if (storyPath(location) !== resolvedPath) {
      navigate(resolvedPath, { replace: true });
      return;
    }
    setOpenedLivePath(resolvedPath);
  }, [location, navigate, openedLivePath, resolvedPath]);

  if (error !== null) {
    return (
      <div className="mx-auto w-full max-w-3xl p-5">
        <ResourceListState state="error" message={error} />
      </div>
    );
  }
  if (resolvedPath === null || openedLivePath !== resolvedPath) {
    return (
      <div className="mx-auto w-full max-w-3xl p-5">
        <ResourceListState state="loading" message="Opening live page" />
      </div>
    );
  }

  return (
    <div className="flex h-screen min-w-0 flex-col p-4 md:p-5">
      <Routes>
        <Route
          path={TOOLS_ROUTE_PATH}
          element={<Navigate to={TOOLS_SKILLS_ROUTE_PATH} replace />}
        />
        <Route path={TOOLS_SKILLS_ROUTE_PATH} element={<ToolsView />} />
        <Route path={TOOLS_SKILL_DETAIL_ROUTE_PATH} element={<ToolsView />} />
        <Route
          path={TOOLS_REGISTRY_SKILLS_ROUTE_PATH}
          element={<ToolsView />}
        />
        <Route
          path={TOOLS_REGISTRY_SKILL_DETAIL_ROUTE_PATH}
          element={<ToolsView />}
        />
        <Route path={TOOLS_PLUGINS_ROUTE_PATH} element={<ToolsView />} />
        <Route
          path={TOOLS_PLUGIN_BROWSE_ROUTE_PATH}
          element={<Navigate to={TOOLS_PLUGINS_ROUTE_PATH} replace />}
        />
        <Route path={TOOLS_PLUGIN_DETAIL_ROUTE_PATH} element={<ToolsView />} />
        <Route path={AUTOMATIONS_ROUTE_PATH} element={<ToolsView />} />
        <Route
          path={TOOLS_AUTOMATION_BROWSE_ROUTE_PATH}
          element={
            <Navigate to={`${AUTOMATIONS_ROUTE_PATH}?view=browse`} replace />
          }
        />
        <Route
          path={TOOLS_AUTOMATION_EDIT_ROUTE_PATH}
          element={<ToolsView />}
        />
        <Route
          path={TOOLS_AUTOMATION_DETAIL_ROUTE_PATH}
          element={<ToolsView />}
        />
      </Routes>
    </div>
  );
}

async function resolveInstalledSkillDetailPath(): Promise<string> {
  const response = await api.listProjectSkills({
    projectId: PERSONAL_PROJECT_ID,
    environmentId: null,
  });
  const skill = response.skills[0];
  if (skill === undefined) {
    throw new Error("The live server has no installed skill to open.");
  }
  return getSkillDetailRoutePath({
    scope: skill.scope,
    providerId: skill.provider,
    skillName: skill.name,
  });
}

async function resolveRegistrySkillDetailPath(): Promise<string> {
  const response = await fetchRegistrySkills({ query: "", page: 0 });
  const skill = response.skills[0];
  if (skill === undefined) {
    throw new Error("The live registry has no skill to open.");
  }
  return getRegistrySkillDetailRoutePath({ registrySkillId: skill.id });
}

async function resolvePluginDetailPath(pluginId: string): Promise<string> {
  const response = await fetchPluginList(fetch);
  const plugin = response.plugins.find(
    (candidate) => candidate.id === pluginId,
  );
  if (plugin === undefined) {
    throw new Error(`The live server does not have ${pluginId} installed.`);
  }
  return getPluginDetailRoutePath({ pluginId: plugin.id });
}

function resolveAutomationsPluginDetailPath(): Promise<string> {
  return resolvePluginDetailPath("automations");
}

function resolveConnectPluginDetailPath(): Promise<string> {
  return resolvePluginDetailPath("connect");
}

function resolveCustomInstructionsPluginDetailPath(): Promise<string> {
  return resolvePluginDetailPath("custom-instructions");
}

function resolveInlineVisPluginDetailPath(): Promise<string> {
  return resolvePluginDetailPath("inline-vis");
}

function resolveSecretsPluginDetailPath(): Promise<string> {
  return resolvePluginDetailPath("secrets");
}

async function resolveAutomationRoute(): Promise<{
  projectId: string;
  automationId: string;
}> {
  const response = await fetch(
    "/api/v1/plugins/automations/rpc/automations_overview",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    },
  );
  if (!response.ok) {
    throw new Error("The live automation overview could not be loaded.");
  }
  const body: unknown = await response.json();
  if (typeof body !== "object" || body === null || !("result" in body)) {
    throw new Error("The live automation overview response is invalid.");
  }
  const result = automationsOverviewResponseSchema.safeParse(body.result);
  const automation = result.success
    ? result.data.automations[0]?.automation
    : undefined;
  if (automation === undefined) {
    throw new Error("The live server has no automation to open.");
  }
  return {
    projectId: automation.projectId,
    automationId: automation.id,
  };
}

async function resolveAutomationDetailPath(): Promise<string> {
  return getAutomationDetailRoutePath(await resolveAutomationRoute());
}

async function resolveAutomationEditPath(): Promise<string> {
  return getAutomationEditRoutePath(await resolveAutomationRoute());
}

export function SkillsInstalled() {
  return <LiveToolsPage target={getSkillsRoutePath()} />;
}

export function SkillsRegistry() {
  return <LiveToolsPage target={`${getSkillsRoutePath()}?view=browse`} />;
}

export function SkillDetail() {
  return <LiveToolsPage target={resolveInstalledSkillDetailPath} />;
}

export function RegistrySkillDetail() {
  return <LiveToolsPage target={resolveRegistrySkillDetailPath} />;
}

export function PluginsInstalled() {
  return <LiveToolsPage target={getPluginsRoutePath()} />;
}

export function PluginsBrowse() {
  return <LiveToolsPage target={`${getPluginsRoutePath()}?view=browse`} />;
}

export function PluginsMarketplaces() {
  return (
    <LiveToolsPage target={`${getPluginsRoutePath()}?view=marketplaces`} />
  );
}

export function PluginDetailAutomations() {
  return <LiveToolsPage target={resolveAutomationsPluginDetailPath} />;
}

export function PluginDetailRemoteAccess() {
  return <LiveToolsPage target={resolveConnectPluginDetailPath} />;
}

export function PluginDetailCustomInstructions() {
  return <LiveToolsPage target={resolveCustomInstructionsPluginDetailPath} />;
}

export function PluginDetailInlineVisualizations() {
  return <LiveToolsPage target={resolveInlineVisPluginDetailPath} />;
}

export function PluginDetailSecrets() {
  return <LiveToolsPage target={resolveSecretsPluginDetailPath} />;
}

export function AutomationsOverview() {
  return <LiveToolsPage target={AUTOMATIONS_ROUTE_PATH} />;
}

export function AutomationsBrowse() {
  return <LiveToolsPage target={`${AUTOMATIONS_ROUTE_PATH}?view=browse`} />;
}

export function AutomationDetail() {
  return <LiveToolsPage target={resolveAutomationDetailPath} />;
}

export function AutomationEdit() {
  return <LiveToolsPage target={resolveAutomationEditPath} />;
}

import type { ReactNode } from "react";
import { Navigate, useParams } from "react-router-dom";
import { useSystemConfig } from "@/hooks/queries/system-queries";
import { getPluginsRoutePath } from "@/lib/route-paths";

/**
 * Replaces the legacy plugin manager with Tools Hub while preserving each
 * plugin's Settings page.
 */
export function PluginSettingsCompatibilityRoute({
  children,
}: {
  children: ReactNode;
}) {
  const { pluginId } = useParams<{ pluginId?: string }>();
  const systemConfig = useSystemConfig();
  const toolsHubEnabled = systemConfig.data?.experiments.toolsHub;

  if (toolsHubEnabled === undefined) return null;
  if (!toolsHubEnabled) return children;
  if (pluginId !== undefined) return children;

  return <Navigate to={getPluginsRoutePath()} replace />;
}

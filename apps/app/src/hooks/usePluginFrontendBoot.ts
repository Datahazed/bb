import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { bootPluginFrontends } from "../lib/plugin-frontend-lazy";
import { setPluginContentScriptComposeNavigator } from "../lib/plugin-content-script-navigation";
import { getRootComposeRoutePath } from "../lib/route-paths";
import { useSystemConfig } from "./queries/system-queries";

/**
 * Load plugin frontend bundles (plugin design §5.1) once per page load,
 * after system config resolves — the loading never delays first paint.
 * The server inventory already filters to running, loadable plugins.
 * After boot, the realtime
 * `plugins-changed` broadcast keeps bundles live via
 * schedulePluginFrontendReconcile (no page refresh needed).
 */
export function usePluginFrontendBoot(): void {
  const navigate = useNavigate();
  const systemConfig = useSystemConfig();
  const resolved = systemConfig.data !== undefined;
  useEffect(
    () =>
      setPluginContentScriptComposeNavigator((options) => {
        void navigate(getRootComposeRoutePath(), {
          state: {
            focusPrompt: options.focusPrompt ?? false,
            initialPrompt: options.initialPrompt ?? "",
          },
        });
      }),
    [navigate],
  );
  useEffect(() => {
    if (resolved) void bootPluginFrontends();
  }, [resolved]);
}

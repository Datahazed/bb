import { loadDevAppConfig } from "./dev-app.js";
import { type EnvLoaderArgs } from "./env.js";
import { assignIfDefined } from "./objects.js";
import { loadServerPortConfig } from "./server-port.js";

export interface ViteDevConfig {
  appPort: number;
  serverHttpOrigin: string;
  serverPort: number;
  serverWsOrigin: string;
  appHost?: string;
}

export interface LoadViteDevConfigArgs extends EnvLoaderArgs {
  repoRoot?: string;
}

export function loadViteDevConfig(
  args: LoadViteDevConfigArgs = {},
): ViteDevConfig {
  const devAppConfig = loadDevAppConfig(args);
  const appPort = devAppConfig.BB_DEV_APP_PORT;
  if (appPort === undefined) {
    throw new Error("BB_DEV_APP_PORT is required to run the app dev server");
  }

  const serverPortConfig = loadServerPortConfig(args);
  const serverHttpOrigin = `http://localhost:${serverPortConfig.BB_SERVER_PORT}`;
  const config: ViteDevConfig = {
    appPort,
    serverHttpOrigin,
    serverPort: serverPortConfig.BB_SERVER_PORT,
    serverWsOrigin: `ws://localhost:${serverPortConfig.BB_SERVER_PORT}`,
  };

  assignIfDefined({
    key: "appHost",
    target: config,
    value:
      devAppConfig.BB_DEV_APP_HOST === ""
        ? undefined
        : devAppConfig.BB_DEV_APP_HOST,
  });

  return config;
}

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineConfig, type Plugin } from "vite";
import {
  cloudflare,
  type PluginConfig,
  type WorkerConfig,
} from "@cloudflare/vite-plugin";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { unstable_readConfig } from "wrangler";
import { resolveCloudDevViteSettings } from "./src/server/cloud-dev-vite.js";
import { resolveSiteOrigin } from "./src/server/site-origin.js";

function isolatePluginGuideIcons(): Plugin {
  const moduleName = "@hugeicons/core-free-icons";
  const suffix = "?bb-plugin-guide-icons";
  const guideSources = [
    "/packages/plugin-api-map/",
    "/packages/showcase-hero/",
    "/packages/shared-ui/",
  ];

  return {
    name: "isolate-plugin-guide-icons",
    enforce: "pre",
    async resolveId(source, importer, options) {
      if (
        source !== moduleName ||
        importer === undefined ||
        !guideSources.some((segment) => importer.includes(segment))
      ) {
        return null;
      }
      const resolved = await this.resolve(source, importer, {
        ...options,
        skipSelf: true,
      });
      return resolved === null ? null : `${resolved.id}${suffix}`;
    },
    load(id) {
      if (!id.endsWith(suffix)) return null;
      return readFileSync(id.slice(0, -suffix.length), "utf8");
    },
  };
}

export default defineConfig(({ command }) => {
  const cloudDev = resolveCloudDevViteSettings(command, process.env);
  const siteOrigin = resolveSiteOrigin(
    cloudDev?.vars.APP_URL ??
      unstable_readConfig({
        config: fileURLToPath(new URL("./wrangler.jsonc", import.meta.url)),
        env: process.env.CLOUDFLARE_ENV,
      }).vars.APP_URL,
  );
  const cloudflareConfig: PluginConfig = {
    viteEnvironment: { name: "ssr" },
    ...(cloudDev
      ? {
          persistState: { path: cloudDev.persistStatePath },
          config: (config: WorkerConfig) => ({
            vars: {
              ...config.vars,
              ...cloudDev.vars,
            },
          }),
        }
      : {}),
  };

  return {
    define: { __SITE_ORIGIN__: JSON.stringify(siteOrigin) },
    resolve: {
      alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
    },
    server: {
      allowedHosts: [".localhost", ".ts.net"],
    },
    plugins: [
      cloudflare(cloudflareConfig),
      tailwindcss(),
      isolatePluginGuideIcons(),
      tanstackStart({
        router: {
          routeTreeFileHeader: [
            "/* oxlint-disable */",
            "// @ts-nocheck",
            "// noinspection JSUnusedGlobalSymbols",
          ],
        },
      }),
      viteReact(),
    ],
  };
});

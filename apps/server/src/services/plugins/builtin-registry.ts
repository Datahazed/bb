import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { PluginCatalogCategoryId } from "@bb/server-contract";

export interface BundledPluginDefinition {
  name: string;
  pluginId: string;
  autoInstall: boolean;
  defaultEnabled: boolean;
  category: PluginCatalogCategoryId;
  screenshots?: readonly string[];
}

export interface BundledPluginRegistration extends BundledPluginDefinition {
  rootDir: string;
}

interface ResolveBuiltinPluginRootPathArgs {
  moduleDir: string;
  name: string;
}

export const BUILTIN_PLUGINS_DIRECTORY_NAME = "builtin-plugins";

const REPO_PLUGINS_DIRECTORY_NAME = "plugins";

const BUILTIN_PLUGIN_DEFINITIONS = [
  {
    name: "ask-user-question",
    pluginId: "ask-user-question",
    defaultEnabled: false,
    category: "thread-content",
  },
  {
    name: "automations",
    pluginId: "automations",
    defaultEnabled: true,
    category: "tasks-workflows",
    screenshots: [
      "screenshots/automations-catalog.png",
      "screenshots/automations-sidebar.png",
    ],
  },
  {
    name: "connect",
    pluginId: "connect",
    defaultEnabled: true,
    category: "remote-development",
  },
  {
    name: "custom-instructions",
    pluginId: "custom-instructions",
    defaultEnabled: true,
    category: "memory-and-context",
  },
  {
    name: "plugin-api-tester",
    pluginId: "plugin-api-tester",
    defaultEnabled: false,
    category: "plugin-development",
  },
  {
    name: "inline-vis",
    pluginId: "inline-vis",
    defaultEnabled: true,
    category: "thread-content",
  },
  {
    name: "monaco-editor",
    pluginId: "monaco-editor",
    defaultEnabled: false,
    category: "files-and-viewers",
  },
  {
    name: "pdf-preview",
    pluginId: "pdf-preview",
    defaultEnabled: true,
    category: "files-and-viewers",
  },
  {
    name: "provider-codex",
    pluginId: "provider-codex",
    defaultEnabled: true,
    category: "agents-and-providers",
  },
  {
    name: "provider-claude-code",
    pluginId: "provider-claude-code",
    defaultEnabled: true,
    category: "agents-and-providers",
  },
  {
    name: "provider-pi",
    pluginId: "provider-pi",
    defaultEnabled: true,
    category: "agents-and-providers",
  },
  {
    name: "provider-acp",
    pluginId: "provider-acp",
    defaultEnabled: true,
    category: "agents-and-providers",
  },
  {
    name: "keep-awake",
    pluginId: "keep-awake",
    defaultEnabled: true,
    category: "system-management",
  },
  {
    name: "plugin-api-docs",
    pluginId: "plugin-api-docs",
    defaultEnabled: false,
    category: "plugin-development",
    screenshots: [
      "screenshots/plugin-guide-map.png",
      "screenshots/plugin-guide-surfaces.png",
      "screenshots/plugin-guide-reference.png",
    ],
  },
  {
    name: "provider-retry",
    pluginId: "provider-retry",
    defaultEnabled: true,
    category: "agents-and-providers",
  },
  {
    name: "secrets",
    pluginId: "secrets",
    defaultEnabled: true,
    category: "security",
  },
  {
    name: "side-chat",
    pluginId: "side-chat",
    defaultEnabled: true,
    category: "thread-content",
  },
  {
    name: "workflows",
    pluginId: "workflows",
    defaultEnabled: false,
    category: "tasks-workflows",
  },
] satisfies Omit<BundledPluginDefinition, "autoInstall">[];

export const BUILTIN_PLUGINS = BUILTIN_PLUGIN_DEFINITIONS.map(
  (plugin): BundledPluginDefinition => ({
    ...plugin,
    autoInstall: true,
  }),
);

const OFFICIAL_PLUGIN_DEFINITIONS = [
  {
    name: "github",
    pluginId: "github",
    defaultEnabled: true,
    category: "code-and-reviews",
  },
  {
    name: "docs",
    pluginId: "simple-notes",
    defaultEnabled: true,
    category: "files-and-viewers",
  },
  {
    name: "memory",
    pluginId: "memory",
    defaultEnabled: true,
    category: "memory-and-context",
  },
  {
    name: "tasks",
    pluginId: "tasks",
    defaultEnabled: true,
    category: "tasks-workflows",
  },
] satisfies Omit<BundledPluginDefinition, "autoInstall">[];

export const OFFICIAL_PLUGINS = OFFICIAL_PLUGIN_DEFINITIONS.map(
  (plugin): BundledPluginDefinition => ({
    ...plugin,
    autoInstall: false,
  }),
);

export const BUNDLED_PLUGINS: readonly BundledPluginDefinition[] = [
  ...BUILTIN_PLUGINS,
  ...OFFICIAL_PLUGINS,
];

export const BUILTIN_PLUGIN_NAMES = BUILTIN_PLUGINS.map(
  (plugin) => plugin.name,
);

const builtinPluginsModuleDir = path.dirname(fileURLToPath(import.meta.url));

export function builtinPluginSource(name: string): string {
  return `builtin:${name}`;
}

export function resolveBuiltinPluginRootPathForModuleDir(
  args: ResolveBuiltinPluginRootPathArgs,
): string {
  const packagedCandidate = path.resolve(
    args.moduleDir,
    BUILTIN_PLUGINS_DIRECTORY_NAME,
    args.name,
  );
  if (existsSync(packagedCandidate)) return packagedCandidate;

  const builtCheckoutCandidate = path.resolve(
    args.moduleDir,
    "../../..",
    REPO_PLUGINS_DIRECTORY_NAME,
    args.name,
  );
  if (existsSync(builtCheckoutCandidate)) return builtCheckoutCandidate;

  return path.resolve(
    args.moduleDir,
    "../../../../..",
    REPO_PLUGINS_DIRECTORY_NAME,
    args.name,
  );
}

export function resolveBuiltinPluginRootPath(name: string): string {
  return resolveBuiltinPluginRootPathForModuleDir({
    moduleDir: builtinPluginsModuleDir,
    name,
  });
}

export function listBundledPluginRegistrations(): BundledPluginRegistration[] {
  return BUNDLED_PLUGINS.map((plugin) => ({
    ...plugin,
    rootDir: resolveBuiltinPluginRootPath(plugin.name),
  }));
}

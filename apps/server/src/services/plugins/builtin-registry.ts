import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { PluginCatalogCategoryId } from "@bb/server-contract";

export interface BundledPluginDefinition {
  /**
   * Directory name under `plugins/` and under the packaged builtin-plugins
   * dir; also the `builtin:<name>` source name.
   */
  name: string;
  /** derivePluginId(packageName); declared statically so ids are reservable without manifest reads. */
  pluginId: string;
  /** true = reconcile installs when missing; false = store-only, installed on demand. */
  autoInstall: boolean;
  /** enabled value on first install (auto or store). */
  defaultEnabled: boolean;
  /** Stable Browse category identity. */
  category: PluginCatalogCategoryId;
  /** Detail-page screenshots, repo-relative to the plugin's own directory. */
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

/** Every bundled plugin's source lives under `<repoRoot>/plugins/<name>`. */
const REPO_PLUGINS_DIRECTORY_NAME = "plugins";

const BUILTIN_PLUGIN_DEFINITIONS = [
  {
    name: "ask-user-question",
    pluginId: "ask-user-question",
    defaultEnabled: false,
    category: "composer-and-prompts",
  },
  {
    name: "automations",
    pluginId: "automations",
    defaultEnabled: true,
    category: "automation",
    screenshots: [
      "screenshots/automations-catalog.png",
      "screenshots/automations-sidebar.png",
    ],
  },
  {
    name: "connect",
    pluginId: "connect",
    defaultEnabled: true,
    category: "machines-and-hosts",
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
    category: "thread-messages-and-timelines",
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
  // First-party agent provider plugins: each declares one of the providers
  // the core catalog used to seed. With the seed deleted these declarations
  // are the only source, so disabling one removes its provider. Their order
  // here IS the install order — the provider picker's default order and the
  // initial default provider come from it (bundled plugins rank first, in
  // this order; every other plugin ranks by install time).
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
    category: "machines-and-hosts",
  },
  {
    name: "plugin-api-docs",
    pluginId: "plugin-api-docs",
    defaultEnabled: true,
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
    category: "thread-messages-and-timelines",
  },
  {
    name: "workflows",
    pluginId: "workflows",
    defaultEnabled: false,
    category: "automation",
  },
] satisfies Omit<BundledPluginDefinition, "autoInstall">[];

export const BUILTIN_PLUGINS = BUILTIN_PLUGIN_DEFINITIONS.map(
  (plugin): BundledPluginDefinition => ({
    ...plugin,
    autoInstall: true,
  }),
);

/**
 * Official plugins ship bundled with the app like builtins, but are not
 * auto-installed: they appear in the plugin store and install on demand.
 */
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
    category: "memory-and-context",
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
    category: "task-tracking",
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

/**
 * Bundled plugin roots live in three layouts:
 * - packaged server: <server dist>/builtin-plugins/<name> (written at packaging)
 * - built-from-source server (bundle at apps/server/dist): <repoRoot>/plugins/<name>
 * - source checkout (module at apps/server/src/services/plugins): <repoRoot>/plugins/<name>
 */
export function resolveBuiltinPluginRootPathForModuleDir(
  args: ResolveBuiltinPluginRootPathArgs,
): string {
  const packagedCandidate = path.resolve(
    args.moduleDir,
    BUILTIN_PLUGINS_DIRECTORY_NAME,
    args.name,
  );
  if (existsSync(packagedCandidate)) return packagedCandidate;

  // apps/server/dist → repo root is three levels up.
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

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
  publishedAt?: string;
  updatedAt?: string;
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

const BUNDLED_PLUGIN_DISCOVERY_DATES = {
  "ask-user-question": {
    publishedAt: "2026-07-22T13:42:32-07:00",
    updatedAt: "2026-08-27T20:57:03-07:00",
  },
  automations: {
    publishedAt: "2026-07-06T13:50:43-07:00",
    updatedAt: "2026-08-31T04:28:52-07:00",
  },
  connect: {
    publishedAt: "2026-07-07T12:30:54-07:00",
    updatedAt: "2026-08-27T20:57:03-07:00",
  },
  "custom-instructions": {
    publishedAt: "2026-07-10T14:49:01-07:00",
    updatedAt: "2026-08-20T21:43:39-07:00",
  },
  "plugin-api-tester": {
    publishedAt: "2026-08-21T15:13:36-07:00",
    updatedAt: "2026-08-27T20:57:03-07:00",
  },
  "inline-vis": {
    publishedAt: "2026-07-09T21:26:26-07:00",
    updatedAt: "2026-08-27T20:57:03-07:00",
  },
  "monaco-editor": {
    publishedAt: "2026-08-25T16:06:44-07:00",
    updatedAt: "2026-08-27T20:57:03-07:00",
  },
  "pdf-preview": {
    publishedAt: "2026-08-20T14:35:24-07:00",
    updatedAt: "2026-08-27T20:57:03-07:00",
  },
  "provider-codex": {
    publishedAt: "2026-08-17T14:42:42-07:00",
    updatedAt: "2026-08-27T20:57:03-07:00",
  },
  "provider-claude-code": {
    publishedAt: "2026-08-17T14:42:42-07:00",
    updatedAt: "2026-08-29T01:18:06-07:00",
  },
  "provider-pi": {
    publishedAt: "2026-08-17T14:42:42-07:00",
    updatedAt: "2026-08-28T10:18:34-07:00",
  },
  "provider-acp": {
    publishedAt: "2026-08-17T14:42:42-07:00",
    updatedAt: "2026-08-27T20:57:03-07:00",
  },
  "keep-awake": {
    publishedAt: "2026-08-17T11:44:21-07:00",
    updatedAt: "2026-08-27T20:57:03-07:00",
  },
  "plugin-api-docs": {
    publishedAt: "2026-08-26T01:43:25-07:00",
    updatedAt: "2026-08-29T01:22:00-07:00",
  },
  "provider-retry": {
    publishedAt: "2026-08-07T13:44:46-07:00",
    updatedAt: "2026-08-27T20:57:03-07:00",
  },
  secrets: {
    publishedAt: "2026-07-09T15:43:16-07:00",
    updatedAt: "2026-08-28T07:17:59-07:00",
  },
  "side-chat": {
    publishedAt: "2026-07-20T18:53:13-07:00",
    updatedAt: "2026-08-27T20:57:03-07:00",
  },
  workflows: {
    publishedAt: "2026-07-15T21:22:51-07:00",
    updatedAt: "2026-08-28T09:55:39-07:00",
  },
  github: {
    publishedAt: "2026-08-06T08:12:57-07:00",
    updatedAt: "2026-08-31T04:12:23-07:00",
  },
  docs: {
    publishedAt: "2026-08-06T08:12:57-07:00",
    updatedAt: "2026-08-31T04:12:23-07:00",
  },
  memory: {
    publishedAt: "2026-07-10T16:07:05-07:00",
    updatedAt: "2026-08-31T04:12:23-07:00",
  },
  tasks: {
    publishedAt: "2026-08-06T08:12:57-07:00",
    updatedAt: "2026-08-31T04:12:23-07:00",
  },
} as const;

type BundledPluginName = keyof typeof BUNDLED_PLUGIN_DISCOVERY_DATES;

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
] satisfies (Omit<
  BundledPluginDefinition,
  "autoInstall" | "publishedAt" | "updatedAt"
> & { name: BundledPluginName })[];

export const BUILTIN_PLUGINS = BUILTIN_PLUGIN_DEFINITIONS.map(
  (plugin): BundledPluginDefinition => ({
    ...plugin,
    ...BUNDLED_PLUGIN_DISCOVERY_DATES[plugin.name],
    autoInstall: true,
  }),
);

const OFFICIAL_PLUGIN_DEFINITIONS = [
  {
    name: "github",
    pluginId: "github",
    defaultEnabled: true,
    category: "code-and-reviews",
    screenshots: [
      "screenshots/github-issues.png",
      "screenshots/github-pull-requests.png",
    ],
  },
  {
    name: "docs",
    pluginId: "simple-notes",
    defaultEnabled: true,
    category: "files-and-viewers",
    screenshots: [
      "screenshots/docs-note.png",
      "screenshots/docs-product-brief.png",
    ],
  },
  {
    name: "memory",
    pluginId: "memory",
    defaultEnabled: true,
    category: "memory-and-context",
    screenshots: [
      "screenshots/memory-catalog.png",
      "screenshots/memory-edit.png",
    ],
  },
  {
    name: "tasks",
    pluginId: "tasks",
    defaultEnabled: true,
    category: "tasks-workflows",
    screenshots: [
      "screenshots/tasks-list.png",
      "screenshots/tasks-detail.png",
    ],
  },
] satisfies (Omit<
  BundledPluginDefinition,
  "autoInstall" | "publishedAt" | "updatedAt"
> & { name: BundledPluginName })[];

export const OFFICIAL_PLUGINS = OFFICIAL_PLUGIN_DEFINITIONS.map(
  (plugin): BundledPluginDefinition => ({
    ...plugin,
    ...BUNDLED_PLUGIN_DISCOVERY_DATES[plugin.name],
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

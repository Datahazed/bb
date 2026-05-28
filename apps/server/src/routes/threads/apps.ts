import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import mimeTypes from "mime-types";
import type { Hono } from "hono";
import {
  FILE_LIST_LIMIT_MAX,
  type HostDaemonCommand,
  type HostDaemonCommandResult,
} from "@bb/host-daemon-contract";
import {
  appDataPathSchema,
  appIdSchema,
  escapeHtmlText,
  jsonValueSchema,
} from "@bb/domain";
import type { AppDataPath, AppId, JsonValue } from "@bb/domain";
import {
  appDataListQuerySchema,
  appDataWriteRequestSchema,
  appManifestSchema,
  appMessageRequestSchema,
  createThreadAppRequestSchema,
  typedRoutes,
  type AppCapability,
  type AppDataEntry,
  type AppDetail,
  type AppEntry,
  type AppIcon,
  type AppManifest,
  type AppSummary,
  type AppTemplate,
  type CreateThreadAppRequest,
  type PublicApiSchema,
} from "@bb/server-contract";
import type { AppDeps, LoggedWorkSessionDeps } from "../../types.js";
import { COMMAND_TIMEOUT_MS } from "../../constants.js";
import { ApiError } from "../../errors.js";
import { queueCommandAndWait } from "../../services/hosts/command-wait.js";
import {
  createDaemonFileContentResponse,
  decodeDaemonFileContent,
  type DaemonFileReadResult,
  remapDaemonFileRouteError,
} from "../../services/hosts/daemon-file-response.js";
import { requirePublicThread } from "../../services/lib/entity-lookup.js";
import { requireThreadCommandEnvironment } from "../../services/threads/thread-command-environment.js";
import { sendThreadMessage } from "../../services/threads/thread-send.js";
import { injectAppClientScript } from "../../services/threads/app-client-script.js";
import {
  extractRoutePath,
  parseSafeRelativeRoutePath,
  type SafeRelativeRoutePath,
} from "../relative-route-path.js";
import { requireThreadStorageTarget } from "./data.js";

interface ThreadAppsTarget {
  hostId: string;
  storagePath: string;
}

interface AppManifestReadArgs {
  appId: AppId;
  target: ThreadAppsTarget;
}

interface AppSummaryArgs extends AppManifestReadArgs {
  manifest: AppManifest;
  requestThreadId: string;
}

interface AppDetailArgs extends AppManifestReadArgs {
  requestThreadId: string;
}

interface AppRootArgs {
  appId: AppId;
  target: ThreadAppsTarget;
}

interface AppDataRootArgs extends AppRootArgs {}

interface ReadAppRelativeFileArgs {
  appId: AppId;
  dotfiles: "allow" | "deny";
  path: string;
  rootKind: "app" | "assets" | "data";
  target: ThreadAppsTarget;
}

interface ReadAppFileMetadataArgs {
  appId: AppId;
  path: string;
  rootKind: "app" | "assets" | "data";
  target: ThreadAppsTarget;
}

interface AppRootForKindArgs {
  appId: AppId;
  rootKind: "app" | "assets" | "data";
  target: ThreadAppsTarget;
}

interface ReadAppDataEntryArgs {
  appId: AppId;
  dataPath: AppDataPath;
  target: ThreadAppsTarget;
}

interface ListAppDataEntriesArgs {
  appId: AppId;
  dataPath: AppDataPath | "";
  target: ThreadAppsTarget;
}

interface WriteAppDataEntryArgs extends ReadAppDataEntryArgs {
  value: JsonValue;
}

interface DeleteAppDataEntryArgs extends ReadAppDataEntryArgs {}

interface CreateInjectedAppHtmlResponseArgs {
  appId: AppId;
  capabilities: AppCapability[];
  html: string;
  requestUrl: string;
  threadId: string;
}

interface AppAssetRouteSegmentArgs {
  appId: string;
  threadId: string;
}

type AppAssetPath = SafeRelativeRoutePath;

interface LogoResolution {
  extension: string;
}

interface TemplateFile {
  content: string;
  path: string;
}

interface ScaffoldAppArgs {
  request: CreateThreadAppRequest;
  target: ThreadAppsTarget;
  threadId: string;
}

type HostCommandType =
  | "host.file_metadata"
  | "host.list_paths"
  | "host.read_file_relative"
  | "host.write_file_relative"
  | "host.delete_file_relative"
  | "host.delete_path_relative";

interface QueueHostCommandArgs<TType extends HostCommandType> {
  command: Extract<HostDaemonCommand, { type: TType }>;
  hostId: string;
}

const APPS_DIRECTORY_NAME = "apps";
const ASSETS_DIRECTORY_NAME = "assets";
const DATA_DIRECTORY_NAME = "data";
const MANIFEST_FILE_NAME = "manifest.json";
const HTML_CONTENT_TYPE = "text/html; charset=utf-8";
const NO_STORE_CACHE_CONTROL = "no-store";
const CONTENT_TYPE_OPTIONS = "nosniff";
const HTML_ENTRY_MAX_BYTES = 5 * 1024 * 1024;
const LOGO_MAX_BYTES = 1024 * 1024;
const LOGO_EXTENSIONS = ["svg", "png", "jpg", "jpeg"] as const;
const APP_ROUTE_DATA_SEGMENT = "/data/";

const BLANK_APP_NAME_PLACEHOLDER = "__BB_APP_NAME__";

// First <style> block: the bb default styling head copied verbatim from
// `bb guide styling` (packages/templates/src/templates/bb-guide-app.md). Keep
// this in sync with that guide so the scaffold and the documented tokens never
// drift.
const BB_DEFAULT_STYLING_HEAD = `<script src="https://cdn.tailwindcss.com"></script>
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Fira+Code:wght@400;500&display=swap" rel="stylesheet">
    <style>
    :root {
      color-scheme: light;
      --background: oklch(0.9551 0 0);
      --foreground: oklch(0.3211 0 0);
      --card: oklch(0.9702 0 0);
      --muted: oklch(0.8853 0 0);
      --muted-foreground: oklch(0.5103 0 0);
      --border: oklch(0.8576 0 0);
      --accent: oklch(0.9 0 0);
      --success: oklch(0.7 0.15 155);
      --warning: oklch(0.7 0.16 50);
      --destructive: oklch(0.5594 0.19 25.8625);
      --radius: 0.5rem;
      --font-sans: "Inter", ui-sans-serif, system-ui, sans-serif;
      --font-mono: "Fira Code", ui-monospace, SFMono-Regular, monospace;
    }
    @media (prefers-color-scheme: dark) {
      :root {
        color-scheme: dark;
        --background: oklch(0.2178 0 0);
        --foreground: oklch(0.8853 0 0);
        --card: oklch(0.2435 0 0);
        --muted: oklch(0.31 0 0);
        --muted-foreground: oklch(0.7058 0 0);
        --border: oklch(0.34 0 0);
        --accent: oklch(0.32 0 0);
      }
    }
    body {
      margin: 0;
      background: var(--background);
      color: var(--foreground);
      font-family: var(--font-sans);
      font-size: 13px;
    }
    .panel {
      border: 1px solid var(--border);
      border-radius: var(--radius);
      background: var(--card);
    }
    </style>`;

// Second <style> block: scaffold-only classes layered on top of the guide
// tokens. Keep this strictly additive; do not redefine variables or guide
// classes here.
const BLANK_APP_SCAFFOLD_EXTRA_STYLES = `<style>
      * { box-sizing: border-box; }
      body {
        padding: 16px 16px 20px;
        line-height: 1.45;
        -webkit-font-smoothing: antialiased;
      }
      .panel { padding: 14px 16px; }
      .header {
        display: flex;
        align-items: center;
        gap: 8px;
        padding-bottom: 10px;
        border-bottom: 1px solid var(--border);
        margin-bottom: 16px;
      }
      .brand {
        width: 20px;
        height: 20px;
        border: 1px solid var(--border);
        background: var(--card);
        border-radius: calc(var(--radius) - 4px);
        display: inline-flex;
        align-items: center;
        justify-content: center;
        font-family: var(--font-mono);
        font-weight: 500;
        font-size: 10px;
      }
      .title {
        font-size: 13px;
        font-weight: 600;
        flex: 1;
        min-width: 0;
        letter-spacing: -0.005em;
      }
      .ts {
        font-family: var(--font-mono);
        font-size: 10px;
        color: var(--muted-foreground);
      }
      .placeholder {
        margin: 0 0 14px;
        color: var(--muted-foreground);
        font-size: 13px;
      }
      .section { margin-top: 14px; }
      .sect-ttl {
        font-size: 10.5px;
        font-weight: 600;
        letter-spacing: 0.06em;
        text-transform: uppercase;
        color: var(--muted-foreground);
        margin-bottom: 8px;
      }
      .row {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 9px 12px;
        background: var(--card);
        border: 1px solid var(--border);
        border-radius: var(--radius);
      }
      .row + .row { margin-top: 6px; }
      .label {
        font-family: var(--font-mono);
        font-size: 10.5px;
        color: var(--muted-foreground);
        white-space: nowrap;
      }
      .name {
        flex: 1;
        min-width: 0;
        font-size: 13px;
        font-weight: 500;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .pill {
        display: inline-flex;
        align-items: center;
        font-family: var(--font-mono);
        font-size: 9.5px;
        font-weight: 500;
        line-height: 1;
        padding: 3px 7px;
        border-radius: 999px;
        border: 1px solid var(--border);
        background: var(--background);
        color: var(--muted-foreground);
        text-transform: uppercase;
        letter-spacing: 0.05em;
        white-space: nowrap;
        flex-shrink: 0;
      }
    </style>`;

// Blank-template scaffold rendered into apps/<id>/assets/index.html. Composes
// the documented bb default styling head with a scaffold-only style block and
// the task-list visual vocabulary borrowed from the bundled status app, so new
// apps start out looking bb-native rather than like bare HTML.
const BLANK_APP_INDEX_HTML_TEMPLATE = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${BLANK_APP_NAME_PLACEHOLDER}</title>
    ${BB_DEFAULT_STYLING_HEAD}
    ${BLANK_APP_SCAFFOLD_EXTRA_STYLES}
  </head>
  <body>
    <header class="header">
      <span class="brand">bb</span>
      <span class="title">${BLANK_APP_NAME_PLACEHOLDER}</span>
      <span class="ts" id="bb-app-id">&mdash;</span>
    </header>

    <main class="panel">
      <p class="placeholder">
        Ask your agent to customize the status app how you please.
      </p>

      <section class="section">
        <div class="sect-ttl">Example tasks</div>
        <div class="row">
          <span class="label">implementing</span>
          <span class="name">Sample task title</span>
          <span class="pill">in progress</span>
        </div>
        <div class="row">
          <span class="label">blocked</span>
          <span class="name">Another sample row</span>
          <span class="pill">blocked</span>
        </div>
      </section>
    </main>

    <script>
      if (window.bb && window.bb.appId) {
        document.getElementById("bb-app-id").textContent = window.bb.appId;
      }
    </script>
  </body>
</html>
`;

function sha256(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function canonicalizeJson(value: JsonValue): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function parseAppId(rawAppId: string): AppId {
  const parsed = appIdSchema.safeParse(rawAppId);
  if (!parsed.success) {
    throw new ApiError(400, "invalid_request", "Invalid app id");
  }
  return parsed.data;
}

function parseAppDataPath(rawPath: string): AppDataPath {
  const parsed = appDataPathSchema.safeParse(rawPath);
  if (!parsed.success) {
    throw new ApiError(400, "invalid_request", "Invalid app data path");
  }
  return parsed.data;
}

function parseAppDataRoutePath(rawPath: string): AppDataPath {
  return parseAppDataPath(
    parseSafeRelativeRoutePath({
      rawPath,
      dotfileSegmentPolicy: "allow",
      invalidPathMessage: "Invalid app data path",
    }).relativePath,
  );
}

function appAssetRouteSegment(args: AppAssetRouteSegmentArgs): string {
  return `/threads/${encodeURIComponent(args.threadId)}/apps/${encodeURIComponent(args.appId)}/`;
}

function parseOptionalAppDataPrefix(
  rawPrefix: string | undefined,
): AppDataPath | "" {
  if (rawPrefix === undefined || rawPrefix === "") {
    return "";
  }
  return parseAppDataPath(rawPrefix);
}

function appRootPath(args: AppRootArgs): string {
  return path.join(args.target.storagePath, APPS_DIRECTORY_NAME, args.appId);
}

function appAssetsRootPath(args: AppRootArgs): string {
  return path.join(appRootPath(args), ASSETS_DIRECTORY_NAME);
}

function appDataRootPath(args: AppDataRootArgs): string {
  return path.join(appRootPath(args), DATA_DIRECTORY_NAME);
}

function appRootForKind(args: AppRootForKindArgs): string {
  if (args.rootKind === "app") {
    return appRootPath(args);
  }
  if (args.rootKind === "assets") {
    return appAssetsRootPath(args);
  }
  return appDataRootPath(args);
}

function parseAppAssetPath(rawPath: string): AppAssetPath {
  return parseSafeRelativeRoutePath({
    rawPath,
    directoryIndexPath: "index.html",
    dotfileSegmentPolicy: "not-found",
    invalidPathMessage: "Invalid app asset path",
  });
}

function decodeDaemonTextFile(result: DaemonFileReadResult): string {
  return Buffer.from(decodeDaemonFileContent(result)).toString("utf8");
}

function remapAppCommandError(error: unknown): never {
  if (!(error instanceof ApiError)) {
    throw error;
  }
  if (error.body.code === "ENOENT") {
    throw new ApiError(
      404,
      error.body.code,
      error.body.message,
      error.body.retryable,
    );
  }
  if (error.body.code === "invalid_path") {
    throw new ApiError(
      400,
      error.body.code,
      error.body.message,
      error.body.retryable,
    );
  }
  if (error.body.code === "invalid_json") {
    throw new ApiError(
      422,
      error.body.code,
      error.body.message,
      error.body.retryable,
    );
  }
  throw error;
}

async function queueHostCommand<TType extends HostCommandType>(
  deps: AppDeps,
  args: QueueHostCommandArgs<TType>,
): Promise<HostDaemonCommandResult<TType>> {
  try {
    return await queueCommandAndWait(deps, {
      hostId: args.hostId,
      timeoutMs: COMMAND_TIMEOUT_MS,
      command: args.command,
    });
  } catch (error) {
    remapAppCommandError(error);
  }
}

async function requireThreadAppsTarget(
  deps: LoggedWorkSessionDeps,
  threadId: string,
): Promise<ThreadAppsTarget> {
  const target = await requireThreadStorageTarget(deps, { threadId });
  return {
    hostId: target.hostId,
    storagePath: target.storagePath,
  };
}

async function readAppRelativeFile(
  deps: AppDeps,
  args: ReadAppRelativeFileArgs,
): Promise<DaemonFileReadResult> {
  return queueHostCommand(deps, {
    hostId: args.target.hostId,
    command: {
      type: "host.read_file_relative",
      rootPath: appRootForKind(args),
      path: args.path,
      dotfiles: args.dotfiles,
    },
  });
}

async function readAppFileMetadata(
  deps: AppDeps,
  args: ReadAppFileMetadataArgs,
): Promise<HostDaemonCommandResult<"host.file_metadata">> {
  return queueHostCommand(deps, {
    hostId: args.target.hostId,
    command: {
      type: "host.file_metadata",
      path: path.join(appRootForKind(args), args.path),
      rootPath: appRootForKind(args),
    },
  });
}

async function readAppManifest(
  deps: AppDeps,
  args: AppManifestReadArgs,
): Promise<AppManifest> {
  const result = await readAppRelativeFile(deps, {
    appId: args.appId,
    target: args.target,
    rootKind: "app",
    path: MANIFEST_FILE_NAME,
    dotfiles: "deny",
  });
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(decodeDaemonTextFile(result));
  } catch {
    throw new ApiError(422, "invalid_json", "App manifest is not valid JSON");
  }
  const manifest = appManifestSchema.safeParse(parsedJson);
  if (!manifest.success) {
    throw new ApiError(422, "invalid_request", "Invalid app manifest");
  }
  if (manifest.data.id !== args.appId) {
    throw new ApiError(
      422,
      "invalid_request",
      "App manifest id must match its directory name",
    );
  }
  return manifest.data;
}

function entryKindForPath(entryPath: string): AppEntry["kind"] {
  const normalized = entryPath.toLowerCase();
  if (normalized.endsWith(".html")) {
    return "html";
  }
  if (normalized.endsWith(".md")) {
    return "md";
  }
  throw new ApiError(
    422,
    "invalid_request",
    "App entry must end in .html or .md",
  );
}

async function resolveAppEntry(
  deps: AppDeps,
  args: AppManifestReadArgs & { manifest: AppManifest },
): Promise<AppEntry> {
  if (args.manifest.entry !== undefined) {
    return {
      path: args.manifest.entry,
      kind: entryKindForPath(args.manifest.entry),
    };
  }

  for (const candidate of ["index.html", "index.md"]) {
    try {
      await readAppFileMetadata(deps, {
        appId: args.appId,
        target: args.target,
        path: candidate,
        rootKind: "assets",
      });
      return {
        path: candidate,
        kind: entryKindForPath(candidate),
      };
    } catch (error) {
      if (error instanceof ApiError && error.body.code === "ENOENT") {
        continue;
      }
      throw error;
    }
  }

  throw new ApiError(
    404,
    "ENOENT",
    "App entry not found: index.html or index.md",
  );
}

async function tryResolveLogo(
  deps: AppDeps,
  args: AppManifestReadArgs,
): Promise<LogoResolution | null> {
  let listResult: HostDaemonCommandResult<"host.list_paths">;
  try {
    listResult = await queueHostCommand(deps, {
      hostId: args.target.hostId,
      command: {
        type: "host.list_paths",
        path: appRootPath(args),
        limit: LOGO_EXTENSIONS.length,
        includeFiles: true,
        includeDirectories: false,
      },
    });
  } catch (error) {
    if (error instanceof ApiError && error.body.code === "ENOENT") {
      return null;
    }
    throw error;
  }

  const topLevelFiles = new Set(
    listResult.paths
      .filter((entry) => entry.kind === "file" && !entry.path.includes("/"))
      .map((entry) => entry.path),
  );
  for (const extension of LOGO_EXTENSIONS) {
    if (topLevelFiles.has(`logo.${extension}`)) {
      return { extension };
    }
  }
  return null;
}

async function resolveAppIcon(
  deps: AppDeps,
  args: AppSummaryArgs,
): Promise<AppIcon> {
  if (args.manifest.icon !== undefined) {
    return { kind: "builtin", name: args.manifest.icon };
  }
  const logo = await tryResolveLogo(deps, args);
  if (logo) {
    return {
      kind: "logo",
      url: `/api/v1/threads/${encodeURIComponent(
        args.requestThreadId,
      )}/apps/${encodeURIComponent(args.appId)}/icon`,
    };
  }
  return { kind: "builtin", name: "GridView" };
}

async function buildAppSummary(
  deps: AppDeps,
  args: AppSummaryArgs,
): Promise<AppSummary> {
  const [entry, icon] = await Promise.all([
    resolveAppEntry(deps, args),
    resolveAppIcon(deps, args),
  ]);
  return {
    id: args.manifest.id,
    name: args.manifest.name,
    entry,
    capabilities: args.manifest.capabilities,
    icon,
  };
}

async function buildAppDetail(
  deps: AppDeps,
  args: AppDetailArgs,
): Promise<AppDetail> {
  let manifest: AppManifest;
  try {
    manifest = await readAppManifest(deps, args);
  } catch (error) {
    if (
      error instanceof ApiError &&
      error.status === 404 &&
      error.body.code === "ENOENT" &&
      error.body.message.includes(MANIFEST_FILE_NAME)
    ) {
      throw new ApiError(
        404,
        "app_not_provisioned",
        `App "${args.appId}" is not provisioned yet; missing ${MANIFEST_FILE_NAME}. Restart bb from a current build if this manager was created before app seeding was available.`,
      );
    }
    throw error;
  }
  return buildAppSummary(deps, {
    ...args,
    manifest,
  });
}

function assertAppCapability(
  manifest: AppManifest,
  capability: AppCapability,
): void {
  if (!manifest.capabilities.includes(capability)) {
    throw new ApiError(
      403,
      "invalid_request",
      `App does not have the ${capability} capability`,
    );
  }
}

async function listThreadApps(
  deps: AppDeps,
  threadId: string,
): Promise<AppSummary[]> {
  const target = await requireThreadAppsTarget(deps, threadId);
  let listResult: HostDaemonCommandResult<"host.list_paths">;
  try {
    listResult = await queueHostCommand(deps, {
      hostId: target.hostId,
      command: {
        type: "host.list_paths",
        path: path.join(target.storagePath, APPS_DIRECTORY_NAME),
        limit: FILE_LIST_LIMIT_MAX,
        includeFiles: false,
        includeDirectories: true,
      },
    });
  } catch (error) {
    if (error instanceof ApiError && error.body.code === "ENOENT") {
      return [];
    }
    throw error;
  }

  const appIds = listResult.paths
    .filter((entry) => entry.kind === "directory" && !entry.path.includes("/"))
    .map((entry) => appIdSchema.safeParse(entry.path))
    .filter((entry) => entry.success)
    .map((entry) => entry.data)
    .sort((left, right) => left.localeCompare(right));

  return Promise.all(
    appIds.map(async (appId) => {
      const manifest = await readAppManifest(deps, { appId, target });
      return buildAppSummary(deps, {
        appId,
        target,
        manifest,
        requestThreadId: threadId,
      });
    }),
  );
}

function createHtmlResponse(html: string): Response {
  return new Response(html, {
    status: 200,
    headers: {
      "cache-control": NO_STORE_CACHE_CONTROL,
      "content-type": HTML_CONTENT_TYPE,
      "x-content-type-options": CONTENT_TYPE_OPTIONS,
    },
  });
}

function buildAppWebSocketUrl(
  deps: LoggedWorkSessionDeps,
  requestUrl: string,
): string {
  if (deps.config.isDevelopment) {
    return `ws://localhost:${deps.config.serverPort}/ws`;
  }
  const url = new URL(requestUrl);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.pathname = "/ws";
  url.search = "";
  url.hash = "";
  return url.toString();
}

function createInjectedAppHtmlResponse(
  deps: LoggedWorkSessionDeps,
  args: CreateInjectedAppHtmlResponseArgs,
): Response {
  // Phase 1 app capabilities are advisory because app HTML is still served from
  // bb's same origin. We gate the injected bridge and app-owned routes by the
  // manifest-declared list, but real isolation waits for the third-party
  // extensions phase: sandboxed/opaque-origin iframes with a postMessage bridge.
  return createHtmlResponse(
    injectAppClientScript(args.html, {
      appId: args.appId,
      capabilities: args.capabilities,
      threadId: args.threadId,
      dataUrl: `/api/v1/threads/${encodeURIComponent(
        args.threadId,
      )}/apps/${encodeURIComponent(args.appId)}/data`,
      messageUrl: `/api/v1/threads/${encodeURIComponent(
        args.threadId,
      )}/apps/${encodeURIComponent(args.appId)}/message`,
      wsUrl: buildAppWebSocketUrl(deps, args.requestUrl),
    }),
  );
}

async function serveAppEntry(
  deps: AppDeps,
  threadId: string,
  rawAppId: string,
  requestUrl: string,
): Promise<Response> {
  const appId = parseAppId(rawAppId);
  const target = await requireThreadAppsTarget(deps, threadId);
  const manifest = await readAppManifest(deps, { appId, target });
  const entry = await resolveAppEntry(deps, { appId, target, manifest });
  if (entry.kind !== "html") {
    throw new ApiError(404, "invalid_request", "App entry is not HTML");
  }
  const metadata = await readAppFileMetadata(deps, {
    appId,
    target,
    rootKind: "assets",
    path: entry.path,
  });
  if (metadata.sizeBytes > HTML_ENTRY_MAX_BYTES) {
    throw new ApiError(
      413,
      "file_too_large",
      "App HTML entry exceeds the 5 MB limit",
      false,
    );
  }
  const result = await readAppRelativeFile(deps, {
    appId,
    target,
    rootKind: "assets",
    path: entry.path,
    dotfiles: "deny",
  });
  return createInjectedAppHtmlResponse(deps, {
    appId,
    requestUrl,
    threadId,
    html: decodeDaemonTextFile(result),
    capabilities: manifest.capabilities,
  });
}

async function serveAppAsset(
  deps: AppDeps,
  threadId: string,
  rawAppId: string,
  rawPath: string,
): Promise<Response> {
  const appId = parseAppId(rawAppId);
  const assetPath = parseAppAssetPath(rawPath);
  const target = await requireThreadAppsTarget(deps, threadId);
  try {
    const result = await readAppRelativeFile(deps, {
      appId,
      target,
      rootKind: "assets",
      path: assetPath.relativePath,
      dotfiles: "deny",
    });
    return createDaemonFileContentResponse(result, {
      headers: {
        "cache-control": NO_STORE_CACHE_CONTROL,
        "x-content-type-options": CONTENT_TYPE_OPTIONS,
      },
    });
  } catch (error) {
    return remapDaemonFileRouteError(error);
  }
}

async function serveAppIcon(
  deps: AppDeps,
  threadId: string,
  rawAppId: string,
): Promise<Response> {
  const appId = parseAppId(rawAppId);
  const target = await requireThreadAppsTarget(deps, threadId);
  const manifest = await readAppManifest(deps, { appId, target });
  if (manifest.icon !== undefined) {
    throw new ApiError(404, "ENOENT", "App uses a built-in icon");
  }
  const logo = await tryResolveLogo(deps, { appId, target });
  if (!logo) {
    throw new ApiError(404, "ENOENT", "App logo not found");
  }
  const logoPath = `logo.${logo.extension}`;
  const metadata = await readAppFileMetadata(deps, {
    appId,
    target,
    rootKind: "app",
    path: logoPath,
  });
  if (metadata.sizeBytes > LOGO_MAX_BYTES) {
    throw new ApiError(
      413,
      "file_too_large",
      "App logo exceeds the 1 MB limit",
      false,
    );
  }
  const result = await readAppRelativeFile(deps, {
    appId,
    target,
    rootKind: "app",
    path: logoPath,
    dotfiles: "deny",
  });
  const contentType = mimeTypes.lookup(logoPath) || "application/octet-stream";
  return new Response(decodeDaemonFileContent(result), {
    status: 200,
    headers: {
      "cache-control": NO_STORE_CACHE_CONTROL,
      "content-type": contentType,
      "x-content-type-options": CONTENT_TYPE_OPTIONS,
    },
  });
}

async function readAppDataEntry(
  deps: AppDeps,
  args: ReadAppDataEntryArgs,
): Promise<AppDataEntry> {
  const file = await readAppRelativeFile(deps, {
    appId: args.appId,
    target: args.target,
    rootKind: "data",
    path: args.dataPath,
    dotfiles: "deny",
  });
  let value: JsonValue;
  const bytes = Buffer.from(decodeDaemonFileContent(file));
  try {
    value = jsonValueSchema.parse(JSON.parse(bytes.toString("utf8")));
  } catch {
    throw new ApiError(
      422,
      "invalid_json",
      `App data path ${args.dataPath} does not contain valid JSON`,
    );
  }
  const modifiedAtMs =
    file.modifiedAtMs ??
    (
      await readAppFileMetadata(deps, {
        appId: args.appId,
        target: args.target,
        rootKind: "data",
        path: args.dataPath,
      })
    ).modifiedAtMs;
  return {
    path: args.dataPath,
    value,
    version: sha256(bytes),
    sizeBytes: file.sizeBytes,
    modifiedAtMs,
  };
}

function shouldListAppDataPrefixAfterReadError(error: Error): boolean {
  return (
    error instanceof ApiError &&
    (error.body.code === "ENOENT" ||
      (error.body.code === "invalid_path" &&
        error.body.message.includes("Path is a directory")))
  );
}

async function listAppDataEntries(
  deps: AppDeps,
  args: ListAppDataEntriesArgs,
): Promise<AppDataEntry[]> {
  if (args.dataPath !== "") {
    try {
      return [
        await readAppDataEntry(deps, {
          appId: args.appId,
          dataPath: args.dataPath,
          target: args.target,
        }),
      ];
    } catch (error) {
      if (
        !(error instanceof Error) ||
        !shouldListAppDataPrefixAfterReadError(error)
      ) {
        throw error;
      }
    }
  }

  const listRoot = args.dataPath
    ? path.join(appDataRootPath(args), args.dataPath)
    : appDataRootPath(args);
  let listResult: HostDaemonCommandResult<"host.list_paths">;
  try {
    listResult = await queueHostCommand(deps, {
      hostId: args.target.hostId,
      command: {
        type: "host.list_paths",
        path: listRoot,
        limit: FILE_LIST_LIMIT_MAX,
        includeFiles: true,
        includeDirectories: false,
      },
    });
  } catch (error) {
    if (error instanceof ApiError && error.body.code === "ENOENT") {
      return [];
    }
    throw error;
  }

  const dataPaths = listResult.paths
    .filter((entry) => entry.kind === "file")
    .map((entry) =>
      args.dataPath ? `${args.dataPath}/${entry.path}` : entry.path,
    )
    .map((entryPath) => appDataPathSchema.safeParse(entryPath))
    .filter((entryPath) => entryPath.success)
    .map((entryPath) => entryPath.data)
    .sort((left, right) => left.localeCompare(right));

  return Promise.all(
    dataPaths.map((dataPath) =>
      readAppDataEntry(deps, {
        appId: args.appId,
        dataPath,
        target: args.target,
      }),
    ),
  );
}

async function writeAppDataEntry(
  deps: AppDeps,
  args: WriteAppDataEntryArgs,
): Promise<AppDataEntry> {
  const content = canonicalizeJson(args.value);
  const result = await queueHostCommand(deps, {
    hostId: args.target.hostId,
    command: {
      type: "host.write_file_relative",
      rootPath: appDataRootPath(args),
      path: args.dataPath,
      dotfiles: "deny",
      content,
      contentEncoding: "utf8",
    },
  });
  return {
    path: args.dataPath,
    value: args.value,
    version: result.hash,
    sizeBytes: result.sizeBytes,
    modifiedAtMs: result.modifiedAtMs,
  };
}

async function deleteAppDataEntry(
  deps: AppDeps,
  args: DeleteAppDataEntryArgs,
): Promise<void> {
  await queueHostCommand(deps, {
    hostId: args.target.hostId,
    command: {
      type: "host.delete_file_relative",
      rootPath: appDataRootPath(args),
      path: args.dataPath,
      dotfiles: "deny",
    },
  });
}

function createTemplateManifest(
  request: CreateThreadAppRequest,
  template: AppTemplate,
): AppManifest {
  const manifest: AppManifest = {
    manifestVersion: 1,
    id: request.id,
    name: request.name,
    entry: "index.html",
    contributions: ["thread.app"],
    capabilities: ["data", "message"],
  };
  if (template === "status") {
    manifest.icon = "ListTodo";
  }
  return manifest;
}

function blankIndexHtml(name: string): string {
  return BLANK_APP_INDEX_HTML_TEMPLATE.replaceAll(
    BLANK_APP_NAME_PLACEHOLDER,
    escapeHtmlText(name),
  );
}

async function templateFilesForRequest(
  request: CreateThreadAppRequest,
): Promise<TemplateFile[]> {
  const manifest = createTemplateManifest(request, request.template);
  if (request.template === "blank") {
    return [
      {
        path: MANIFEST_FILE_NAME,
        content: canonicalizeJson(manifest),
      },
      {
        path: "assets/index.html",
        content: blankIndexHtml(request.name),
      },
      {
        path: "data/state.json",
        content: canonicalizeJson({}),
      },
    ];
  }

  const templateDir = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    "../../services/threads/default-template/apps/status",
  );
  const [indexHtml, stateJson] = await Promise.all([
    readFile(path.join(templateDir, "assets/index.html"), "utf8"),
    readFile(path.join(templateDir, "data/state.json"), "utf8"),
  ]);
  return [
    {
      path: MANIFEST_FILE_NAME,
      content: canonicalizeJson(manifest),
    },
    {
      path: "assets/index.html",
      content: indexHtml,
    },
    {
      path: "data/state.json",
      content: stateJson,
    },
  ];
}

async function scaffoldApp(
  deps: AppDeps,
  args: ScaffoldAppArgs,
): Promise<AppDetail> {
  try {
    await readAppManifest(deps, {
      appId: args.request.id,
      target: args.target,
    });
    throw new ApiError(409, "invalid_request", "App already exists");
  } catch (error) {
    if (!(error instanceof ApiError) || error.status !== 404) {
      throw error;
    }
  }

  const files = await templateFilesForRequest(args.request);
  for (const file of files) {
    await queueHostCommand(deps, {
      hostId: args.target.hostId,
      command: {
        type: "host.write_file_relative",
        rootPath: appRootPath({
          appId: args.request.id,
          target: args.target,
        }),
        path: file.path,
        dotfiles: "deny",
        content: file.content,
        contentEncoding: "utf8",
      },
    });
  }
  return buildAppDetail(deps, {
    appId: args.request.id,
    target: args.target,
    requestThreadId: args.threadId,
  });
}

export function registerThreadAppRoutes(app: Hono, deps: AppDeps): void {
  const { get, post, put, del } = typedRoutes<PublicApiSchema>(app, {
    onValidationError: (msg) => new ApiError(400, "invalid_request", msg),
  });

  get("/threads/:id/apps", async (context) =>
    context.json(await listThreadApps(deps, context.req.param("id"))),
  );

  post(
    "/threads/:id/apps",
    createThreadAppRequestSchema,
    async (context, payload) => {
      const threadId = context.req.param("id");
      const target = await requireThreadAppsTarget(deps, threadId);
      const detail = await scaffoldApp(deps, {
        target,
        request: payload,
        threadId,
      });
      return context.json(detail, 201);
    },
  );

  get("/threads/:id/apps/:appId", async (context) => {
    const threadId = context.req.param("id");
    const appId = parseAppId(context.req.param("appId"));
    const target = await requireThreadAppsTarget(deps, threadId);
    return context.json(
      await buildAppDetail(deps, {
        appId,
        target,
        requestThreadId: threadId,
      }),
    );
  });

  del("/threads/:id/apps/:appId", async (context) => {
    const threadId = context.req.param("id");
    const appId = parseAppId(context.req.param("appId"));
    const target = await requireThreadAppsTarget(deps, threadId);
    const result = await queueHostCommand(deps, {
      hostId: target.hostId,
      command: {
        type: "host.delete_path_relative",
        rootPath: path.join(target.storagePath, APPS_DIRECTORY_NAME),
        path: appId,
        dotfiles: "deny",
      },
    });
    if (!result.deleted) {
      throw new ApiError(404, "ENOENT", `App not found: ${appId}`);
    }
    return context.json({ ok: true });
  });

  get(
    "/threads/:id/apps/:appId/data",
    appDataListQuerySchema,
    async (context, query) => {
      const target = await requireThreadAppsTarget(
        deps,
        context.req.param("id"),
      );
      const appId = parseAppId(context.req.param("appId"));
      assertAppCapability(
        await readAppManifest(deps, { appId, target }),
        "data",
      );
      const dataPath = parseOptionalAppDataPrefix(query.prefix);
      return context.json({
        entries: await listAppDataEntries(deps, {
          appId,
          target,
          dataPath,
        }),
      });
    },
  );

  post(
    "/threads/:id/apps/:appId/message",
    appMessageRequestSchema,
    async (context, payload) => {
      const thread = requirePublicThread(deps.db, context.req.param("id"));
      const manifest = await readAppManifest(deps, {
        appId: parseAppId(context.req.param("appId")),
        target: await requireThreadAppsTarget(deps, thread.id),
      });
      assertAppCapability(manifest, "message");
      const environment = await requireThreadCommandEnvironment(deps, {
        thread,
      });
      await sendThreadMessage(deps, {
        environment,
        thread,
        trigger: "user",
        payload: {
          input: [{ type: "text", text: payload.text }],
          mode: "auto",
        },
      });
      return context.json({ ok: true });
    },
  );

  app.get("/threads/:id/apps/:appId/", async (context) =>
    serveAppEntry(
      deps,
      context.req.param("id"),
      context.req.param("appId"),
      context.req.url,
    ),
  );

  app.get("/threads/:id/apps/:appId/icon", async (context) =>
    serveAppIcon(deps, context.req.param("id"), context.req.param("appId")),
  );

  get("/threads/:id/apps/:appId/data/*", async (context) => {
    const target = await requireThreadAppsTarget(deps, context.req.param("id"));
    const appId = parseAppId(context.req.param("appId"));
    assertAppCapability(await readAppManifest(deps, { appId, target }), "data");
    const dataPath = parseAppDataRoutePath(
      extractRoutePath({
        requestUrl: context.req.url,
        routeSegment: APP_ROUTE_DATA_SEGMENT,
      }),
    );
    const entry = await readAppDataEntry(deps, {
      appId,
      target,
      dataPath,
    });
    const response = context.json(entry);
    response.headers.set("cache-control", NO_STORE_CACHE_CONTROL);
    response.headers.set("etag", `"${entry.version}"`);
    return response;
  });

  put(
    "/threads/:id/apps/:appId/data/*",
    appDataWriteRequestSchema,
    async (context, payload) => {
      const target = await requireThreadAppsTarget(
        deps,
        context.req.param("id"),
      );
      const appId = parseAppId(context.req.param("appId"));
      const manifest = await readAppManifest(deps, { appId, target });
      assertAppCapability(manifest, "data");
      const dataPath = parseAppDataRoutePath(
        extractRoutePath({
          requestUrl: context.req.url,
          routeSegment: APP_ROUTE_DATA_SEGMENT,
        }),
      );
      const entry = await writeAppDataEntry(deps, {
        appId,
        target,
        dataPath,
        value: payload.value,
      });
      const response = context.json(entry);
      response.headers.set("cache-control", NO_STORE_CACHE_CONTROL);
      response.headers.set("etag", `"${entry.version}"`);
      return response;
    },
  );

  del("/threads/:id/apps/:appId/data/*", async (context) => {
    const target = await requireThreadAppsTarget(deps, context.req.param("id"));
    const appId = parseAppId(context.req.param("appId"));
    const manifest = await readAppManifest(deps, { appId, target });
    assertAppCapability(manifest, "data");
    const dataPath = parseAppDataRoutePath(
      extractRoutePath({
        requestUrl: context.req.url,
        routeSegment: APP_ROUTE_DATA_SEGMENT,
      }),
    );
    await deleteAppDataEntry(deps, {
      appId,
      target,
      dataPath,
    });
    const response = context.json({ ok: true });
    response.headers.set("cache-control", NO_STORE_CACHE_CONTROL);
    return response;
  });

  // Keep this flat asset wildcard last among GET app routes so typed app
  // endpoints such as /data/* and /icon keep their route ownership.
  app.get("/threads/:id/apps/:appId/*", async (context) => {
    const threadId = context.req.param("id");
    const appId = context.req.param("appId");
    return serveAppAsset(
      deps,
      threadId,
      appId,
      extractRoutePath({
        requestUrl: context.req.url,
        routeSegment: appAssetRouteSegment({ threadId, appId }),
      }),
    );
  });
}

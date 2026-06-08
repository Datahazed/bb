import { createNodeWebSocket } from "@hono/node-ws";
import { readFile, stat } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import { extname, join, resolve } from "node:path";
import { Hono } from "hono";
import { cors } from "hono/cors";
import {
  buildLocalAppOrigins,
  type BuildLocalAppOriginsArgs,
} from "@bb/config/local-app-origins";
import type { AppDeps, ServerAppDeps } from "./types.js";
import { registerLocalApiRoutes } from "./engine/local-api/local-api.js";
import { ApiError, errorToResponse } from "./errors.js";
import { LOCAL_HOST_ID } from "./services/hosts/local-host.js";
import { registerAutomationRoutes } from "./routes/automations.js";
import { registerGlobalAppRoutes } from "./routes/apps.js";
import { registerEnvironmentRoutes } from "./routes/environments.js";
import { registerFileRoutes } from "./routes/files.js";
import { registerHostRoutes } from "./routes/hosts.js";
import { registerProjectRoutes } from "./routes/projects.js";
import { registerSystemRoutes } from "./routes/system.js";
import { registerDevelopmentOnlyReplayRoutes } from "./routes/internal-replay.js";
import { registerThreadRoutes } from "./routes/threads/index.js";
import { captureTrustedRemoteAddress } from "./request-context.js";
import {
  onClientSocketClose,
  onClientSocketMessage,
  onClientSocketOpen,
} from "./ws/client-protocol.js";
import { roundDurationMs } from "./services/lib/duration.js";
import {
  onTerminalSocketClose,
  onTerminalSocketMessage,
  onTerminalSocketOpen,
} from "./ws/terminal-protocol.js";

export type CloseWebSockets = () => Promise<void>;
type NodeWebSocketServer = ReturnType<typeof createNodeWebSocket>["wss"];
type WebSocketCloseError = Error | undefined;

export interface ServerApp {
  app: Hono;
  closeWebSockets: CloseWebSockets;
  injectWebSocket: ReturnType<typeof createNodeWebSocket>["injectWebSocket"];
}

interface CloseWebSocketServerArgs {
  forceCloseAfterMs: number;
  reason: string;
  server: NodeWebSocketServer;
}

interface CreateAppOptions {
  slowApiRequestLogThresholdMs?: number;
  staticDir?: string;
}

interface StaticResponseHeadersArgs {
  contentType: string;
  urlPath: string;
}

const STATIC_INDEX_CACHE_CONTROL = "no-store";
const STATIC_ASSET_CACHE_CONTROL = "public, max-age=31536000, immutable";
const WEB_SOCKET_SHUTDOWN_CODE = 1001;
const WEB_SOCKET_SHUTDOWN_FORCE_CLOSE_MS = 1_000;
const WEB_SOCKET_SHUTDOWN_REASON = "server-shutdown";
const SLOW_API_REQUEST_LOG_THRESHOLD_MS = 1_000;
const THREAD_EVENT_WAIT_PATH_PATTERN =
  /^\/api\/v1\/threads\/[^/]+\/events\/wait$/u;

interface ShouldLogSlowApiRequestArgs {
  durationMs: number;
  path: string;
  thresholdMs: number;
}

function shouldLogSlowApiRequest(args: ShouldLogSlowApiRequestArgs): boolean {
  if (args.durationMs < args.thresholdMs) {
    return false;
  }
  return !THREAD_EVENT_WAIT_PATH_PATTERN.test(args.path);
}

function createStaticResponseHeaders(args: StaticResponseHeadersArgs): Headers {
  const headers = new Headers();
  headers.set("content-type", args.contentType);
  headers.set(
    "cache-control",
    args.urlPath.startsWith("/assets/")
      ? STATIC_ASSET_CACHE_CONTROL
      : STATIC_INDEX_CACHE_CONTROL,
  );
  return headers;
}

function buildAllowedCorsOrigins(deps: AppDeps): Set<string> {
  const originArgs: BuildLocalAppOriginsArgs = {
    serverPort: deps.config.serverPort,
  };
  if (deps.config.appUrl !== undefined) {
    originArgs.appUrl = deps.config.appUrl;
  }
  if (deps.config.devAppPort !== undefined) {
    originArgs.devAppPort = deps.config.devAppPort;
  }

  return new Set<string>(buildLocalAppOrigins(originArgs));
}

function closeWebSocketServer(args: CloseWebSocketServerArgs): Promise<void> {
  for (const client of args.server.clients) {
    client.close(WEB_SOCKET_SHUTDOWN_CODE, args.reason);
  }

  return new Promise<void>((resolvePromise, reject) => {
    const forceCloseTimeout = setTimeout(() => {
      for (const client of args.server.clients) {
        client.terminate();
      }
    }, args.forceCloseAfterMs);
    forceCloseTimeout.unref();

    args.server.close((error: WebSocketCloseError) => {
      clearTimeout(forceCloseTimeout);
      if (error) {
        reject(error);
        return;
      }
      resolvePromise();
    });
  });
}

export function createApp(
  deps: ServerAppDeps,
  options?: CreateAppOptions,
): ServerApp {
  const app = new Hono();
  const { injectWebSocket, upgradeWebSocket, wss } = createNodeWebSocket({
    app,
  });
  const slowApiRequestLogThresholdMs =
    options?.slowApiRequestLogThresholdMs ?? SLOW_API_REQUEST_LOG_THRESHOLD_MS;

  app.use("*", async (context, next) => {
    captureTrustedRemoteAddress(context);
    await next();
  });
  app.use(
    "*",
    cors({
      origin: (origin, context) => {
        const allowedCorsOrigins = buildAllowedCorsOrigins(deps);
        const requestOrigin = new URL(context.req.url).origin;
        if (origin === requestOrigin || allowedCorsOrigins.has(origin)) {
          return origin;
        }
        return null;
      },
    }),
  );
  app.onError((error) => errorToResponse(error, deps.logger));
  app.get("/health", (context) => context.json({ ok: true }));
  app.use("/api/v1/*", async (context, next) => {
    const startedAt = performance.now();
    await next();
    const durationMs = performance.now() - startedAt;
    const path = context.req.path;
    if (
      shouldLogSlowApiRequest({
        durationMs,
        path,
        thresholdMs: slowApiRequestLogThresholdMs,
      })
    ) {
      deps.logger.debug(
        {
          durationMs: roundDurationMs(durationMs),
          method: context.req.method,
          path,
          status: context.res.status,
        },
        "Slow API request",
      );
    }
  });
  app.use("/api/v1/development-only/*", async (_context, next) => {
    if (!deps.config.isDevelopment) {
      throw new ApiError(404, "not_found", "Not found");
    }
    return next();
  });
  const publicApi = new Hono();
  registerGlobalAppRoutes(publicApi, deps);
  registerProjectRoutes(publicApi, deps);
  registerAutomationRoutes(publicApi, deps);
  registerFileRoutes(publicApi, deps);
  registerHostRoutes(publicApi);
  registerEnvironmentRoutes(publicApi, deps);
  registerThreadRoutes(publicApi, deps);
  registerSystemRoutes(publicApi, deps);
  registerDevelopmentOnlyReplayRoutes(publicApi, deps);
  app.route("/api/v1", publicApi);
  app.use("/api/v1/*", () => {
    throw new ApiError(404, "not_found", "Not found");
  });

  // The daemon transport is unmounted (plan §6 Phase 1): /internal/* routes
  // and the daemon WS protocol no longer exist at runtime. Their modules
  // survive compiling until P1c deletes them.

  // The former :38887 daemon local API, served from the server's own port at
  // root paths (plan §4.3, Decision 5). MUST register before the SPA
  // `app.get("*")` catch-all below — Hono dispatch is registration-order
  // dependent, and the frozen FE treats a 200+HTML answer on `/status` as
  // "no daemon" with zero error surfaced (plan R1). The daemon's text
  // `GET /health` is deliberately not mounted: the server's JSON
  // `/health {ok:true}` wins (desktop probe, plan §4.4). CORS for these
  // paths is the app-wide `buildLocalAppOrigins` policy above.
  registerLocalApiRoutes(app, {
    hostId: LOCAL_HOST_ID,
    // Lazy: the test harnesses patch `config.serverPort` after binding port 0.
    resolveServerUrl: () => `http://127.0.0.1:${deps.config.serverPort}`,
  });

  app.get(
    "/ws",
    upgradeWebSocket(() => ({
      onOpen: (_event, socket) => onClientSocketOpen(deps.hub, socket),
      onMessage: (event, socket) =>
        onClientSocketMessage(deps.hub, socket, event.data),
      onClose: (_event, socket) => onClientSocketClose(deps.hub, socket),
    })),
  );

  app.get(
    "/ws/threads/:threadId/terminals/:terminalId",
    upgradeWebSocket((context) => {
      const threadId = context.req.param("threadId");
      const terminalId = context.req.param("terminalId");
      return {
        onOpen: (_event, socket) =>
          onTerminalSocketOpen(deps, {
            socket,
            terminalId,
            threadId,
          }),
        onMessage: (event, socket) =>
          onTerminalSocketMessage(deps, {
            raw: event.data,
            socket,
            terminalId,
            threadId,
          }),
        onClose: (_event, socket) =>
          onTerminalSocketClose(deps, {
            socket,
            terminalId,
          }),
      };
    }),
  );

  if (!options?.staticDir) {
    app.get("/", (context) => context.text("bb server"));
  }

  if (options?.staticDir) {
    const root = resolve(options.staticDir);
    const MIME: Record<string, string> = {
      ".html": "text/html",
      ".js": "application/javascript",
      ".css": "text/css",
      ".json": "application/json",
      ".png": "image/png",
      ".svg": "image/svg+xml",
      ".ico": "image/x-icon",
      ".woff": "font/woff",
      ".woff2": "font/woff2",
      ".webp": "image/webp",
      ".map": "application/json",
    };

    app.get("*", async (context) => {
      const urlPath =
        context.req.path === "/" ? "/index.html" : context.req.path;
      const filePath = join(root, urlPath);
      if (!filePath.startsWith(root)) {
        return context.notFound();
      }
      try {
        const fileStat = await stat(filePath);
        if (fileStat.isFile()) {
          const content = await readFile(filePath);
          const contentType =
            MIME[extname(filePath)] ?? "application/octet-stream";
          return new Response(content, {
            headers: createStaticResponseHeaders({ contentType, urlPath }),
          });
        }
      } catch {
        // File not found — fall through to SPA fallback
      }
      const indexHtml = await readFile(join(root, "index.html"));
      return new Response(indexHtml, {
        headers: createStaticResponseHeaders({
          contentType: "text/html",
          urlPath: "/index.html",
        }),
      });
    });
  }

  return {
    app,
    closeWebSockets: () =>
      closeWebSocketServer({
        forceCloseAfterMs: WEB_SOCKET_SHUTDOWN_FORCE_CLOSE_MS,
        reason: WEB_SOCKET_SHUTDOWN_REASON,
        server: wss,
      }),
    injectWebSocket,
  };
}

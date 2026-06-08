/**
 * The former host-daemon `:38887` local API, reshaped to ride the server's
 * main port at root paths (plan §4.3). Adapted from
 * `apps/host-daemon/src/local-api.ts`:
 *
 * - `startLocalApiServer` (own `@hono/node-server` listener, bindHost/port,
 *   health-only mode) becomes `registerLocalApiRoutes(app, options)` — P1b
 *   registers these routes on the server's app BEFORE the SPA `app.get("*")`
 *   catch-all (Hono dispatch is registration-order dependent; a forgotten
 *   route returns 200+HTML and the FE silently concludes "no daemon" —
 *   plan R1).
 * - The daemon's text `GET /health` is the one `HostDaemonLocalSchema` route
 *   NOT preserved: the server's JSON `/health {ok:true}` wins (desktop
 *   probe, plan §4.3/§4.4).
 * - `getConnected` (daemon↔server session liveness) has no in-process
 *   equivalent: the local API rides the server itself, so `/status` emits
 *   `connected: true` constant. The FE derives local-host identity from the
 *   `hostId` + `connected` pair with no zod parse (plan R1/R6) — exact route
 *   paths and shapes per `@bb/host-daemon-contract` `local.ts` are pinned by
 *   the Phase 0 contract tests.
 * - The daemon's own CORS allowlist (`local-app-origins`) is NOT re-applied
 *   here: the server app already runs the identical `buildLocalAppOrigins`
 *   policy app-wide (`createApp`), which covers these routes — one canonical
 *   CORS path (plan §4.3 "CORS behavior preserved").
 */
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import { promisify } from "node:util";
import {
  HOST_DAEMON_PROTOCOL_VERSION,
  openInTargetRequestSchema,
  pathsExistRequestSchema,
  providerCliInstallRequestSchema,
  providerCliStatusResponseSchema,
  typedRoutes,
  type HostDaemonLocalSchema,
  type HostPlatform,
} from "@bb/host-daemon-contract";
import { sanitizeInheritedChildProcessEnv } from "@bb/process-utils";
import type { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import {
  getProviderCliStatus,
  ProviderCliInstallInProgressError,
  streamProviderCliInstall,
} from "./provider-cli-health.js";
import {
  listWorkspaceOpenTargets,
  openPathInTarget,
  WorkspaceOpenTargetError,
} from "./workspace-open-targets.js";

const execFileAsync = promisify(execFile);

export type FolderPickerHandler = () => Promise<string | null>;

export interface RegisterLocalApiRoutesOptions {
  /** Synthetic host id emitted in `/status` (`'local'` in P1b). The FE's
   * local-host identity is the `hostId` + `connected` pair (plan R1/R6) —
   * never hardcode the value here; the caller owns the constant. */
  hostId: string;
  /** The server's own origin, echoed in `/status.serverUrl` (plan §4.3).
   * Resolved per request: the test harnesses bind port 0 and learn the real
   * port only after the app is constructed. */
  resolveServerUrl: () => string;
  pickFolder?: FolderPickerHandler;
}

export interface ResolveNativeFolderPickerOptions {
  pickFolder?: FolderPickerHandler;
  platform?: NodeJS.Platform;
}

export function resolveNativeFolderPicker(
  options: ResolveNativeFolderPickerOptions,
): FolderPickerHandler | null {
  if (options.pickFolder) {
    return options.pickFolder;
  }

  return (options.platform ?? process.platform) === "darwin"
    ? pickLocalFolder
    : null;
}

export function resolveHostPlatform(
  nodePlatform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
): HostPlatform {
  if (nodePlatform === "darwin") return "darwin";
  if (nodePlatform === "linux") {
    const isWsl = env.WSL_DISTRO_NAME != null || env.WSL_INTEROP != null;
    return isWsl ? "wsl" : "linux";
  }
  return "unknown";
}

export function registerLocalApiRoutes(
  app: Hono,
  options: RegisterLocalApiRoutesOptions,
): void {
  const { get, post } = typedRoutes<HostDaemonLocalSchema>(app);
  const nativeFolderPicker = resolveNativeFolderPicker({
    pickFolder: options.pickFolder,
  });
  const platform = resolveHostPlatform();

  get("/status", (c) =>
    c.json({
      hostId: options.hostId,
      // In-process there is no daemon↔server link to lose, so `connected`
      // is constant (replaces the daemon's `getConnected` session probe).
      connected: true,
      protocolVersion: HOST_DAEMON_PROTOCOL_VERSION,
      serverUrl: options.resolveServerUrl(),
      supportsNativeFolderPicker: nativeFolderPicker !== null,
      platform,
    }),
  );

  get("/provider-clis/status", async (c) =>
    c.json(providerCliStatusResponseSchema.parse(await getProviderCliStatus())),
  );

  app.post("/provider-clis/install", async (c) => {
    const parsed = providerCliInstallRequestSchema.safeParse(
      await c.req.json().catch(() => null),
    );
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      throw new HTTPException(400, {
        message: issue?.message ?? "Invalid provider CLI install request",
      });
    }

    try {
      return new Response(
        streamProviderCliInstall({
          provider: parsed.data.provider,
          actionKind: parsed.data.actionKind,
        }),
        {
          headers: {
            "content-type": "application/x-ndjson; charset=utf-8",
            "cache-control": "no-store",
          },
        },
      );
    } catch (error) {
      if (error instanceof ProviderCliInstallInProgressError) {
        throw new HTTPException(409, {
          message: error.message,
        });
      }
      throw error;
    }
  });

  post("/paths/exist", pathsExistRequestSchema, async (c, payload) => {
    const entries = await Promise.all(
      payload.paths.map(
        async (path) => [path, await pathExists(path)] as const,
      ),
    );
    return c.json({ existence: Object.fromEntries(entries) });
  });

  get("/workspace-open-targets", async (c) =>
    c.json({
      targets: await listWorkspaceOpenTargets(),
    }),
  );

  post("/open-in-target", openInTargetRequestSchema, async (c, payload) => {
    try {
      await openPathInTarget(payload);
    } catch (error) {
      if (error instanceof WorkspaceOpenTargetError) {
        throw new HTTPException(400, { message: error.message });
      }
      throw error;
    }

    return c.json({});
  });

  post("/pick-folder", async (c) => {
    if (!nativeFolderPicker) {
      throw new HTTPException(501, {
        message: "Folder picker is only supported on macOS",
      });
    }
    const path = await nativeFolderPicker();
    return c.json({ path });
  });
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await fs.stat(path);
    return true;
  } catch (error) {
    if (
      error instanceof Error &&
      "code" in error &&
      (error.code === "ENOENT" || error.code === "ENOTDIR")
    ) {
      return false;
    }
    // Permission denied / loops / etc. — we can't tell, but the entry exists
    // enough to error on, so don't claim it's missing.
    return true;
  }
}

async function pickLocalFolder(): Promise<string | null> {
  let stdout: string;
  try {
    const result = await execFileAsync(
      "osascript",
      [
        "-e",
        'try\nPOSIX path of (choose folder with prompt "Choose a project folder")\non error number -128\nreturn ""\nend try',
      ],
      {
        env: sanitizeInheritedChildProcessEnv({ env: process.env }),
      },
    );
    stdout = result.stdout;
  } catch (error) {
    throw new HTTPException(500, {
      message: `Folder picker failed: ${error instanceof Error ? error.message : String(error)}`,
    });
  }
  const selectedPath = stdout.trim();
  if (selectedPath === "") {
    return null;
  }
  return selectedPath.replace(/\/$/, "");
}

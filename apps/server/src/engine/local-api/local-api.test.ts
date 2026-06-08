import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  HOST_DAEMON_PROTOCOL_VERSION,
  statusResponseSchema,
  workspaceOpenTargetsResponseSchema,
  type OpenInTargetRequest,
  type PathsExistRequest,
} from "@bb/host-daemon-contract";
import { Hono } from "hono";
import {
  registerLocalApiRoutes,
  resolveHostPlatform,
  resolveNativeFolderPicker,
  type RegisterLocalApiRoutesOptions,
} from "./local-api.js";

type LocalApiPostBody =
  | PathsExistRequest
  | OpenInTargetRequest
  | Record<string, never>;

function createLocalApiApp(
  overrides: Partial<RegisterLocalApiRoutesOptions> = {},
): Hono {
  const app = new Hono();
  registerLocalApiRoutes(app, {
    hostId: "host-1",
    resolveServerUrl: () => "http://server.test",
    ...overrides,
  });
  return app;
}

interface PostJsonArgs {
  app: Hono;
  body: LocalApiPostBody;
  routePath: string;
}

async function postJson(args: PostJsonArgs): Promise<Response> {
  return await args.app.request(args.routePath, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(args.body),
  });
}

describe("local API routes", () => {
  it("resolves native folder picker support from one shared helper", () => {
    const providedPicker = async () => "/tmp/project";

    expect(
      resolveNativeFolderPicker({
        pickFolder: providedPicker,
        platform: "linux",
      }),
    ).toBe(providedPicker);
    expect(
      resolveNativeFolderPicker({
        platform: "darwin",
      }),
    ).not.toBeNull();
    expect(
      resolveNativeFolderPicker({
        platform: "linux",
      }),
    ).toBeNull();
  });

  it("serves host identity and status with a constant connected flag", async () => {
    const app = createLocalApiApp();

    const statusResponse = await app.request("/status");

    // The FE derives local-host identity from the hostId + connected pair
    // with no zod parse (plan R1/R6) — pin the values, and pin the JSON
    // content-type so a SPA-catch-all 200+HTML regression trips loudly.
    expect(statusResponse.headers.get("content-type")).toContain(
      "application/json",
    );
    expect(await statusResponse.json()).toEqual({
      hostId: "host-1",
      connected: true,
      protocolVersion: HOST_DAEMON_PROTOCOL_VERSION,
      serverUrl: "http://server.test",
      supportsNativeFolderPicker:
        resolveNativeFolderPicker({
          platform: process.platform,
        }) !== null,
      platform: resolveHostPlatform(),
    });
  });

  it("delegates folder-pick operations to the provided callback", async () => {
    const pickFolder = vi.fn(async () => "/tmp/project");
    const app = createLocalApiApp({ pickFolder });

    const statusResponse = await app.request("/status");
    const pickFolderResponse = await postJson({
      app,
      body: {},
      routePath: "/pick-folder",
    });

    expect(await statusResponse.json()).toMatchObject({
      supportsNativeFolderPicker: true,
    });
    expect(pickFolder).toHaveBeenCalledTimes(1);
    expect(await pickFolderResponse.json()).toEqual({ path: "/tmp/project" });
  });

  it("reports path existence by stat'ing each requested path", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "bb-path-exists-"));
    const existingDir = path.join(dir, "repo");
    const existingFile = path.join(dir, "file.txt");
    const missing = path.join(dir, "nope");
    await mkdir(existingDir);
    await writeFile(existingFile, "hi");

    try {
      const app = createLocalApiApp();

      const response = await postJson({
        app,
        body: { paths: [existingDir, existingFile, missing] },
        routePath: "/paths/exist",
      });

      expect(await response.json()).toEqual({
        existence: {
          [existingDir]: true,
          [existingFile]: true,
          [missing]: false,
        },
      });
    } finally {
      await rm(dir, { force: true, recursive: true });
    }
  });

  it("treats permission-denied paths as existing rather than failing the batch", async () => {
    if (process.platform === "win32" || process.getuid?.() === 0) {
      return;
    }
    const dir = await mkdtemp(path.join(tmpdir(), "bb-path-exists-eacces-"));
    const lockedParent = path.join(dir, "locked");
    const inaccessible = path.join(lockedParent, "child");
    const reachable = path.join(dir, "reachable");
    await mkdir(lockedParent);
    await mkdir(reachable);
    await chmod(lockedParent, 0o000);

    try {
      const app = createLocalApiApp();

      const response = await postJson({
        app,
        body: { paths: [inaccessible, reachable] },
        routePath: "/paths/exist",
      });

      expect(response.ok).toBe(true);
      expect(await response.json()).toEqual({
        existence: {
          [inaccessible]: true,
          [reachable]: true,
        },
      });
    } finally {
      await chmod(lockedParent, 0o700);
      await rm(dir, { force: true, recursive: true });
    }
  });

  it("dedupes repeated paths in /paths/exist and rejects oversized batches", async () => {
    const app = createLocalApiApp();

    const dir = await mkdtemp(path.join(tmpdir(), "bb-path-exists-dedup-"));
    try {
      const dedupeResponse = await postJson({
        app,
        body: { paths: [dir, dir, dir] },
        routePath: "/paths/exist",
      });
      expect(await dedupeResponse.json()).toEqual({
        existence: { [dir]: true },
      });

      const oversizedPaths = Array.from(
        { length: 201 },
        (_, i) => `${dir}/p${i}`,
      );
      const oversizedResponse = await postJson({
        app,
        body: { paths: oversizedPaths },
        routePath: "/paths/exist",
      });
      expect(oversizedResponse.ok).toBe(false);
    } finally {
      await rm(dir, { force: true, recursive: true });
    }
  });

  it("serves workspace open targets in the contract shape", async () => {
    // The daemon's handler-injection options were test-only (no production
    // caller) and died with the reshape; the route now binds the real
    // lister, whose behavior is covered by workspace-open-targets.test.ts.
    // This pins the route wiring: 200 + contract-shaped JSON.
    const app = createLocalApiApp();

    const response = await app.request("/workspace-open-targets");

    expect(response.status).toBe(200);
    const body = workspaceOpenTargetsResponseSchema.parse(
      await response.json(),
    );
    if (process.platform !== "darwin") {
      expect(body.targets).toEqual([]);
    }
  });

  it("translates workspace opener errors to bad requests", async () => {
    const app = createLocalApiApp();

    // Deterministically a WorkspaceOpenTargetError on every platform with no
    // side effects: off-darwin → unsupported_platform; on darwin either the
    // target is unavailable (target_unavailable) or the availability probe
    // passes and the missing path fails requireOpenablePath
    // (path_not_found) — all before any `open` invocation.
    const response = await postJson({
      app,
      body: {
        lineNumber: null,
        path: path.join(tmpdir(), "bb-missing-workspace-local-api"),
        targetId: "vscode",
      },
      routePath: "/open-in-target",
    });

    expect(response.status).toBe(400);
  });

  it("returns 501 for folder picking when native picker support is unavailable", async () => {
    if (process.platform === "darwin") {
      return;
    }

    const app = createLocalApiApp();

    const statusResponse = await app.request("/status");
    const status = statusResponseSchema.parse(await statusResponse.json());
    expect(status.supportsNativeFolderPicker).toBe(false);

    const pickFolderResponse = await postJson({
      app,
      body: {},
      routePath: "/pick-folder",
    });
    expect(pickFolderResponse.status).toBe(501);
  });

  it("rejects invalid provider CLI install bodies before spawning anything", async () => {
    const app = createLocalApiApp();

    const response = await postJson({
      app,
      body: {},
      routePath: "/provider-clis/install",
    });

    expect(response.status).toBe(400);
  });

  // CORS for these routes is the server app's own app-wide
  // `buildLocalAppOrigins` policy (`createApp`) — covered at that level.
});

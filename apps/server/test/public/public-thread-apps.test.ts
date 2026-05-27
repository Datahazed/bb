import { createHash } from "node:crypto";
import type { HostDaemonCommand } from "@bb/host-daemon-contract";
import {
  appDataListResponseSchema,
  appDataReadResponseSchema,
  appDetailSchema,
  appSummarySchema,
  type AppManifest,
} from "@bb/server-contract";
import { describe, expect, it } from "vitest";
import {
  reportQueuedCommandError,
  reportQueuedCommandSuccess,
  waitForQueuedCommand,
  waitForQueuedCommandAfter,
  type QueuedCommand,
} from "../helpers/commands.js";
import { readJson } from "../helpers/json.js";
import type { TestAppHarness } from "../helpers/test-app.js";
import {
  seedEnvironment,
  seedHostSession,
  seedProjectWithSource,
  seedThread,
} from "../helpers/seed.js";
import { createTestAppHarness } from "../helpers/test-app.js";

interface ManagerThreadStorageFixture {
  hostId: string;
  threadId: string;
  storageRootPath: string;
}

interface ReadFileResultArgs {
  content: string;
  mimeType?: string;
  path: string;
}

interface PathEntryArgs {
  kind: "directory" | "file";
  path: string;
}

interface ManifestReadArgs {
  appId: string;
  afterCursor?: number;
  fixture: ManagerThreadStorageFixture;
  harness: TestAppHarness;
  manifest: AppManifest;
}

type WriteFileRelativeQueuedCommand = QueuedCommand<
  Extract<HostDaemonCommand, { type: "host.write_file_relative" }>
>;

const STATUS_MANIFEST: AppManifest = {
  manifestVersion: 1,
  id: "status",
  name: "Status",
  icon: "ListTodo",
  entry: "index.html",
  contributions: ["thread.app"],
  capabilities: ["data", "message"],
};

function seedManagerThreadStorage(
  harness: TestAppHarness,
): ManagerThreadStorageFixture {
  const { host } = seedHostSession(harness.deps, {
    id: "host-thread-apps",
  });
  const { project } = seedProjectWithSource(harness.deps, {
    hostId: host.id,
    path: "/tmp/project-source",
  });
  const environment = seedEnvironment(harness.deps, {
    hostId: host.id,
    projectId: project.id,
    path: "/tmp/project-source",
  });
  const thread = seedThread(harness.deps, {
    projectId: project.id,
    environmentId: environment.id,
    type: "manager",
  });
  return {
    hostId: host.id,
    threadId: thread.id,
    storageRootPath: `/tmp/bb-host-data/${host.id}/thread-storage/${thread.id}`,
  };
}

function appRoot(fixture: ManagerThreadStorageFixture, appId: string): string {
  return `${fixture.storageRootPath}/apps/${appId}`;
}

function appAssetsRoot(
  fixture: ManagerThreadStorageFixture,
  appId: string,
): string {
  return `${appRoot(fixture, appId)}/assets`;
}

function appDataRoot(
  fixture: ManagerThreadStorageFixture,
  appId: string,
): string {
  return `${appRoot(fixture, appId)}/data`;
}

function sha256Text(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

function readFileResult(args: ReadFileResultArgs) {
  return {
    path: args.path,
    content: args.content,
    contentEncoding: "utf8" as const,
    ...(args.mimeType ? { mimeType: args.mimeType } : {}),
    sizeBytes: Buffer.byteLength(args.content),
  };
}

function pathEntry(args: PathEntryArgs) {
  return {
    kind: args.kind,
    path: args.path,
    name: args.path.split("/").at(-1) ?? args.path,
    score: 1,
    positions: [],
  };
}

function requireWriteFileRelativeCommand(
  queued: QueuedCommand,
): WriteFileRelativeQueuedCommand {
  if (queued.command.type === "host.write_file_relative") {
    return {
      command: queued.command,
      row: queued.row,
    };
  }
  throw new Error("Expected host.write_file_relative command");
}

async function reportManifestRead(args: ManifestReadArgs): Promise<QueuedCommand> {
  const queued = args.afterCursor
    ? await waitForQueuedCommandAfter(
        args.harness,
        args.afterCursor,
        ({ command }) =>
          command.type === "host.read_file_relative" &&
          command.rootPath === appRoot(args.fixture, args.appId) &&
          command.path === "manifest.json",
      )
    : await waitForQueuedCommand(
        args.harness,
        ({ command }) =>
          command.type === "host.read_file_relative" &&
          command.rootPath === appRoot(args.fixture, args.appId) &&
          command.path === "manifest.json",
      );
  const content = `${JSON.stringify(args.manifest, null, 2)}\n`;
  await reportQueuedCommandSuccess(
    args.harness,
    queued,
    readFileResult({
      path: "manifest.json",
      content,
      mimeType: "application/json",
    }),
  );
  return queued;
}

describe("public thread app routes", () => {
  it("lists app summaries from daemon-owned manifests", async () => {
    const harness = await createTestAppHarness();
    try {
      const fixture = seedManagerThreadStorage(harness);
      const request = harness.app.request(
        `/api/v1/threads/${fixture.threadId}/apps`,
      );
      const listCommand = await waitForQueuedCommand(
        harness,
        ({ command }) =>
          command.type === "host.list_paths" &&
          command.path === `${fixture.storageRootPath}/apps`,
      );
      await reportQueuedCommandSuccess(harness, listCommand, {
        paths: [
          pathEntry({ kind: "directory", path: "demo" }),
          pathEntry({ kind: "directory", path: "status" }),
        ],
        truncated: false,
      });
      await reportManifestRead({
        harness,
        fixture,
        appId: "demo",
        afterCursor: listCommand.row.cursor,
        manifest: {
          ...STATUS_MANIFEST,
          id: "demo",
          name: "Demo",
          icon: "GridView",
        },
      });
      await reportManifestRead({
        harness,
        fixture,
        appId: "status",
        afterCursor: listCommand.row.cursor,
        manifest: STATUS_MANIFEST,
      });

      const response = await request;
      expect(response.status).toBe(200);
      const apps = appSummarySchema.array().parse(await readJson(response));
      expect(apps.map((app) => app.id)).toEqual(["demo", "status"]);
      expect(apps[0]?.icon).toEqual({ kind: "builtin", name: "GridView" });
      expect(apps[1]?.icon).toEqual({ kind: "builtin", name: "ListTodo" });
    } finally {
      await harness.cleanup();
    }
  });

  it("serves HTML app entries with capability-scoped window.bb injection", async () => {
    const harness = await createTestAppHarness();
    try {
      const fixture = seedManagerThreadStorage(harness);
      const html = "<!doctype html><html><head></head><body>Status</body></html>";
      const request = harness.app.request(
        `/api/v1/threads/${fixture.threadId}/apps/status/`,
      );
      const manifestCommand = await reportManifestRead({
        harness,
        fixture,
        appId: "status",
        manifest: STATUS_MANIFEST,
      });
      const metadataCommand = await waitForQueuedCommandAfter(
        harness,
        manifestCommand.row.cursor,
        ({ command }) =>
          command.type === "host.file_metadata" &&
          command.path === `${appAssetsRoot(fixture, "status")}/index.html`,
      );
      await reportQueuedCommandSuccess(harness, metadataCommand, {
        path: `${appAssetsRoot(fixture, "status")}/index.html`,
        modifiedAtMs: 1234,
        sizeBytes: Buffer.byteLength(html),
      });
      const entryCommand = await waitForQueuedCommandAfter(
        harness,
        metadataCommand.row.cursor,
        ({ command }) =>
          command.type === "host.read_file_relative" &&
          command.rootPath === appAssetsRoot(fixture, "status") &&
          command.path === "index.html",
      );
      await reportQueuedCommandSuccess(
        harness,
        entryCommand,
        readFileResult({
          path: "index.html",
          content: html,
          mimeType: "text/html",
        }),
      );

      const response = await request;
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toBe(
        "text/html; charset=utf-8",
      );
      const body = await response.text();
      expect(body).toContain("data-bb-app-client");
      expect(body).toContain("window.bb");
      expect(body).toContain('"capabilities":["data","message"]');
      expect(body).toContain("<body>Status</body>");
    } finally {
      await harness.cleanup();
    }
  });

  it("proxies app data list, read, write, and delete through generic daemon file commands", async () => {
    const harness = await createTestAppHarness();
    try {
      const fixture = seedManagerThreadStorage(harness);
      const stateJson = `${JSON.stringify({ workers: [] }, null, 2)}\n`;

      const listRequest = harness.app.request(
        `/api/v1/threads/${fixture.threadId}/apps/status/data`,
      );
      const listManifest = await reportManifestRead({
        harness,
        fixture,
        appId: "status",
        manifest: STATUS_MANIFEST,
      });
      const listCommand = await waitForQueuedCommandAfter(
        harness,
        listManifest.row.cursor,
        ({ command }) =>
          command.type === "host.list_paths" &&
          command.path === appDataRoot(fixture, "status"),
      );
      await reportQueuedCommandSuccess(harness, listCommand, {
        paths: [pathEntry({ kind: "file", path: "state.json" })],
        truncated: false,
      });
      const listRead = await waitForQueuedCommandAfter(
        harness,
        listCommand.row.cursor,
        ({ command }) =>
          command.type === "host.read_file_relative" &&
          command.rootPath === appDataRoot(fixture, "status") &&
          command.path === "state.json",
      );
      await reportQueuedCommandSuccess(
        harness,
        listRead,
        readFileResult({
          path: "state.json",
          content: stateJson,
          mimeType: "application/json",
        }),
      );
      const listMetadata = await waitForQueuedCommandAfter(
        harness,
        listCommand.row.cursor,
        ({ command }) =>
          command.type === "host.file_metadata" &&
          command.path === `${appDataRoot(fixture, "status")}/state.json`,
      );
      await reportQueuedCommandSuccess(harness, listMetadata, {
        path: `${appDataRoot(fixture, "status")}/state.json`,
        modifiedAtMs: 1234,
        sizeBytes: Buffer.byteLength(stateJson),
      });
      const listResponse = await listRequest;
      expect(listResponse.status).toBe(200);
      expect(appDataListResponseSchema.parse(await readJson(listResponse))).toEqual({
        entries: [
          {
            path: "state.json",
            value: { workers: [] },
            version: sha256Text(stateJson),
            sizeBytes: Buffer.byteLength(stateJson),
            modifiedAtMs: 1234,
          },
        ],
      });

      const readRequest = harness.app.request(
        `/api/v1/threads/${fixture.threadId}/apps/status/data/state.json`,
      );
      const readManifest = await reportManifestRead({
        harness,
        fixture,
        appId: "status",
        afterCursor: listMetadata.row.cursor,
        manifest: STATUS_MANIFEST,
      });
      const readCommand = await waitForQueuedCommandAfter(
        harness,
        readManifest.row.cursor,
        ({ command }) =>
          command.type === "host.read_file_relative" &&
          command.rootPath === appDataRoot(fixture, "status") &&
          command.path === "state.json",
      );
      await reportQueuedCommandSuccess(
        harness,
        readCommand,
        readFileResult({
          path: "state.json",
          content: stateJson,
          mimeType: "application/json",
        }),
      );
      const readMetadata = await waitForQueuedCommandAfter(
        harness,
        readManifest.row.cursor,
        ({ command }) =>
          command.type === "host.file_metadata" &&
          command.path === `${appDataRoot(fixture, "status")}/state.json`,
      );
      await reportQueuedCommandSuccess(harness, readMetadata, {
        path: `${appDataRoot(fixture, "status")}/state.json`,
        modifiedAtMs: 2345,
        sizeBytes: Buffer.byteLength(stateJson),
      });
      const readResponse = await readRequest;
      expect(readResponse.status).toBe(200);
      expect(appDataReadResponseSchema.parse(await readJson(readResponse))).toEqual(
        {
          path: "state.json",
          value: { workers: [] },
          version: sha256Text(stateJson),
          sizeBytes: Buffer.byteLength(stateJson),
          modifiedAtMs: 2345,
        },
      );

      const nextValue = { workers: [{ id: "worker-1" }] };
      const nextJson = `${JSON.stringify(nextValue, null, 2)}\n`;
      const writeRequest = harness.app.request(
        `/api/v1/threads/${fixture.threadId}/apps/status/data/state.json`,
        {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ value: nextValue }),
        },
      );
      const writeManifest = await reportManifestRead({
        harness,
        fixture,
        appId: "status",
        afterCursor: readMetadata.row.cursor,
        manifest: STATUS_MANIFEST,
      });
      const writeCommand = await waitForQueuedCommandAfter(
        harness,
        writeManifest.row.cursor,
        ({ command }) =>
          command.type === "host.write_file_relative" &&
          command.rootPath === appDataRoot(fixture, "status") &&
          command.path === "state.json",
      );
      expect(writeCommand.command).toMatchObject({
        dotfiles: "deny",
        content: nextJson,
        contentEncoding: "utf8",
      });
      await reportQueuedCommandSuccess(harness, writeCommand, {
        path: "state.json",
        hash: sha256Text(nextJson),
        modifiedAtMs: 3456,
        sizeBytes: Buffer.byteLength(nextJson),
      });
      const writeResponse = await writeRequest;
      expect(writeResponse.status).toBe(200);
      expect(appDataReadResponseSchema.parse(await readJson(writeResponse))).toEqual(
        {
          path: "state.json",
          value: nextValue,
          version: sha256Text(nextJson),
          sizeBytes: Buffer.byteLength(nextJson),
          modifiedAtMs: 3456,
        },
      );

      const deleteRequest = harness.app.request(
        `/api/v1/threads/${fixture.threadId}/apps/status/data/state.json`,
        { method: "DELETE" },
      );
      const deleteManifest = await reportManifestRead({
        harness,
        fixture,
        appId: "status",
        afterCursor: writeCommand.row.cursor,
        manifest: STATUS_MANIFEST,
      });
      const deleteCommand = await waitForQueuedCommandAfter(
        harness,
        deleteManifest.row.cursor,
        ({ command }) =>
          command.type === "host.delete_file_relative" &&
          command.rootPath === appDataRoot(fixture, "status") &&
          command.path === "state.json",
      );
      await reportQueuedCommandSuccess(harness, deleteCommand, {
        path: "state.json",
        deleted: true,
        previousHash: sha256Text(nextJson),
      });
      const deleteResponse = await deleteRequest;
      expect(deleteResponse.status).toBe(200);
      await expect(readJson(deleteResponse)).resolves.toEqual({ ok: true });
    } finally {
      await harness.cleanup();
    }
  });

  it("lists app data subtree prefixes when the prefix is a directory", async () => {
    const harness = await createTestAppHarness();
    try {
      const fixture = seedManagerThreadStorage(harness);
      const oneJson = `${JSON.stringify({ title: "One" }, null, 2)}\n`;
      const twoJson = `${JSON.stringify({ title: "Two" }, null, 2)}\n`;

      const request = harness.app.request(
        `/api/v1/threads/${fixture.threadId}/apps/status/data?prefix=tasks`,
      );
      const manifestCommand = await reportManifestRead({
        harness,
        fixture,
        appId: "status",
        manifest: STATUS_MANIFEST,
      });
      const prefixRead = await waitForQueuedCommandAfter(
        harness,
        manifestCommand.row.cursor,
        ({ command }) =>
          command.type === "host.read_file_relative" &&
          command.rootPath === appDataRoot(fixture, "status") &&
          command.path === "tasks",
      );
      await reportQueuedCommandError(harness, prefixRead, {
        errorCode: "invalid_path",
        errorMessage: "Path is a directory, not a file",
      });
      const listCommand = await waitForQueuedCommandAfter(
        harness,
        prefixRead.row.cursor,
        ({ command }) =>
          command.type === "host.list_paths" &&
          command.path === `${appDataRoot(fixture, "status")}/tasks`,
      );
      await reportQueuedCommandSuccess(harness, listCommand, {
        paths: [
          pathEntry({ kind: "file", path: "one.json" }),
          pathEntry({ kind: "file", path: "nested/two.json" }),
        ],
        truncated: false,
      });

      const oneRead = await waitForQueuedCommandAfter(
        harness,
        listCommand.row.cursor,
        ({ command }) =>
          command.type === "host.read_file_relative" &&
          command.rootPath === appDataRoot(fixture, "status") &&
          command.path === "tasks/one.json",
      );
      await reportQueuedCommandSuccess(
        harness,
        oneRead,
        readFileResult({
          path: "tasks/one.json",
          content: oneJson,
          mimeType: "application/json",
        }),
      );
      const twoRead = await waitForQueuedCommandAfter(
        harness,
        listCommand.row.cursor,
        ({ command }) =>
          command.type === "host.read_file_relative" &&
          command.rootPath === appDataRoot(fixture, "status") &&
          command.path === "tasks/nested/two.json",
      );
      await reportQueuedCommandSuccess(
        harness,
        twoRead,
        readFileResult({
          path: "tasks/nested/two.json",
          content: twoJson,
          mimeType: "application/json",
        }),
      );
      const oneMetadata = await waitForQueuedCommandAfter(
        harness,
        oneRead.row.cursor,
        ({ command }) =>
          command.type === "host.file_metadata" &&
          command.path === `${appDataRoot(fixture, "status")}/tasks/one.json`,
      );
      await reportQueuedCommandSuccess(harness, oneMetadata, {
        path: `${appDataRoot(fixture, "status")}/tasks/one.json`,
        modifiedAtMs: 1111,
        sizeBytes: Buffer.byteLength(oneJson),
      });
      const twoMetadata = await waitForQueuedCommandAfter(
        harness,
        twoRead.row.cursor,
        ({ command }) =>
          command.type === "host.file_metadata" &&
          command.path ===
            `${appDataRoot(fixture, "status")}/tasks/nested/two.json`,
      );
      await reportQueuedCommandSuccess(harness, twoMetadata, {
        path: `${appDataRoot(fixture, "status")}/tasks/nested/two.json`,
        modifiedAtMs: 2222,
        sizeBytes: Buffer.byteLength(twoJson),
      });

      const response = await request;
      expect(response.status).toBe(200);
      expect(appDataListResponseSchema.parse(await readJson(response))).toEqual({
        entries: [
          {
            path: "tasks/nested/two.json",
            value: { title: "Two" },
            version: sha256Text(twoJson),
            sizeBytes: Buffer.byteLength(twoJson),
            modifiedAtMs: 2222,
          },
          {
            path: "tasks/one.json",
            value: { title: "One" },
            version: sha256Text(oneJson),
            sizeBytes: Buffer.byteLength(oneJson),
            modifiedAtMs: 1111,
          },
        ],
      });
    } finally {
      await harness.cleanup();
    }
  });

  it("serves top-level logo icons and 404s built-in icons", async () => {
    const harness = await createTestAppHarness();
    try {
      const fixture = seedManagerThreadStorage(harness);
      const logoManifest: AppManifest = {
        manifestVersion: 1,
        id: "demo",
        name: "Demo",
        entry: "index.html",
        contributions: ["thread.app"],
        capabilities: ["data", "message"],
      };
      const logoSvg = '<svg xmlns="http://www.w3.org/2000/svg"></svg>';
      const request = harness.app.request(
        `/api/v1/threads/${fixture.threadId}/apps/demo/icon`,
      );
      const manifestCommand = await reportManifestRead({
        harness,
        fixture,
        appId: "demo",
        manifest: logoManifest,
      });
      const logoListCommand = await waitForQueuedCommandAfter(
        harness,
        manifestCommand.row.cursor,
        ({ command }) =>
          command.type === "host.list_paths" &&
          command.path === appRoot(fixture, "demo"),
      );
      await reportQueuedCommandSuccess(harness, logoListCommand, {
        paths: [pathEntry({ kind: "file", path: "logo.svg" })],
        truncated: false,
      });
      const metadataCommand = await waitForQueuedCommandAfter(
        harness,
        logoListCommand.row.cursor,
        ({ command }) =>
          command.type === "host.file_metadata" &&
          command.path === `${appRoot(fixture, "demo")}/logo.svg`,
      );
      await reportQueuedCommandSuccess(harness, metadataCommand, {
        path: `${appRoot(fixture, "demo")}/logo.svg`,
        modifiedAtMs: 4567,
        sizeBytes: Buffer.byteLength(logoSvg),
      });
      const readCommand = await waitForQueuedCommandAfter(
        harness,
        metadataCommand.row.cursor,
        ({ command }) =>
          command.type === "host.read_file_relative" &&
          command.rootPath === appRoot(fixture, "demo") &&
          command.path === "logo.svg",
      );
      await reportQueuedCommandSuccess(
        harness,
        readCommand,
        readFileResult({
          path: "logo.svg",
          content: logoSvg,
          mimeType: "image/svg+xml",
        }),
      );
      const response = await request;
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toBe("image/svg+xml");
      await expect(response.text()).resolves.toBe(logoSvg);

      const builtInRequest = harness.app.request(
        `/api/v1/threads/${fixture.threadId}/apps/status/icon`,
      );
      await reportManifestRead({
        harness,
        fixture,
        appId: "status",
        afterCursor: readCommand.row.cursor,
        manifest: STATUS_MANIFEST,
      });
      const builtInResponse = await builtInRequest;
      expect(builtInResponse.status).toBe(404);
    } finally {
      await harness.cleanup();
    }
  });

  it("does not serve logo symlinks omitted by the daemon path listing", async () => {
    const harness = await createTestAppHarness();
    try {
      const fixture = seedManagerThreadStorage(harness);
      const logoManifest: AppManifest = {
        manifestVersion: 1,
        id: "demo",
        name: "Demo",
        entry: "index.html",
        contributions: ["thread.app"],
        capabilities: ["data", "message"],
      };
      const request = harness.app.request(
        `/api/v1/threads/${fixture.threadId}/apps/demo/icon`,
      );
      const manifestCommand = await reportManifestRead({
        harness,
        fixture,
        appId: "demo",
        manifest: logoManifest,
      });
      const logoListCommand = await waitForQueuedCommandAfter(
        harness,
        manifestCommand.row.cursor,
        ({ command }) =>
          command.type === "host.list_paths" &&
          command.path === appRoot(fixture, "demo"),
      );
      await reportQueuedCommandSuccess(harness, logoListCommand, {
        paths: [pathEntry({ kind: "file", path: "manifest.json" })],
        truncated: false,
      });

      const response = await request;
      expect(response.status).toBe(404);
    } finally {
      await harness.cleanup();
    }
  });

  it("scaffolds status-template apps through the server lifecycle route", async () => {
    const harness = await createTestAppHarness();
    try {
      const fixture = seedManagerThreadStorage(harness);
      const request = harness.app.request(
        `/api/v1/threads/${fixture.threadId}/apps`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            id: "demo",
            name: "Demo",
            template: "status",
          }),
        },
      );
      const existingCommand = await waitForQueuedCommand(
        harness,
        ({ command }) =>
          command.type === "host.read_file_relative" &&
          command.rootPath === appRoot(fixture, "demo") &&
          command.path === "manifest.json",
      );
      await reportQueuedCommandError(harness, existingCommand, {
        errorCode: "ENOENT",
        errorMessage: "Path does not exist: manifest.json",
      });

      const manifestWrite = await waitForQueuedCommandAfter(
        harness,
        existingCommand.row.cursor,
        ({ command }) =>
          command.type === "host.write_file_relative" &&
          command.rootPath === appRoot(fixture, "demo") &&
          command.path === "manifest.json",
      );
      expect(manifestWrite.command).toMatchObject({
        dotfiles: "deny",
        contentEncoding: "utf8",
      });
      const manifestWriteCommand =
        requireWriteFileRelativeCommand(manifestWrite);
      await reportQueuedCommandSuccess(harness, manifestWrite, {
        path: "manifest.json",
        hash: sha256Text(manifestWriteCommand.command.content),
        modifiedAtMs: 1000,
        sizeBytes: Buffer.byteLength(manifestWriteCommand.command.content),
      });

      const htmlWrite = await waitForQueuedCommandAfter(
        harness,
        manifestWrite.row.cursor,
        ({ command }) =>
          command.type === "host.write_file_relative" &&
          command.rootPath === appRoot(fixture, "demo") &&
          command.path === "assets/index.html",
      );
      const htmlWriteCommand = requireWriteFileRelativeCommand(htmlWrite);
      await reportQueuedCommandSuccess(harness, htmlWrite, {
        path: "assets/index.html",
        hash: sha256Text(htmlWriteCommand.command.content),
        modifiedAtMs: 1001,
        sizeBytes: Buffer.byteLength(htmlWriteCommand.command.content),
      });

      const stateWrite = await waitForQueuedCommandAfter(
        harness,
        htmlWrite.row.cursor,
        ({ command }) =>
          command.type === "host.write_file_relative" &&
          command.rootPath === appRoot(fixture, "demo") &&
          command.path === "data/state.json",
      );
      const stateWriteCommand = requireWriteFileRelativeCommand(stateWrite);
      await reportQueuedCommandSuccess(harness, stateWrite, {
        path: "data/state.json",
        hash: sha256Text(stateWriteCommand.command.content),
        modifiedAtMs: 1002,
        sizeBytes: Buffer.byteLength(stateWriteCommand.command.content),
      });

      await reportManifestRead({
        harness,
        fixture,
        appId: "demo",
        afterCursor: stateWrite.row.cursor,
        manifest: {
          manifestVersion: 1,
          id: "demo",
          name: "Demo",
          icon: "ListTodo",
          entry: "index.html",
          contributions: ["thread.app"],
          capabilities: ["data", "message"],
        },
      });

      const response = await request;
      expect(response.status).toBe(201);
      expect(appDetailSchema.parse(await readJson(response))).toMatchObject({
        id: "demo",
        name: "Demo",
        entry: { kind: "html", path: "index.html" },
        icon: { kind: "builtin", name: "ListTodo" },
        capabilities: ["data", "message"],
      });
    } finally {
      await harness.cleanup();
    }
  });
});

import { Buffer } from "node:buffer";
import { describe, expect, it } from "vitest";
import { registerHostRpcResponder } from "../helpers/host-rpc.js";
import { readJson } from "../helpers/json.js";
import {
  seedEnvironment,
  seedHostSession,
  seedProjectWithSource,
  seedThread,
} from "../helpers/seed.js";
import { withTestHarness } from "../helpers/test-app.js";

function rawFileUrl(threadId: string, filePath: string): string {
  return `/api/v1/threads/${threadId}/files/raw?path=${encodeURIComponent(filePath)}`;
}

describe("public file routes", () => {
  it("serves arbitrary absolute HTML files as sandboxed raw preview content", async () => {
    await withTestHarness(async (harness) => {
      seedHostSession(harness.deps, { id: "default-host" });
      const { host: threadHost } = seedHostSession(harness.deps, {
        id: "thread-host",
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: threadHost.id,
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: threadHost.id,
        projectId: project.id,
      });
      const thread = seedThread(harness.deps, {
        environmentId: environment.id,
        projectId: project.id,
      });
      const filePath = "/Users/me/Downloads/report.html";
      const html = "<!doctype html><h1>Report</h1>";
      const rpc = registerHostRpcResponder(harness, {
        handle: (request) => {
          expect(request.command).toEqual({
            type: "host.read_file",
            path: filePath,
          });
          return {
            ok: true,
            result: {
              path: filePath,
              content: html,
              contentEncoding: "utf8",
              mimeType: "text/html",
              sizeBytes: Buffer.byteLength(html),
            },
          };
        },
      });

      const fileResponse = await harness.app.request(
        rawFileUrl(thread.id, filePath),
      );
      expect(fileResponse.status).toBe(200);
      expect(rpc.requests).toHaveLength(1);
      expect(fileResponse.headers.get("content-type")).toBe(
        "text/html; charset=utf-8",
      );
      expect(fileResponse.headers.get("content-security-policy")).toBe(
        "sandbox allow-scripts",
      );
      expect(fileResponse.headers.get("cache-control")).toBe("no-store");
      expect(fileResponse.headers.get("x-content-type-options")).toBe(
        "nosniff",
      );
      expect(await fileResponse.text()).toBe(html);
    });
  });

  it("rejects non-HTML arbitrary raw file preview paths before queueing a read", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps);
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
      });
      const thread = seedThread(harness.deps, {
        environmentId: environment.id,
        projectId: project.id,
      });

      const fileResponse = await harness.app.request(
        rawFileUrl(thread.id, "/Users/me/Downloads/report.txt"),
      );

      expect(fileResponse.status).toBe(415);
      await expect(readJson(fileResponse)).resolves.toEqual({
        code: "unsupported_media_type",
        message: "HTML preview only supports text/html files",
        retryable: false,
      });
      expect(harness.engineRouting.dispatched).toEqual([]);
    });
  });

  it("caps arbitrary raw HTML preview responses at 5 MB", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps);
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
      });
      const thread = seedThread(harness.deps, {
        environmentId: environment.id,
        projectId: project.id,
      });
      const filePath = "/Users/me/Downloads/large.html";
      registerHostRpcResponder(harness, {
        handle: (request) => {
          expect(request.command).toEqual({
            type: "host.read_file",
            path: filePath,
          });
          return {
            ok: true,
            result: {
              path: filePath,
              content: "",
              contentEncoding: "utf8",
              mimeType: "text/html",
              sizeBytes: 5 * 1024 * 1024 + 1,
            },
          };
        },
      });

      const fileResponse = await harness.app.request(
        rawFileUrl(thread.id, filePath),
      );
      expect(fileResponse.status).toBe(413);
      await expect(readJson(fileResponse)).resolves.toEqual({
        code: "file_too_large",
        message: "HTML preview exceeds the 5 MB limit",
        retryable: false,
      });
    });
  });
});

/**
 * Contract tripwire — single-host rebuild plan §6 Phase 0 / §4.3, §4.1 (R1, R6).
 *
 * Pins the local API surface (the :38887 daemon port in production) the frozen
 * frontend consumes WITHOUT zod-parsing `/status` — a wrong field name, value,
 * or content-type fails silently there (features vanish, no error). Values are
 * pinned, not just shapes, and content-type is asserted to trip the
 * SPA-catch-all 200+HTML failure mode after the local API merges into the
 * server. All requests resolve the base URL through
 * `harness.localApiBaseUrl()` — the single retarget point for Phase 1.
 */
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  providerCliInstallEventSchema,
  statusResponseSchema,
} from "@bb/host-daemon-contract";
import { describe, expect, it } from "vitest";
import { createHostThread, createProject, getHosts } from "../../helpers/api.js";
import { withHarness } from "../../helpers/harness.js";

describe("contract: local API /status", () => {
  // The hostId round-trip is three-way (plan §4.1/R6): REST host ids =
  // local-API /status hostId = the hostId clients submit back when creating
  // threads. A fresh harness guarantees the daemon is connected.
  it("serves JSON with connected=true and the hostId REST emits and accepts", async () => {
    await withHarness(async (harness) => {
      const response = await fetch(`${harness.localApiBaseUrl()}/status`);

      expect(response.status).toBe(200);
      // The frozen FE treats any non-JSON or failed response as "no daemon"
      // and silently disables folder picker / open-in-editor / CLI installs.
      expect(response.headers.get("content-type")).toContain(
        "application/json",
      );
      const status = statusResponseSchema.parse(await response.json());

      // Leg 1+2: /status values match the REST hosts surface.
      const hosts = await getHosts(harness.api);
      expect(hosts).toHaveLength(1);
      expect(status.hostId).toBe(hosts[0]?.id);
      expect(status.connected).toBe(true);
      // §4.3: serverUrl is the server's own origin.
      expect(status.serverUrl).toBe(harness.serverUrl);

      // Leg 3: the /status hostId is accepted back by thread creation (the
      // environment-picker submit path). createProject/createHostThread throw
      // unless the server answers 201.
      const project = await createProject(harness.api, {
        name: "contract-status-roundtrip",
        source: {
          type: "local_path",
          hostId: status.hostId,
          path: harness.repoDir,
        },
      });
      const thread = await createHostThread(harness.api, {
        hostId: status.hostId,
        projectId: project.id,
        workspace: { path: harness.repoDir, type: "unmanaged" },
      });
      expect(thread.id).toBeTruthy();
    });
  });
});

describe("contract: local API /provider-clis/install", () => {
  it("rejects invalid install requests with 400", async () => {
    await withHarness(async (harness) => {
      const url = `${harness.localApiBaseUrl()}/provider-clis/install`;

      const missingField = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ provider: "codex" }),
      });
      expect(missingField.status).toBe(400);

      const unknownProvider = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ provider: "not-a-cli", actionKind: "install" }),
      });
      expect(unknownProvider.status).toBe(400);
    });
  });

  // The install route has no injection seam — a valid request really spawns
  // `npm install -g @openai/codex@latest` through a pty shell that resolves
  // `npm` via PATH from process.env. The daemon runs in-process here, so a
  // stub `npm` prepended to PATH lets the test exercise the REAL route,
  // stream, and framing end to end without touching the network. vitest runs
  // each test file in its own process, so the PATH mutation is contained.
  it("streams ndjson events the frontend can strictly parse line by line", async () => {
    const stubDir = await mkdtemp(path.join(tmpdir(), "bb-npm-stub-"));
    const stubNpmPath = path.join(stubDir, "npm");
    await writeFile(stubNpmPath, '#!/bin/sh\necho "stub npm: $*"\nexit 0\n');
    await chmod(stubNpmPath, 0o755);
    const originalPath = process.env.PATH;

    try {
      await withHarness(async (harness) => {
        process.env.PATH = `${stubDir}${path.delimiter}${originalPath ?? ""}`;
        const response = await fetch(
          `${harness.localApiBaseUrl()}/provider-clis/install`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ provider: "codex", actionKind: "install" }),
          },
        );

        expect(response.status).toBe(200);
        // The frozen FE switches on this content-type to stream-read the
        // body; application/json (or HTML from a catch-all) breaks installs.
        expect(response.headers.get("content-type")).toContain(
          "application/x-ndjson",
        );

        const body = await response.text();
        // ndjson framing: every event is one JSON document terminated by \n.
        expect(body.endsWith("\n")).toBe(true);
        const lines = body.split("\n").filter((line) => line.length > 0);
        expect(lines.length).toBeGreaterThanOrEqual(2);
        // The FE zod-parses each line strictly (plan §4.3); every line must
        // satisfy providerCliInstallEventSchema on its own.
        const events = lines.map((line) =>
          providerCliInstallEventSchema.parse(JSON.parse(line)),
        );

        expect(events[0]).toEqual({
          type: "started",
          provider: "codex",
          command: "npm install -g @openai/codex@latest",
        });
        const lastEvent = events[events.length - 1];
        expect(lastEvent).toEqual({
          type: "completed",
          provider: "codex",
          exitCode: 0,
          signal: null,
          success: true,
        });
      });
    } finally {
      if (originalPath === undefined) {
        delete process.env.PATH;
      } else {
        process.env.PATH = originalPath;
      }
      await rm(stubDir, { force: true, recursive: true });
    }
  });
});

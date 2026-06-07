/**
 * Contract tripwire — single-host rebuild plan §6 Phase 0 / §4.1 Decision 4.
 *
 * Pins the full hostSchema shape (packages/domain/src/host.ts) on GET /hosts,
 * GET /hosts/:id, and the `?include=host` thread expansion. The frozen
 * frontend reads `host.lastSeenAt` (AppSettingsView) and spreads whole Host
 * objects (effective-hosts.ts), so every field must survive the single-host
 * merge — the 4-field shorthand is not enough. hostSchema is not `.strict()`,
 * so shape drift is pinned two ways: the schema's own key inventory against a
 * literal list, and strict parses of the raw wire objects (extra OR missing
 * fields both fail).
 */
import { hostSchema } from "@bb/domain";
import { threadWithIncludesResponseSchema } from "@bb/server-contract";
import { describe, expect, it } from "vitest";
import {
  createProjectFixture,
  createReadyHostThread,
} from "../../helpers/fixtures.js";
import { withHarness } from "../../helpers/harness.js";

const strictHostSchema = hostSchema.strict();

// The `?include=host` expansion must embed the host as a present, full,
// exactly-hostSchema-shaped object — not the optional/nullable envelope the
// response schema tolerates for other requests.
const threadWithStrictHostSchema = threadWithIncludesResponseSchema.extend({
  host: strictHostSchema,
});

describe("contract: hosts", () => {
  it("hostSchema declares exactly the frozen fields", () => {
    // Frozen field inventory of packages/domain/src/host.ts. A rename,
    // removal, or addition changes what the frozen frontend receives — update
    // this list only with a deliberate contract decision.
    expect(Object.keys(hostSchema.shape).sort()).toEqual([
      "createdAt",
      "id",
      "lastSeenAt",
      "name",
      "status",
      "type",
      "updatedAt",
    ]);
  });

  it("GET /hosts and GET /hosts/:id return the full hostSchema shape", async () => {
    await withHarness(async (harness) => {
      const listResponse = await harness.api.hosts.$get({});
      expect(listResponse.status).toBe(200);
      const hosts = strictHostSchema.array().parse(await listResponse.json());

      expect(hosts).toHaveLength(1);
      const host = hosts[0];
      if (!host) {
        throw new Error("GET /hosts returned no hosts");
      }
      expect(host.id).toBe(harness.hostId);
      // The harness awaits host connection, so a fresh harness must report
      // the same connected status the frontend keys host availability on.
      expect(host.status).toBe("connected");

      const getResponse = await harness.api.hosts[":id"].$get({
        param: { id: harness.hostId },
      });
      expect(getResponse.status).toBe(200);
      const singleHost = strictHostSchema.parse(await getResponse.json());
      expect(singleHost.id).toBe(harness.hostId);
    });
  });

  it("GET /threads/:id?include=host embeds the full hostSchema object", async () => {
    await withHarness(async (harness) => {
      const project = await createProjectFixture(harness, {
        name: "contract-include-host",
      });
      const { thread } = await createReadyHostThread(harness, {
        projectId: project.id,
        workspace: { path: harness.repoDir, type: "unmanaged" },
      });

      const response = await harness.api.threads[":id"].$get({
        param: { id: thread.id },
        query: { include: "host" },
      });
      expect(response.status).toBe(200);
      const parsed = threadWithStrictHostSchema.parse(await response.json());
      expect(parsed.host.id).toBe(harness.hostId);
    });
  });
});

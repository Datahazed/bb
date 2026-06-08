/**
 * Single-host `/api/v1/hosts` surface (plan §4.1, Decision 4): the read
 * routes answer with the synthetic `'local'` host and the four host-mutation
 * routes stay typed in `PublicApiSchema` but are stubbed at runtime.
 * Full-shape/value pinning lives in the Phase 0 contract tests
 * (`tests/integration/fake/contract/hosts.test.ts`); this suite covers the
 * route-level behavior the contract tests don't: unknown-id 404s and the
 * stub error statuses.
 */
import os from "node:os";
import { apiErrorSchema } from "@bb/server-contract";
import { describe, expect, it } from "vitest";
import { LOCAL_HOST_ID } from "../../src/services/hosts/local-host.js";
import { readJson } from "../helpers/json.js";
import { withTestHarness } from "../helpers/test-app.js";

describe("single-host hosts routes", () => {
  it("lists exactly the synthetic local host", async () => {
    await withTestHarness(async (harness) => {
      const response = await harness.app.request("/api/v1/hosts");

      expect(response.status).toBe(200);
      const hosts = await readJson(response);
      expect(hosts).toEqual([
        {
          id: LOCAL_HOST_ID,
          name: os.hostname(),
          type: "persistent",
          status: "connected",
          lastSeenAt: expect.any(Number),
          createdAt: expect.any(Number),
          updatedAt: expect.any(Number),
        },
      ]);
    });
  });

  it("returns the local host by id and 404s for any other id", async () => {
    await withTestHarness(async (harness) => {
      const localResponse = await harness.app.request(
        `/api/v1/hosts/${LOCAL_HOST_ID}`,
      );
      expect(localResponse.status).toBe(200);
      expect(await readJson(localResponse)).toMatchObject({
        id: LOCAL_HOST_ID,
        status: "connected",
      });

      const missingResponse = await harness.app.request(
        "/api/v1/hosts/host_does_not_exist",
      );
      expect(missingResponse.status).toBe(404);
      expect(apiErrorSchema.parse(await readJson(missingResponse))).toMatchObject(
        { code: "host_not_found" },
      );
    });
  });

  it("rejects host joins with 410", async () => {
    await withTestHarness(async (harness) => {
      const joinResponse = await harness.app.request("/api/v1/hosts/join", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ hostType: "persistent" }),
      });
      expect(joinResponse.status).toBe(410);
      expect(apiErrorSchema.parse(await readJson(joinResponse))).toMatchObject({
        code: "unsupported_operation",
      });

      const cancelResponse = await harness.app.request(
        `/api/v1/hosts/${LOCAL_HOST_ID}/join`,
        { method: "DELETE" },
      );
      expect(cancelResponse.status).toBe(410);
      expect(apiErrorSchema.parse(await readJson(cancelResponse))).toMatchObject(
        { code: "unsupported_operation" },
      );
    });
  });

  it("rejects renaming or deleting the local host with 422", async () => {
    await withTestHarness(async (harness) => {
      const renameResponse = await harness.app.request(
        `/api/v1/hosts/${LOCAL_HOST_ID}`,
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ name: "renamed" }),
        },
      );
      expect(renameResponse.status).toBe(422);
      expect(apiErrorSchema.parse(await readJson(renameResponse))).toMatchObject(
        { code: "unsupported_operation" },
      );

      const deleteResponse = await harness.app.request(
        `/api/v1/hosts/${LOCAL_HOST_ID}`,
        { method: "DELETE" },
      );
      expect(deleteResponse.status).toBe(422);
      expect(apiErrorSchema.parse(await readJson(deleteResponse))).toMatchObject(
        { code: "unsupported_operation" },
      );
    });
  });

  it("404s mutations addressed to a non-local host id", async () => {
    await withTestHarness(async (harness) => {
      const renameResponse = await harness.app.request(
        "/api/v1/hosts/host_does_not_exist",
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ name: "renamed" }),
        },
      );
      expect(renameResponse.status).toBe(404);

      const deleteResponse = await harness.app.request(
        "/api/v1/hosts/host_does_not_exist",
        { method: "DELETE" },
      );
      expect(deleteResponse.status).toBe(404);
    });
  });
});

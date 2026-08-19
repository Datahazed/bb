import { sidebarBootstrapResponseSchema } from "@bb/server-contract";
import { describe, expect, it } from "vitest";
import {
  ifNoneMatchMatches,
  weakEtagForBody,
} from "../../src/services/lib/weak-etag.js";
import { readJson } from "../helpers/json.js";
import {
  seedHostSession,
  seedProjectWithSource,
  seedThread,
} from "../helpers/seed.js";
import { withTestHarness } from "../helpers/test-app.js";

describe("GET /sidebar-bootstrap conditional requests", () => {
  it("returns a weak validator and answers a matching If-None-Match with a bodyless 304", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps);
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
      });
      const thread = seedThread(harness.deps, { projectId: project.id });

      const first = await harness.app.request("/api/v1/sidebar-bootstrap");
      expect(first.status).toBe(200);
      const etag = first.headers.get("etag");
      expect(etag).toMatch(/^W\/"[A-Za-z0-9_-]+"$/);
      expect(first.headers.get("cache-control")).toBe("private, no-cache");
      expect(first.headers.get("content-type")).toContain("application/json");
      const bootstrap = sidebarBootstrapResponseSchema.parse(
        await readJson(first),
      );
      expect(
        bootstrap.projects.flatMap((entry) => entry.threads.map((t) => t.id)),
      ).toContain(thread.id);

      const revalidated = await harness.app.request(
        "/api/v1/sidebar-bootstrap",
        { headers: { "if-none-match": etag ?? "" } },
      );
      expect(revalidated.status).toBe(304);
      expect(revalidated.headers.get("etag")).toBe(etag);
      expect(await revalidated.text()).toBe("");

      // Any change to the rows rotates the validator and serves a body again.
      seedThread(harness.deps, { projectId: project.id, title: "Second" });
      const changed = await harness.app.request("/api/v1/sidebar-bootstrap", {
        headers: { "if-none-match": etag ?? "" },
      });
      expect(changed.status).toBe(200);
      expect(changed.headers.get("etag")).not.toBe(etag);
      const changedBootstrap = sidebarBootstrapResponseSchema.parse(
        await readJson(changed),
      );
      expect(
        changedBootstrap.projects.flatMap((entry) => entry.threads).length,
      ).toBe(2);
    });
  });

  it("evaluates If-None-Match with weak comparison and list syntax", () => {
    const etag = weakEtagForBody("{}");
    const opaque = etag.slice(2);
    expect(ifNoneMatchMatches(undefined, etag)).toBe(false);
    expect(ifNoneMatchMatches("*", etag)).toBe(true);
    expect(ifNoneMatchMatches(etag, etag)).toBe(true);
    expect(ifNoneMatchMatches(opaque, etag)).toBe(true);
    expect(ifNoneMatchMatches(`"other", ${etag}`, etag)).toBe(true);
    expect(ifNoneMatchMatches('"other"', etag)).toBe(false);
    expect(weakEtagForBody("{}")).toBe(etag);
    expect(weakEtagForBody("[]")).not.toBe(etag);
  });
});

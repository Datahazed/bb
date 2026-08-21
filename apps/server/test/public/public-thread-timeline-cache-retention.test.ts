/**
 * Regression for #2066: the timeline response cache used to key entries by
 * `${maxSeq}|${paramsKey}`, so every appended event stranded the previous
 * revision of the same request shape in the LRU until global eviction. A
 * thread's `maxSeq` is monotonic, so those revisions could never be hit again.
 *
 * Drives the real `GET /api/v1/threads/:id/timeline` route against in-memory
 * SQLite. The only instrumentation is wrapping the cache factory so the test
 * can read `.size` of the instance the route creates.
 */
import { describe, expect, it, vi } from "vitest";
import { threadScope, turnScope } from "@bb/domain";
import { threadTimelineResponseSchema } from "@bb/server-contract";
import { readJson } from "../helpers/json.js";
import { seedEvent, seedThreadFixture } from "../helpers/seed.js";
import { withTestHarness } from "../helpers/test-app.js";
import type { TestAppHarness } from "../helpers/test-app.js";
import type { createThreadTimelineCache as CreateCache } from "../../src/services/threads/timeline-cache.js";

const createdCaches: ReturnType<typeof CreateCache>[] = [];

vi.mock(
  "../../src/services/threads/timeline-cache.js",
  async (importOriginal) => {
    const mod =
      await importOriginal<
        typeof import("../../src/services/threads/timeline-cache.js")
      >();
    return {
      ...mod,
      createThreadTimelineCache: (
        ...args: Parameters<typeof mod.createThreadTimelineCache>
      ) => {
        const cache = mod.createThreadTimelineCache(...args);
        createdCaches.push(cache);
        return cache;
      },
    };
  },
);

async function fetchTimeline(harness: TestAppHarness, threadId: string) {
  const response = await harness.app.request(
    `/api/v1/threads/${threadId}/timeline`,
  );
  expect(response.status).toBe(200);
  return threadTimelineResponseSchema.parse(await readJson(response));
}

describe("GET /threads/:id/timeline response cache retention (#2066)", () => {
  it("keeps one resident revision per request shape as events are appended", async () => {
    await withTestHarness(async (harness) => {
      const cache = createdCaches.at(-1);
      if (!cache) {
        throw new Error("route did not create a timeline cache");
      }
      const { environment, thread } = seedThreadFixture(harness);
      const base = {
        threadId: thread.id,
        environmentId: environment.id,
        providerThreadId: "p1",
      };

      seedEvent(harness.deps, {
        ...base,
        scope: threadScope(),
        sequence: 1,
        type: "system/manager/user_message",
        data: { text: "hello" },
      });
      seedEvent(harness.deps, {
        ...base,
        scope: turnScope("turn-1"),
        sequence: 2,
        type: "turn/started",
        data: {},
      });
      seedEvent(harness.deps, {
        ...base,
        scope: turnScope("turn-1"),
        sequence: 3,
        type: "item/completed",
        data: { item: { type: "agentMessage", id: "a-1", text: "done" } },
      });
      seedEvent(harness.deps, {
        ...base,
        scope: turnScope("turn-1"),
        sequence: 4,
        type: "turn/completed",
        data: { status: "completed" },
      });

      const first = await fetchTimeline(harness, thread.id);
      expect(first.maxSeq).toBe(4);
      expect(cache.size).toBe(1);

      // A second, streaming turn: each appended event bumps maxSeq and the
      // client refetches the same window (same request shape). Enough rounds
      // to exceed the 128-entry LRU bound if superseded revisions were kept.
      seedEvent(harness.deps, {
        ...base,
        scope: turnScope("turn-2"),
        sequence: 5,
        type: "turn/started",
        data: {},
      });
      const rounds = 150;
      for (let i = 0; i < rounds; i++) {
        seedEvent(harness.deps, {
          ...base,
          scope: turnScope("turn-2"),
          sequence: 6 + i,
          type: "item/completed",
          data: {
            item: { type: "agentMessage", id: `a-2-${i}`, text: `chunk ${i}` },
          },
        });
        const page = await fetchTimeline(harness, thread.id);
        expect(page.maxSeq).toBe(6 + i);
        // Every revision must stay under the row cap so each one is cacheable;
        // otherwise the assertion below would pass for the wrong reason.
        expect(page.rows.length).toBeLessThanOrEqual(200);
      }

      // Only the entry built at the newest maxSeq can ever be hit again.
      // Before the fix this was 128 (the LRU bound) of dead revisions.
      expect(cache.size).toBe(1);
    });
  });
});

/**
 * The pagination invariant: walking every timeline summary page of a thread
 * and concatenating the results (oldest → newest) must exactly equal the
 * unpaginated projection, for any segment limit. Limits may only change how
 * many requests a walk takes, never what the combined result is.
 *
 * The reference build uses an effectively unlimited segment limit. Pages are
 * slices of the same canonical projection, so this holds by construction;
 * this gate keeps it that way.
 */
import {
  corpusAvailable,
  listCorpusThreads,
  loadCorpusThread,
} from "@bb/test-helpers";
import type { TimelineRow } from "@bb/server-contract";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ProviderRegistryService } from "../../src/services/providers/provider-registry.js";
import { createTestProviderRegistry } from "../helpers/provider-registry.js";
import {
  buildAllRouteTimelinePages,
  buildRouteTimelinePage,
  buildRouteTimelinePageCooperatively,
  loadCorpusThreadIntoDb,
  normalizeJson,
} from "./corpus-harness.js";

const PER_THREAD_TIMEOUT_MS = 5 * 60_000;
const UNLIMITED_SEGMENT_LIMIT = 1_000_000;

const MATRIX = [
  { segmentLimit: 1 },
  { segmentLimit: 2 },
  { segmentLimit: 3 },
  { segmentLimit: 8 },
  { segmentLimit: 20 },
] as const;

function rowIdCounts(rows: readonly TimelineRow[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const row of rows) {
    counts.set(row.id, (counts.get(row.id) ?? 0) + 1);
  }
  return counts;
}

function describeIdMismatch(
  reference: readonly TimelineRow[],
  combined: readonly TimelineRow[],
): string {
  const referenceCounts = rowIdCounts(reference);
  const combinedCounts = rowIdCounts(combined);
  const missing: string[] = [];
  const extra: string[] = [];
  for (const [id, count] of referenceCounts) {
    const have = combinedCounts.get(id) ?? 0;
    if (have < count) {
      missing.push(`${id} (×${count - have})`);
    }
  }
  for (const [id, count] of combinedCounts) {
    const want = referenceCounts.get(id) ?? 0;
    if (count > want) {
      extra.push(`${id} (×${count - want})`);
    }
  }
  const parts: string[] = [];
  if (missing.length > 0) {
    parts.push(`missing rows: ${missing.slice(0, 8).join(", ")}${missing.length > 8 ? ` … ${missing.length - 8} more` : ""}`);
  }
  if (extra.length > 0) {
    parts.push(`extra/duplicated rows: ${extra.slice(0, 8).join(", ")}${extra.length > 8 ? ` … ${extra.length - 8} more` : ""}`);
  }
  if (parts.length === 0) {
    parts.push(
      "same row ids, but order or row content differs (see JSON equality failure)",
    );
  }
  return parts.join("; ");
}

const available = corpusAvailable();
const corpusThreads = available ? listCorpusThreads() : [];

describe.skipIf(!available)("timeline page recombination", () => {
  let registry: ProviderRegistryService | null = null;
  const totals = {
    threads: 0,
    failedCells: new Map<string, string[]>(),
  };

  beforeAll(async () => {
    registry = await createTestProviderRegistry();
  });

  afterAll(() => {
    const cells = [...totals.failedCells.entries()]
      .map(([cell, threads]) => `  ${cell}: ${threads.length} threads`)
      .join("\n");
    console.info(
      [
        `page recombination: ${totals.threads} threads checked`,
        cells.length > 0 ? `failing cells:\n${cells}` : "all cells green",
      ].join("\n"),
    );
  });

  it.each(corpusThreads.map((thread) => [thread.id, thread.provider] as const))(
    "%s (%s)",
    async (threadId) => {
      if (registry === null) {
        throw new Error("provider registry did not load");
      }
      const corpusThread = loadCorpusThread(threadId);
      const loaded = loadCorpusThreadIntoDb(corpusThread);
      try {
        totals.threads += 1;
        const reference = buildRouteTimelinePage({
          db: loaded.db,
          registry,
          thread: loaded.thread,
          variant: "default",
          page: { kind: "latest", segmentLimit: UNLIMITED_SEGMENT_LIMIT },
        });
        // Every thread must have an unpaginated reference: nothing may cap
        // the canonical projection.
        expect(reference.response.timelinePage.hasOlderRows).toBe(false);
        const referenceRows = normalizeJson(reference.response.rows);

        // The cooperative (yielding) build must produce the same rows as the
        // synchronous one; it only differs in scheduling.
        const cooperative = await buildRouteTimelinePageCooperatively({
          db: loaded.db,
          registry,
          thread: loaded.thread,
          variant: "default",
          page: { kind: "latest", segmentLimit: UNLIMITED_SEGMENT_LIMIT },
        });
        expect(
          JSON.stringify(normalizeJson(cooperative.response.rows)),
          "cooperative build differs from synchronous build",
        ).toBe(JSON.stringify(referenceRows));

        const failures: string[] = [];
        for (const cell of MATRIX) {
          const cellKey = `segmentLimit=${cell.segmentLimit}`;
          const pages = buildAllRouteTimelinePages({
            db: loaded.db,
            registry,
            thread: loaded.thread,
            variant: "default",
            segmentLimit: cell.segmentLimit,
          });
          const combined = [...pages]
            .reverse()
            .flatMap((page) => page.response.rows);
          const combinedRows = normalizeJson(combined);
          if (JSON.stringify(combinedRows) !== JSON.stringify(referenceRows)) {
            const cellThreads = totals.failedCells.get(cellKey) ?? [];
            cellThreads.push(threadId);
            totals.failedCells.set(cellKey, cellThreads);
            failures.push(
              `${cellKey} (${pages.length} pages): ${describeIdMismatch(
                reference.response.rows,
                combined,
              )}`,
            );
          }
        }
        expect(
          failures,
          `pages do not recombine to the unpaginated projection:\n${failures.join("\n")}`,
        ).toEqual([]);
      } finally {
        loaded.close();
      }
    },
    PER_THREAD_TIMEOUT_MS,
  );
});

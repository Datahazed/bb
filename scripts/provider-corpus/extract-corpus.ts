#!/usr/bin/env -S pnpm exec tsx
/**
 * Extracts a provider corpus (manifest.json, profile.json,
 * threads/<provider>/<threadId>/{meta.json,events.ndjson}) from a bb.db
 * copy, in the format `@bb/test-helpers` reads. Point it at a *copy* of a
 * production database, never the live `~/.bb/bb.db`.
 *
 * Every extracted thread is validated through the real corpus reader
 * (`loadCorpusThread`), which decodes each event with
 * `parseStoredThreadEvent`. Threads that fail validation are removed from
 * the manifest and reported, so the emitted corpus always loads cleanly.
 *
 *   pnpm exec tsx scripts/provider-corpus/extract-corpus.ts \
 *     --db ~/.bb-dev/prod-copy/bb.db --out ~/.bb-dev/provider-corpus
 */
import fs from "node:fs";
import path from "node:path";
import { createConnection } from "../../packages/db/src/index.js";
import {
  PROVIDER_CORPUS_DIR_ENV,
  listCorpusThreads,
  loadCorpusThread,
} from "../../packages/test-helpers/src/provider-corpus.js";

interface CliArgs {
  db: string;
  out: string;
}

function parseArgs(argv: readonly string[]): CliArgs {
  let db: string | undefined;
  let out: string | undefined;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--db") {
      db = argv[++index];
    } else if (arg === "--out") {
      out = argv[++index];
    } else {
      throw new Error(`Unknown argument ${arg}`);
    }
  }
  if (db === undefined || out === undefined) {
    throw new Error(
      "usage: extract-corpus.ts --db <bb.db copy> --out <corpus dir>",
    );
  }
  return { db: path.resolve(db), out: path.resolve(out) };
}

interface ThreadRow {
  id: string;
  provider_id: string;
  title: string | null;
  status: string;
  created_at: number;
  updated_at: number;
  archived_at: number | null;
  deleted_at: number | null;
  parent_thread_id: string | null;
  origin_kind: string | null;
  visibility: string;
  model_override: string | null;
  reasoning_level_override: string | null;
}

interface EventRow {
  id: string;
  thread_id: string;
  scope_kind: string;
  turn_id: string | null;
  provider_thread_id: string | null;
  sequence: number;
  type: string;
  item_id: string | null;
  item_kind: string | null;
  data: string;
  created_at: number;
  parent_tool_call_id: string | null;
}

const args = parseArgs(process.argv.slice(2));
if (args.db === path.join(process.env.HOME ?? "", ".bb", "bb.db")) {
  throw new Error("Refusing to read the live ~/.bb/bb.db; extract from a copy");
}

if (!fs.existsSync(args.db)) {
  throw new Error(`Database not found: ${args.db}`);
}
const db = createConnection(args.db).$client;
db.pragma("query_only = ON");

const threadRows = db
  .prepare(
    `SELECT id, provider_id, title, status, created_at, updated_at,
            archived_at, deleted_at, parent_thread_id, origin_kind,
            visibility, model_override, reasoning_level_override
       FROM threads
      WHERE deleted_at IS NULL
      ORDER BY provider_id, id`,
  )
  .all() as ThreadRow[];

const selectEvents = db.prepare(
  `SELECT id, thread_id, scope_kind, turn_id, provider_thread_id, sequence,
          type, item_id, item_kind, data, created_at, parent_tool_call_id
     FROM events
    WHERE thread_id = ?
    ORDER BY sequence`,
);

// Preserve snapshots/ (row + perf baselines) across re-extractions.
fs.rmSync(path.join(args.out, "threads"), { recursive: true, force: true });
fs.rmSync(path.join(args.out, "manifest.json"), { force: true });
fs.rmSync(path.join(args.out, "profile.json"), { force: true });
fs.mkdirSync(path.join(args.out, "threads"), { recursive: true });

// The perf gate (timeline-perf.test.ts) measures threads tagged "largest":
// the 10 highest-event threads per provider, matching the original corpus.
const LARGEST_PER_PROVIDER = 10;
const eventCounts = new Map<string, number>(
  (
    db
      .prepare(
        `SELECT thread_id, COUNT(*) AS events FROM events GROUP BY thread_id`,
      )
      .all() as { thread_id: string; events: number }[]
  ).map((row) => [row.thread_id, row.events]),
);
const largestThreadIds = new Set<string>();
{
  const byProvider = new Map<string, ThreadRow[]>();
  for (const thread of threadRows) {
    const list = byProvider.get(thread.provider_id) ?? [];
    list.push(thread);
    byProvider.set(thread.provider_id, list);
  }
  for (const providerThreads of byProvider.values()) {
    const ranked = [...providerThreads].sort(
      (left, right) =>
        (eventCounts.get(right.id) ?? 0) - (eventCounts.get(left.id) ?? 0),
    );
    for (const thread of ranked.slice(0, LARGEST_PER_PROVIDER)) {
      largestThreadIds.add(thread.id);
    }
  }
}

interface ManifestThread {
  id: string;
  provider: string;
  events: number;
  reasons: string[];
}

const manifestThreads: ManifestThread[] = [];
let totalEvents = 0;
for (const thread of threadRows) {
  const events = selectEvents.all(thread.id) as EventRow[];
  const threadDir = path.join(args.out, "threads", thread.provider_id, thread.id);
  fs.mkdirSync(threadDir, { recursive: true });
  const dataBytes = events.reduce(
    (sum, event) => sum + Buffer.byteLength(event.data),
    0,
  );
  const reasons = largestThreadIds.has(thread.id)
    ? ["full-export", "largest"]
    : ["full-export"];
  const ndjson = events
    .map((event) =>
      JSON.stringify({
        id: event.id,
        thread_id: event.thread_id,
        environment_id: null,
        scope_kind: event.scope_kind,
        turn_id: event.turn_id,
        provider_thread_id: event.provider_thread_id,
        sequence: event.sequence,
        type: event.type,
        item_id: event.item_id,
        item_kind: event.item_kind,
        data: event.data,
        created_at: event.created_at,
        parent_tool_call_id: event.parent_tool_call_id,
      }),
    )
    .join("\n");
  fs.writeFileSync(
    path.join(threadDir, "events.ndjson"),
    ndjson.length === 0 ? "" : `${ndjson}\n`,
  );
  fs.writeFileSync(
    path.join(threadDir, "meta.json"),
    `${JSON.stringify(
      {
        thread: {
          id: thread.id,
          provider_id: thread.provider_id,
          title: thread.title,
          status: thread.status,
          created_at: thread.created_at,
          updated_at: thread.updated_at,
          archived_at: thread.archived_at,
          deleted_at: thread.deleted_at,
          parent_thread_id: thread.parent_thread_id,
          origin_kind: thread.origin_kind,
          visibility: thread.visibility,
          model_override: thread.model_override,
          reasoning_level_override: thread.reasoning_level_override,
        },
        features: { event_rows: events.length, data_bytes: dataBytes },
        reasons,
        event_rows: events.length,
      },
      null,
      2,
    )}\n`,
  );
  manifestThreads.push({
    id: thread.id,
    provider: thread.provider_id,
    events: events.length,
    reasons,
  });
  totalEvents += events.length;
}
db.close();

function writeManifest(threads: readonly ManifestThread[]): void {
  fs.writeFileSync(
    path.join(args.out, "manifest.json"),
    `${JSON.stringify(
      {
        providers: [...new Set(threads.map((thread) => thread.provider))],
        threads,
      },
      null,
      2,
    )}\n`,
  );
}

writeManifest(manifestThreads);
fs.writeFileSync(
  path.join(args.out, "profile.json"),
  `${JSON.stringify(
    {
      source: path.basename(args.db),
      extracted_at: new Date().toISOString(),
      threads: manifestThreads.length,
      events: totalEvents,
    },
    null,
    2,
  )}\n`,
);

console.log(
  `Extracted ${manifestThreads.length} threads / ${totalEvents} events; validating…`,
);

process.env[PROVIDER_CORPUS_DIR_ENV] = args.out;
const invalid: { id: string; provider: string; error: string }[] = [];
for (const entry of listCorpusThreads()) {
  try {
    loadCorpusThread(entry.id);
  } catch (error) {
    invalid.push({
      id: entry.id,
      provider: entry.provider,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

if (invalid.length > 0) {
  const kept = manifestThreads.filter(
    (thread) => !invalid.some((entry) => entry.id === thread.id),
  );
  writeManifest(kept);
  for (const entry of invalid) {
    fs.rmSync(path.join(args.out, "threads", entry.provider, entry.id), {
      recursive: true,
      force: true,
    });
    console.warn(`dropped ${entry.id} (${entry.provider}): ${entry.error}`);
  }
  console.log(
    `Corpus ready: ${kept.length} threads (${invalid.length} dropped as unreadable)`,
  );
} else {
  console.log(`Corpus ready: ${manifestThreads.length} threads, all readable`);
}

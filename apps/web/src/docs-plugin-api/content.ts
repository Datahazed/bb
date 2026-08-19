/**
 * Curated structure for the plugin API docs: task-oriented sections, intros,
 * and examples layered over the generated model (api-model.generated.ts).
 *
 * Rules enforced by docs-content.test.ts:
 * - every symbol reference here exists in the generated model (no invented
 *   or renamed APIs), and
 * - every export of every SDK entry point is covered by exactly one section
 *   (name-level: a type re-exported by several entry points is documented
 *   once and linked from each module index).
 */
import { PLUGIN_API_MODEL } from "./api-model.generated";
import type { ApiModuleId } from "./model";

export interface DocsExample {
  title: string;
  lang: "ts" | "tsx" | "sh" | "json";
  code: string;
}

export interface DocsSymbolRef {
  module: ApiModuleId;
  name: string;
}

export interface DocsSymbolGroup {
  title?: string;
  blurb?: string;
  symbols: DocsSymbolRef[];
}

export interface DocsSection {
  id: string;
  title: string;
  /** Sidebar group; groups render in DOCS_GROUPS order. */
  group: string;
  /** One-liner for cards, search results, and meta descriptions. */
  summary: string;
  /** Intro paragraphs. Supports `code` spans and [text](href) links. */
  intro: string[];
  examples?: DocsExample[];
  symbolGroups: DocsSymbolGroup[];
}

export const DOCS_GROUPS = [
  "Getting started",
  "Backend · server.ts",
  "Frontend · app.tsx",
  "Host workers",
  "Provider bridges",
  "Testing",
] as const;

const root = (name: string): DocsSymbolRef => ({ module: "root", name });
const app = (name: string): DocsSymbolRef => ({ module: "app", name });
const host = (name: string): DocsSymbolRef => ({ module: "host", name });
const pb = (name: string): DocsSymbolRef => ({
  module: "provider-bridge",
  name,
});
const testing = (name: string): DocsSymbolRef => ({ module: "testing", name });
const testingApp = (name: string): DocsSymbolRef => ({
  module: "testing-app",
  name,
});
const testingHost = (name: string): DocsSymbolRef => ({
  module: "testing-host",
  name,
});

// ---------------------------------------------------------------------------
// Provider-bridge curated groups. Everything not named here lands in the
// generated "Bridge kit and event vocabulary" group below, so new SDK exports
// never fall out of the docs.
// ---------------------------------------------------------------------------

const PB_ENTRY_CONTRACT = [
  "experimental_defineProviderBridge",
  "PROVIDER_BRIDGE_EXPORT_NAME",
  "ProviderBridgeContext",
  "ProviderBridgeDefinition",
  "ProviderBridgeEntry",
];

const PB_PROTOCOL = [
  "PROVIDER_BRIDGE_PROTOCOL_VERSION",
  "BRIDGE_REQUEST_METHODS",
  "BRIDGE_NOTIFICATION_METHODS",
  "BRIDGE_INBOUND_REQUEST_METHODS",
  "BRIDGE_JSON_RPC_ERRORS",
  "initializeParamsSchema",
  "InitializeResult",
  "BridgeExecutionOptions",
  "modelListParamsSchema",
  "threadStartParamsSchema",
  "threadResumeParamsSchema",
  "threadForkParamsSchema",
  "threadStopParamsSchema",
  "threadDiscardParamsSchema",
  "threadArchiveParamsSchema",
  "threadUnarchiveParamsSchema",
  "threadGoalClearParamsSchema",
  "threadNameSetParamsSchema",
  "turnStartParamsSchema",
  "turnSteerParamsSchema",
  "skillsConfigureParamsSchema",
  "threadEventNotificationSchema",
];

const PB_LAUNCH_ENV = [
  "sanitizeInheritedChildProcessEnv",
  "hostDaemonAcpLaunchSpecSchema",
  "HostDaemonAcpLaunchSpec",
  "normalizeHostDaemonAcpLaunchSpec",
];

const PB_CURATED = new Set([
  ...PB_ENTRY_CONTRACT,
  ...PB_PROTOCOL,
  ...PB_LAUNCH_ENV,
  // Re-exported by this subpath but documented on its home page (rpc); the
  // uniqueness test rejects any name assigned to two sections.
  "JsonValue",
]);

const pbModule = PLUGIN_API_MODEL.modules.find(
  (module) => module.id === "provider-bridge",
);
const PB_REST: DocsSymbolRef[] = (pbModule?.exports ?? [])
  .filter((symbol) => !PB_CURATED.has(symbol.name))
  .map((symbol) => pb(symbol.name));

// ---------------------------------------------------------------------------
// Sections.
// ---------------------------------------------------------------------------

export const DOCS_SECTIONS: DocsSection[] = [
  {
    id: "anatomy",
    title: "Plugin anatomy",
    group: "Getting started",
    summary:
      "What a bb plugin is: the manifest, the three entry points, and the build and install loop.",
    intro: [
      "A bb plugin is a TypeScript package running in-process inside the bb server. Its backend entry default-exports a factory that receives the full plugin API (`bb`); an optional frontend entry registers React UI inside the bb app; an optional host entry is bundled and runs as a supervised Node worker on targeted enrolled hosts. Plugins are full-trust code in every runtime.",
      "The manifest is `package.json`. `bb.server` (required) is the backend entry. `bb.app` (optional) is the frontend entry compiled by `bb plugin build` into `dist/app.js`; React and the SDK are never bundled, the build shims them to the host's shared runtime. `bb.host` (optional, singular) is a full-trust Node 22 ESM entry bundled into `dist/host.js`. `bb.skills` directories are auto-imported into agent threads as the plugin skills tier.",
      "Backend API imports normally stay type-only; the root runtime exports are `defineRpcContract` and the numeric `PLUGIN_CLI_OUTPUT_MAX_BYTES` ceiling. Validator imports such as Zod are normal plugin runtime dependencies and are bundled by `bb plugin build`.",
      "The authoritative surface is the bundled declarations shipped with `@get-bb/plugin-sdk` (`bundled-types/bb-plugin-sdk.d.ts` and siblings), the same files these pages are generated from. `bb plugin types` syncs a plugin's SDK surface to the running bb.",
    ],
    examples: [
      {
        title: "Quickstart",
        lang: "sh",
        code: `bb plugin new hello            # scaffolds ./bb-plugin-hello (add --app for a frontend entry)
cd bb-plugin-hello
bb plugin install .            # registers the directory in place (--yes to skip the prompt)
bb plugin dev                  # rebuild app/host bundles + reload on every save`,
      },
      {
        title: "The manifest (package.json)",
        lang: "json",
        code: `{
  "name": "bb-plugin-hello",
  "version": "0.1.0",
  "type": "module",
  "engines": { "bb": ">=0.9", "bbPluginSdk": ">=0.4.3" },
  "bb": {
    "name": "Hello",
    "description": "A friendly example plugin.",
    "branding": { "icon": "Zap" },
    "server": "./server.ts",
    "app": "./app.tsx",
    "host": "./host.ts",
    "skills": ["skills"]
  }
}`,
      },
      {
        title: "A minimal backend entry (server.ts)",
        lang: "ts",
        code: `import type { BbPluginApi } from "@get-bb/plugin-sdk";

export default function plugin(bb: BbPluginApi) {
  bb.log.info("hello from " + bb.pluginId);
}`,
      },
    ],
    symbolGroups: [],
  },

  // -------------------------------------------------------------------------
  // Backend.
  // -------------------------------------------------------------------------
  {
    id: "plugin-factory",
    title: "The plugin factory",
    group: "Backend · server.ts",
    summary:
      "BbPluginApi: the `bb` object handed to server.ts, plus logging, status, and disposal.",
    intro: [
      "The backend entry default-exports a factory: `export default function plugin(bb: BbPluginApi)`. Every backend capability hangs off that one `bb` object: settings, storage, wire surfaces, background work, agent surfaces, and the full bb SDK.",
      "Registrations are replaced wholesale on plugin reload. Register cleanup with `bb.onDispose` (hooks run LIFO); it is the sanctioned place to clear timers and close connections.",
      'To pause a plugin that is missing configuration instead of failing it, call `bb.status.needsConfiguration(message)`, or throw an error whose `name` is `NeedsConfigurationError`: `throw Object.assign(new Error(msg), { name: "NeedsConfigurationError" })`. Runtime classes stay host-side, so no runtime import is needed.',
      "`bb.sdk` is the full bb SDK bound to this server over loopback. It is bind-gated: reading it before the server is listening throws, so prefer using it from handlers, services, and timers. `threads.spawn` automatically attributes spawned threads to this plugin.",
    ],
    examples: [
      {
        title: "Factory shape, disposal, and needs-configuration",
        lang: "ts",
        code: `import type { BbPluginApi } from "@get-bb/plugin-sdk";

export default async function plugin(bb: BbPluginApi) {
  const settings = bb.settings.define({
    apiKey: { type: "string", label: "API key", secret: true },
  });

  const { apiKey } = await settings.get();
  if (!apiKey) {
    bb.status.needsConfiguration("Set an API key, then run bb plugin reload " + bb.pluginId);
    return;
  }

  const timer = setInterval(() => bb.log.debug("tick"), 60_000);
  bb.onDispose(() => clearInterval(timer));
}`,
      },
    ],
    symbolGroups: [
      {
        symbols: [
          root("BbPluginApi"),
          root("PluginLogger"),
          root("PluginStatusApi"),
          root("PluginServerApi"),
        ],
      },
    ],
  },
  {
    id: "settings",
    title: "Settings",
    group: "Backend · server.ts",
    summary:
      "Declarative settings the host renders in the UI and the CLI parses, including secrets.",
    intro: [
      "`bb.settings.define(descriptors)` declares plain-data settings descriptors (deliberately not zod) so the host can render settings forms and the CLI can parse values without executing plugin code. It returns a typed handle: `get()` is load-safe inside the factory, and `onChange(listener)` fires after values change through the settings route or CLI.",
      "A descriptor with `default` produces a non-optional value; without one the value is `T | undefined`. `secret: true` strings are stored in a 0600 file under the plugin's data directory, never in the database or sent to the frontend.",
      "Settings edits never auto-reload the plugin; ask the user to run `bb plugin reload <id>` after configuring.",
    ],
    examples: [
      {
        title: "Define, read, and react to settings",
        lang: "ts",
        code: `const settings = bb.settings.define({
  greeting: { type: "string", label: "Greeting", default: "hello" },
  enabled: { type: "boolean", label: "Enabled", default: true },
  mode: { type: "select", label: "Mode", options: ["fast", "thorough"], default: "fast" },
  apiKey: { type: "string", label: "API key", secret: true },
});

const values = await settings.get(); // { greeting: string; enabled: boolean; ... }
settings.onChange((next, prev) => {
  if (next.mode !== prev.mode) bb.log.info("mode changed to " + next.mode);
});`,
      },
    ],
    symbolGroups: [
      {
        symbols: [
          root("PluginSettings"),
          root("PluginSettingsHandle"),
          root("PluginSettingDescriptor"),
          root("PluginSettingDescriptors"),
          root("PluginSettingValue"),
          root("PluginSettingsValues"),
        ],
      },
    ],
  },
  {
    id: "storage",
    title: "Storage",
    group: "Backend · server.ts",
    summary:
      "Namespaced key-value rows in bb.db plus the plugin's own SQLite database with migrations.",
    intro: [
      "`bb.storage.kv` is namespaced JSON key-value storage in bb's own database; values are capped at 256KB each. `bb.storage.database()` opens the plugin's own SQLite database (better-sqlite3, WAL mode) at `<dataDir>/plugins/<id>/data.db`; handles are host-tracked and closed on dispose/reload, and a closed handle throws on use.",
      "`bb.storage.migrate(db, statements)` is an ordered-statement migration helper: the statement index is the migration id, and unapplied statements run in one transaction. Append-only: never reorder or edit shipped statements.",
    ],
    examples: [
      {
        title: "KV cache plus a migrated table",
        lang: "ts",
        code: `await bb.storage.kv.set("last-sync", { at: Date.now() });
const last = await bb.storage.kv.get<{ at: number }>("last-sync");

const db = bb.storage.database();
bb.storage.migrate(db, [
  "CREATE TABLE notes (id INTEGER PRIMARY KEY, body TEXT NOT NULL)",
  "CREATE INDEX notes_body ON notes (body)",
]);
db.prepare("INSERT INTO notes (body) VALUES (?)").run("hello");`,
      },
    ],
    symbolGroups: [
      { symbols: [root("PluginStorage"), root("PluginKvStorage")] },
    ],
  },
  {
    id: "rpc",
    title: "RPC contracts",
    group: "Backend · server.ts",
    summary:
      "Schema-validated RPC between your frontend and backend, built on Standard Schema.",
    intro: [
      "`bb.rpc.register(contract, handlers)` serves methods at `POST /api/v1/plugins/<id>/rpc/<method>`. The host validates input before invocation and output before strict JSON serialization; failures come back as a structured envelope with a stable `code`.",
      "Contracts are Standard Schema v1; Zod 4 schemas implement the interface directly, and other validators can too without becoming part of bb's public protocol. Define the contract once with `defineRpcContract` in a shared module, and both `bb.rpc.register` (backend) and `useRpc<typeof contract>()` (frontend) infer their types from it.",
    ],
    examples: [
      {
        title: "A shared contract served by the backend",
        lang: "ts",
        code: `// contract.ts, imported by both server.ts and app.tsx
import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";

export const contract = defineRpcContract({
  list: {
    input: z.object({ query: z.string().default("") }),
    output: z.array(z.object({ id: z.string(), title: z.string() })),
  },
});

// server.ts
bb.rpc.register(contract, {
  list: async ({ query }) => searchNotes(query),
});`,
      },
    ],
    symbolGroups: [
      {
        title: "Registering methods",
        symbols: [root("PluginRpc"), root("defineRpcContract")],
      },
      {
        title: "Contract types",
        symbols: [
          root("PluginRpcContract"),
          root("PluginRpcMethodContract"),
          root("PluginRpcHandlers"),
          root("PluginRpcCallArgs"),
          root("PluginRpcResult"),
          root("JsonValue"),
        ],
      },
      {
        title: "Errors",
        symbols: [
          root("PluginRpcError"),
          root("PluginRpcErrorCode"),
          root("PluginRpcValidationIssue"),
          root("PluginRpcIssuePathSegment"),
        ],
      },
      {
        title: "Standard Schema",
        blurb:
          "The validator-neutral subset of Standard Schema v1 used by plugin RPC.",
        symbols: [
          root("StandardSchemaV1"),
          root("StandardSchemaV1Result"),
          root("StandardSchemaV1Issue"),
          root("StandardSchemaV1InferInput"),
          root("StandardSchemaV1InferOutput"),
        ],
      },
    ],
  },
  {
    id: "http-realtime",
    title: "HTTP routes & realtime",
    group: "Backend · server.ts",
    summary:
      "Raw HTTP routes with three auth modes, and ephemeral push to connected frontends.",
    intro: [
      '`bb.http.route(method, path, handler, opts)` mounts a Hono handler at `/api/v1/plugins/<id>/http/<path>`. Auth defaults to `"local"` (requests from local bb app origins); `"token"` requires the per-plugin token from `bb plugin token <id>`; `"none"` is only for signature-verified webhooks.',
      "`bb.realtime.publish(channel, payload)` broadcasts an ephemeral signal to every connected client; nothing is persisted, and there are no per-channel subscriptions in V1. Pair it with `useRealtime(channel, handler)` on the frontend, and reconcile on reconnect with `useRealtimeConnectionState()`.",
    ],
    examples: [
      {
        title: "A webhook route that pushes a realtime signal",
        lang: "ts",
        code: `bb.http.route(
  "POST",
  "webhook",
  async (c) => {
    const body = await c.req.json();
    if (!(await verifySignature(c.req, body))) return new Response(null, { status: 401 });
    bb.realtime.publish("events-changed", { source: "webhook" });
    return Response.json({ ok: true });
  },
  { auth: "none" },
);`,
      },
    ],
    symbolGroups: [
      {
        symbols: [
          root("PluginHttp"),
          root("PluginHttpHandler"),
          root("PluginHttpAuthMode"),
          root("PluginRealtime"),
        ],
      },
    ],
  },
  {
    id: "background",
    title: "Background work",
    group: "Backend · server.ts",
    summary: "Long-lived supervised services and durable cron schedules.",
    intro: [
      "`bb.background.service(name, { start })` registers a long-lived service. `start` runs after the factory completes and should resolve when its `AbortSignal` aborts (dispose, reload, disable, shutdown). A crash restarts it with capped exponential backoff; throwing a `NeedsConfigurationError` marks the plugin needs-configuration and stops restarting until the next load.",
      "`bb.background.schedule(name, cron, fn)` registers a five-field cron schedule in server-local time. The durable row is upserted at load and claimed by a periodic sweep, but only while the plugin is loaded. Failures land in `last_status`/`last_error`, visible in `bb plugin list`.",
    ],
    examples: [
      {
        title: "A polling service and a nightly schedule",
        lang: "ts",
        code: `bb.background.service("poller", {
  async start(signal) {
    while (!signal.aborted) {
      await pollOnce();
      await new Promise((resolve) => setTimeout(resolve, 30_000));
    }
  },
});

bb.background.schedule("cleanup", "0 3 * * *", async () => {
  await deleteExpiredRows(bb.storage.database());
});`,
      },
    ],
    symbolGroups: [{ symbols: [root("PluginBackground")] }],
  },
  {
    id: "cli",
    title: "CLI commands",
    group: "Backend · server.ts",
    summary:
      "A top-level `bb <name>` subcommand both humans and agents can run.",
    intro: [
      "`bb.cli.register(registration)` claims one top-level `bb` command per plugin. Subcommand metadata in `commands` renders in help and the plugin-commands skill without executing plugin code; parsing `argv` is plugin-owned. Core bb commands always win name collisions, and reserved names are rejected at registration.",
      "The invoking CLI forwards context when known: `cwd`, `threadId`, `projectId`, and an `AbortSignal` tied to the HTTP request. Combined stdout and stderr are capped at `PLUGIN_CLI_OUTPUT_MAX_BYTES` (1 MiB).",
    ],
    examples: [
      {
        title: "Registering `bb notes`",
        lang: "ts",
        code: `bb.cli.register({
  name: "notes",
  summary: "Search and show notes",
  commands: [
    { name: "search", summary: "Search notes", usage: "bb notes search <query...>" },
  ],
  async run(argv, ctx) {
    if (argv[0] !== "search") return { exitCode: 2, stderr: "Usage: bb notes search <query...>" };
    const hits = await search(argv.slice(1).join(" "), { signal: ctx.signal });
    return { exitCode: 0, stdout: hits.join("\\n") };
  },
});`,
      },
    ],
    symbolGroups: [
      {
        symbols: [
          root("PluginCli"),
          root("PluginCliRegistration"),
          root("PluginCliCommandInfo"),
          root("PluginCliContext"),
          root("PluginCliResult"),
          root("PluginCliExecutionResult"),
          root("PluginCliOutputLimitError"),
          root("PLUGIN_CLI_OUTPUT_MAX_BYTES"),
        ],
      },
    ],
  },
  {
    id: "agents",
    title: "Agent tools & configuration",
    group: "Backend · server.ts",
    summary:
      "Native tools, per-session tool/skill selection, dynamic instructions, and provider registration.",
    intro: [
      "`bb.agents.registerTool` registers a native dynamic tool. `parameters` is either a zod schema (validated per call; `execute` receives the parsed value) or a plain JSON-schema object (no validation). Tool-set changes apply on the next session start, never mid-session.",
      "`bb.agents.configure(provider)` selects this plugin's registered tools and manifest skills per thread/session resolution, with optional dynamic instructions. The callback is synchronous, runs at thread start and turn submit, and fails closed for this plugin only on any malformed result.",
      "`bb.agents.contributeInstructions(provider)` appends a dynamic section to thread instructions (truncated at 4096 characters); a live provider session keeps the instructions it was constructed with.",
      "`bb.agents.experimental_registerProvider(declaration)` contributes an agent provider to bb's registry. The declaration is metadata only; the implementation is the plugin's own provider bridge, named by `bb.providerBridge` in the manifest (see [Provider bridges](/docs/plugin-api/provider-bridge)).",
    ],
    examples: [
      {
        title: "A zod-validated native tool, selected per session",
        lang: "ts",
        code: `import { z } from "zod";

bb.agents.registerTool({
  name: "docs_search",
  description: "Search the bundled docs and return matching lines.",
  parameters: z.object({ query: z.string().min(1) }),
  async execute({ query }, ctx) {
    const hits = await search(query, { signal: ctx.signal });
    return hits.length > 0 ? hits.join("\\n") : "No matches.";
  },
});

bb.agents.configure((context) => ({
  tools: context.project.kind === "standard" ? ["docs_search"] : [],
  skills: ["repo-conventions"],
}));`,
      },
    ],
    symbolGroups: [
      {
        title: "The agents API",
        symbols: [root("PluginAgents")],
      },
      {
        title: "Native tools",
        symbols: [
          root("PluginAgentToolRegistrationBase"),
          root("PluginAgentToolContext"),
          root("PluginAgentToolResult"),
          root("PluginAgentToolContentPart"),
          root("PluginAgentToolExperimentalStatusLabels"),
        ],
      },
      {
        title: "Per-session configuration",
        symbols: [
          root("PluginAgentConfigurationContext"),
          root("PluginAgentConfiguration"),
          root("PluginAgentToolSelection"),
        ],
      },
      {
        title: "Provider declarations",
        symbols: [
          root("PluginProviderDeclaration"),
          root("PluginProviderCapabilities"),
          root("PluginProviderPermissionMode"),
          root("PluginProviderReasoningLevel"),
          root("PluginProviderComposerAction"),
        ],
      },
    ],
  },
  {
    id: "interactions-mentions",
    title: "Interactions & mentions",
    group: "Backend · server.ts",
    summary:
      "Block on user input with plugin-owned forms, and answer composer @-mention searches.",
    intro: [
      "`bb.ui.requestInput(request)` blocks until the app submits or cancels a plugin-owned composer form. The form itself is a `pendingInteraction` slot component registered by the plugin's frontend entry under the matching `rendererId` (see [Slots](/docs/plugin-api/slots)). Timeouts default to ten minutes, capped at one hour.",
      "`bb.ui.registerMentionProvider(provider)` answers composer mention searches. Providers default to the `@` trigger and may opt into `#`, `$`, `!`, or `~`. `search` runs server-side as the user types (time-boxed at 2s, failure-isolated); `resolve` runs once per picked item at send time, and the returned context is attached to the message as agent-visible, user-hidden prompt input.",
    ],
    examples: [
      {
        title: "A mention provider over plugin data",
        lang: "ts",
        code: `bb.ui.registerMentionProvider({
  id: "notes",
  label: "Notes",
  async search({ query }) {
    const rows = await searchNotes(query);
    return rows.map((row) => ({ id: row.id, title: row.title }));
  },
  async resolve(itemId) {
    const note = await loadNote(itemId);
    return { context: "Note \\"" + note.title + "\\":\\n" + note.body };
  },
});`,
      },
    ],
    symbolGroups: [
      {
        title: "The UI API",
        symbols: [root("PluginUi")],
      },
      {
        title: "Blocking interactions",
        symbols: [
          root("PluginInteractionRequest"),
          root("PluginInteractionResult"),
          root("PluginInteractionCancelReason"),
        ],
      },
      {
        title: "Mention providers",
        symbols: [
          root("PluginMentionProviderRegistration"),
          root("PluginMentionSearchContext"),
          root("PluginMentionItem"),
          root("PluginMentionTrigger"),
        ],
      },
    ],
  },
  {
    id: "thread-events",
    title: "Thread lifecycle events",
    group: "Backend · server.ts",
    summary:
      "Observe thread creation, activity, idling, failure, archiving, and deletion.",
    intro: [
      "`bb.events.on(event, handler)` adds observe-only listeners for thread lifecycle transitions. Handlers run fire-and-forget after the transition is applied and can never block or veto it. Multiple listeners for the same event are additive and run independently in registration order.",
      "The `thread` payload is the same public DTO `GET /threads/:id` serves; `thread.idle` also carries the last assistant text, and `thread.failed` the latest error message when one exists.",
    ],
    examples: [
      {
        title: "React when a thread finishes a turn",
        lang: "ts",
        code: `bb.events.on("thread.idle", async ({ thread, lastAssistantText }) => {
  if (!lastAssistantText) return;
  await bb.storage.kv.set("last-idle:" + thread.id, {
    title: thread.title,
    preview: lastAssistantText.slice(0, 200),
  });
});`,
      },
    ],
    symbolGroups: [
      {
        symbols: [
          root("PluginEvents"),
          root("PluginThreadEventName"),
          root("PluginThreadEventPayloads"),
          root("PluginThreadEventHandler"),
        ],
      },
    ],
  },
  {
    id: "hosts-control",
    title: "Host control plane",
    group: "Backend · server.ts",
    summary:
      "Call your plugin's host worker from the server, and declare shared tunnel ports.",
    intro: [
      "`bb.hosts.experimental_client({ contract })` creates the owning plugin's typed client for its singular `bb.host` entry, the server side of the host-worker pairing (see [Host entries](/docs/plugin-api/host-entry) for the worker side). Calls target an explicit enrolled host id; the client can also observe unexpected worker exits and typed, ephemeral host signals.",
      "`bb.hosts.ensureSharedPortTunnel(hostId)` ensures the enrolled host has a gate label and returns its read-only public identity; `bb.hosts.declareSharedPorts(hostId, ports)` replaces this plugin's desired shared-loopback ports for one host. Tunnel identity is deliberately owned by the daemon's trusted enrollment, never by plugins.",
      "This whole surface is experimental; see `docs/api_to_audit.md` in the bb repository for the audit it owes before stabilizing.",
    ],
    examples: [
      {
        title: "Calling the host entry from server.ts",
        lang: "ts",
        code: `import { contract } from "./host-contract.js"; // a shared defineRpcContract module

const client = bb.hosts.experimental_client({ contract });

bb.rpc.register(rpcContract, {
  status: async ({ hostId }) => client.call("status", null, { hostId }),
});`,
      },
    ],
    symbolGroups: [
      {
        symbols: [
          root("PluginHosts"),
          root("PluginSharedPortTunnelIdentity"),
          root("ExperimentalHostClient"),
          root("ExperimentalHostCallOptions"),
          root("ExperimentalHostSignalContract"),
          root("ExperimentalHostSignals"),
          root("ExperimentalHostSignalEvent"),
        ],
      },
    ],
  },

  // -------------------------------------------------------------------------
  // Frontend.
  // -------------------------------------------------------------------------
  {
    id: "app-entry",
    title: "The app entry",
    group: "Frontend · app.tsx",
    summary:
      "definePluginApp: how a plugin's frontend registers UI inside the bb app.",
    intro: [
      "The frontend entry (`app.tsx`) default-exports `definePluginApp((app) => { ... })`. The host re-runs `setup` against a fresh collector on every (re)interpretation, replacing that plugin's registrations wholesale. The builder has three surfaces: `app.slots.*` for host-placed UI regions, `app.composer.customize` for composer extensions, and `app.contentScripts.register` for trusted page scripts.",
      "This module's runtime is never bundled into plugins: `bb plugin build` swaps the `@get-bb/plugin-sdk/app` specifier for a shim reading the host's shared runtime. The SDK ships no UI kit; components are vendored shadcn-style source from the bb registry (`npx shadcn add @bb/<name>`), and `toast` comes from `sonner`, runtime-shimmed to the host toaster.",
    ],
    examples: [
      {
        title: "A minimal app entry",
        lang: "tsx",
        code: `import { definePluginApp } from "@get-bb/plugin-sdk/app";
import { NotesPanel } from "./notes-panel";
import "./app.css";

export default definePluginApp((app) => {
  app.slots.navPanel({
    id: "notes",
    title: "Notes",
    icon: "FileText",
    path: "notes",
    component: NotesPanel,
  });
});`,
      },
    ],
    symbolGroups: [
      {
        symbols: [
          app("definePluginApp"),
          root("PluginAppBuilder"),
          root("PluginAppSetup"),
          root("PluginAppDefinition"),
          root("PluginSdkApp"),
        ],
      },
    ],
  },
  {
    id: "slots",
    title: "Slots",
    group: "Frontend · app.tsx",
    summary:
      "Host-placed UI regions: nav panels, thread panels, settings sections, file openers, message actions, and more.",
    intro: [
      "Each `app.slots.*` method registers a component (or host-rendered behavior) for one region of the bb app. Per-slot props are versioned contracts, additive-only within an SDK major. Ids must be unique within the plugin (letters, digits, `-`, `_`).",
      "Slot components use the ordinary SDK hooks for data: `useRpc` to call the plugin backend, `useRealtime` for invalidations, `useBbNavigate` to move around the app (see [Hooks](/docs/plugin-api/hooks)).",
      "Sidebar thread-list replacement has its own page: [Sidebar & thread list](/docs/plugin-api/sidebar).",
    ],
    examples: [
      {
        title: "A nav panel with fixed side tabs",
        lang: "tsx",
        code: `app.slots.navPanel({
  id: "tasks",
  title: "Tasks",
  icon: "ListTodo",
  path: "tasks",
  component: TasksAppShell,
  experimental_fixedTabs: [
    {
      id: "navigation",
      title: "Navigation",
      icon: "ListView",
      component: TasksNavigationPanel,
      layout: "flush",
    },
  ],
});`,
      },
      {
        title: "A thread panel action",
        lang: "tsx",
        code: `app.slots.threadPanelAction({
  id: "review",
  title: "Review notes",
  icon: "FileText",
  component: ReviewPanel, // receives { threadId, params }
  run({ threadId, openPanel }) {
    openPanel({ title: "Review", params: { threadId } });
  },
});`,
      },
    ],
    symbolGroups: [
      {
        title: "The slots registry",
        symbols: [root("PluginAppSlots")],
      },
      {
        title: "Navigation & home",
        symbols: [
          root("PluginNavPanelRegistration"),
          root("PluginNavPanelProps"),
          root("PluginHomepageSectionRegistration"),
          root("PluginHomepageSectionProps"),
          root("PluginSidebarFooterActionRegistration"),
          root("PluginSidebarFooterActionContext"),
          root("PluginSidebarFooterActionProps"),
        ],
      },
      {
        title: "Thread panels",
        symbols: [
          root("PluginThreadPanelActionRegistration"),
          root("PluginThreadPanelActionContext"),
          root("PluginThreadPanelProps"),
          root("PluginNewThreadPanelActionRegistration"),
          root("PluginNewThreadPanelActionContext"),
          root("PluginNewThreadPanelProps"),
          root("PluginThreadHeaderActionRegistration"),
          root("PluginThreadHeaderActionProps"),
        ],
      },
      {
        title: "Settings & interactions",
        symbols: [
          root("PluginSettingsSectionRegistration"),
          root("PluginSettingsSectionProps"),
          root("PluginPendingInteractionRegistration"),
          root("PluginPendingInteractionProps"),
          root("PluginPendingInteractionView"),
        ],
      },
      {
        title: "Files & messages",
        symbols: [
          root("PluginFileOpenerRegistration"),
          root("PluginFileOpenerProps"),
          root("PluginFileOpenerSource"),
          root("PluginMessageDirectiveRegistration"),
          root("PluginMessageDirectiveProps"),
          root("PluginMessageDirectiveMessage"),
          root("PluginMessageDirectiveOpenWorkspaceFile"),
          root("PluginMessageActionRegistration"),
          root("PluginMessageActionContext"),
          root("PluginMessageActionThreadPanelOptions"),
          root("ThreadChatMessageReference"),
        ],
      },
      {
        title: "Provider icons",
        symbols: [root("PluginProviderIconRegistration")],
      },
    ],
  },
  {
    id: "sidebar",
    title: "Sidebar & thread list",
    group: "Frontend · app.tsx",
    summary:
      "Replace the sidebar's thread list wholesale, backed by live thread data hooks.",
    intro: [
      "`app.slots.experimental_threadList` replaces the sidebar's scrolling thread area. Unlike every other slot it is exclusive: two lists cannot share one scroll area. The New-thread button, search field, plugin nav rows, and footer stay host-rendered in every sidebar, and an absent or crashing replacement falls back to bb's list.",
      "The data comes from the experimental sidebar hooks: `experimental_useSidebarThreads()` reads the host's own cache and realtime subscriptions (no extra requests), `experimental_useSidebarThreadActions()` routes mutations through the host's flows, and per-row hooks add pull-request state and drag-to-split support.",
      "This whole surface is experimental; see `docs/api_to_audit.md` in the bb repository.",
    ],
    examples: [
      {
        title: "A minimal replacement list",
        lang: "tsx",
        code: `import {
  definePluginApp,
  experimental_useSidebarThreads,
  experimental_useSidebarThreadActions,
} from "@get-bb/plugin-sdk/app";

function FlatList({ onNavigate, searchQuery }: PluginThreadListProps) {
  const { status, threads } = experimental_useSidebarThreads();
  const actions = experimental_useSidebarThreadActions();
  if (status !== "ready") return null;
  return (
    <ul>
      {threads
        .filter((t) => (t.title ?? t.titleFallback ?? "").includes(searchQuery))
        .map((t) => (
          <li key={t.id}>
            <button onClick={() => { actions.open(t.id); onNavigate(); }}>
              {t.title ?? t.titleFallback ?? "Untitled"}
            </button>
          </li>
        ))}
    </ul>
  );
}`,
      },
    ],
    symbolGroups: [
      {
        title: "The slot",
        symbols: [
          root("PluginThreadListRegistration"),
          root("PluginThreadListProps"),
        ],
      },
      {
        title: "Live thread data",
        symbols: [
          app("experimental_useSidebarThreads"),
          root("PluginSidebarThreadsState"),
          root("PluginSidebarThread"),
          root("PluginSidebarProject"),
          root("PluginSidebarThreadActivity"),
          root("PluginSidebarThreadIndicator"),
          root("PluginSidebarWorkspaceKind"),
        ],
      },
      {
        title: "Actions & per-row state",
        symbols: [
          app("experimental_useSidebarThreadActions"),
          root("PluginSidebarThreadActions"),
          app("experimental_useSidebarThreadPullRequest"),
          root("PluginSidebarThreadPullRequestState"),
          root("PluginSidebarPullRequest"),
          app("experimental_useSidebarThreadSplit"),
          root("PluginSidebarThreadSplit"),
          root("PluginSidebarSplitPane"),
        ],
      },
    ],
  },
  {
    id: "composer",
    title: "Composer customization",
    group: "Frontend · app.tsx",
    summary:
      "Actions, banners, plus-menu rows, rich-text effects, and programmatic draft access.",
    intro: [
      "`app.composer.customize(registration)` contributes composer UI: React `actions` and `banners`, host-rendered `plusMenu` rows, and `richText` rules that paint match ranges without mutating text. Scope the customization to composer kinds with `scopes`, or omit it for all kinds.",
      'Mounted components use `useComposer()` for writes, effects, and input locking, and `useComposerView()` for the reactive scope, layout, draft, and run state. `useComposer()` writes to the same shared draft the built-in "Add to chat" affordances use.',
    ],
    examples: [
      {
        title: "A plus-menu row that appends to the draft",
        lang: "tsx",
        code: `app.composer.customize({
  id: "reference-regions",
  plusMenu: [
    {
      id: "append-checklist",
      label: "Append review checklist",
      icon: "ListChecks",
      disabled: (view) => view.run.isSubmitting,
      run: ({ composer }) => {
        composer.updateText(
          (current) => current + (current ? "\\n\\n" : "") + "- Verify behavior\\n- Run checks",
        );
        composer.focus();
      },
    },
  ],
});`,
      },
    ],
    symbolGroups: [
      {
        title: "Registration",
        symbols: [
          root("PluginAppComposer"),
          root("ComposerCustomization"),
          root("ComposerPlusMenuItem"),
          root("ComposerRichTextSpec"),
          root("ComposerStructuredDraft"),
        ],
      },
      {
        title: "Hooks & state",
        symbols: [
          app("useComposer"),
          app("useComposerView"),
          root("PluginComposerApi"),
          root("ComposerView"),
          root("PluginComposerScope"),
          root("PluginComposerMention"),
          root("PluginComposerTextEffect"),
          root("PluginComposerThreadRowStatus"),
        ],
      },
    ],
  },
  {
    id: "content-scripts",
    title: "Content scripts",
    group: "Frontend · app.tsx",
    summary:
      "Trusted same-origin scripts that enhance the bb app shell without rendering a React slot.",
    intro: [
      "`app.contentScripts.register({ id, mount })` runs ordinary bundled TypeScript once per active frontend generation in each bb window or tab. The host supplies `{ pluginId, generation, signal }`, awaits mount setup, and owns abort plus exact-once reverse-order disposal across hash reload, disable, removal, failed replacement, and app-window teardown. The old generation is disposed before candidate mounts, so generations never overlap.",
      "Content scripts are trusted same-origin page code, not a sandbox. Static styles belong in the imported `app.css`; scripts may own dynamic DOM/style nodes when their disposer removes them.",
    ],
    examples: [
      {
        title: "A cleanup-safe content script",
        lang: "ts",
        code: `app.contentScripts.register({
  id: "keyboard-shortcut",
  mount({ signal }) {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.metaKey && event.key === "j") openMyPanel();
    };
    window.addEventListener("keydown", onKeyDown, { signal });
    return () => {
      // signal-bound listeners are already removed; dispose extras here
    };
  },
});`,
      },
    ],
    symbolGroups: [
      {
        symbols: [
          root("PluginAppContentScripts"),
          root("PluginContentScriptRegistration"),
          root("PluginContentScriptContext"),
          root("PluginContentScriptDisposer"),
        ],
      },
    ],
  },
  {
    id: "hooks",
    title: "Hooks",
    group: "Frontend · app.tsx",
    summary:
      "useRpc, useRealtime, useSettings, useBbContext, useBbNavigate: the data and navigation layer for plugin UI.",
    intro: [
      "These hooks are available to every mounted plugin component. `useRpc<typeof contract>()` calls the plugin's own backend RPC methods with full inference from the shared contract. `useRealtime(channel, handler)` subscribes to the plugin's `bb.realtime.publish` signals over the app's shared connection, and `useRealtimeConnectionState()` lets you reconcile after reconnects.",
      "`useSettings()` exposes effective non-secret setting values. `useBbContext()` reports the current project/thread selection derived from the route, and `useBbNavigate()` navigates: to threads, projects, the plugin's own nav panels, thread panels, and the compose surface.",
    ],
    examples: [
      {
        title: "Live data with RPC + realtime invalidation",
        lang: "tsx",
        code: `import { useRpc, useRealtime } from "@get-bb/plugin-sdk/app";
import { useCallback, useEffect, useState } from "react";
import type { contract } from "./contract";

function NotesList() {
  const rpc = useRpc<typeof contract>();
  const [notes, setNotes] = useState<{ id: string; title: string }[]>([]);

  const refresh = useCallback(async () => {
    setNotes(await rpc.call("list", { query: "" }));
  }, [rpc]);

  useEffect(() => void refresh(), [refresh]);
  useRealtime("notes-changed", () => void refresh());

  return <ul>{notes.map((note) => <li key={note.id}>{note.title}</li>)}</ul>;
}`,
      },
    ],
    symbolGroups: [
      {
        title: "Data",
        symbols: [
          app("useRpc"),
          root("PluginRpcClient"),
          app("useRealtime"),
          app("useRealtimeConnectionState"),
          root("PluginRealtimeConnectionState"),
          app("useSettings"),
          root("PluginSettingsState"),
        ],
      },
      {
        title: "Context & navigation",
        symbols: [
          app("useBbContext"),
          root("BbContext"),
          app("useBbNavigate"),
          root("BbNavigate"),
        ],
      },
    ],
  },
  {
    id: "host-components",
    title: "Host components",
    group: "Frontend · app.tsx",
    summary:
      "ThreadChat, Markdown, and the new-thread composer: the product components the SDK ships.",
    intro: [
      "The SDK deliberately ships no UI kit, but it does ship stable product capabilities: `ThreadChat` renders one thread's chat (timeline plus the full send/queue/draft engine), `Markdown` renders content exactly like a chat message body, and `experimental_NewThreadComposer` is bb's full new-thread compose surface.",
      "`experimental_NewThreadComposer` resolves every user selection into a JSON-serializable `NewThreadRequest` the plugin forwards to its own backend and hands to `bb.sdk.threads.spawn`; the split keeps user selections composer-owned and filing/attribution plugin-owned.",
    ],
    examples: [
      {
        title: "Embedding a thread's chat in a panel",
        lang: "tsx",
        code: `import { ThreadChat } from "@get-bb/plugin-sdk/app";

function SideBySide({ threadId }: { threadId: string }) {
  return <ThreadChat threadId={threadId} variant="compact" layout="contained" />;
}
// Register the panel with layout: "flush" so ThreadChat owns the tab area.`,
      },
    ],
    symbolGroups: [
      {
        symbols: [
          app("ThreadChat"),
          root("ThreadChatProps"),
          root("ThreadChatMessageAction"),
          app("Markdown"),
          root("MarkdownProps"),
          app("experimental_NewThreadComposer"),
          root("NewThreadComposerProps"),
          root("NewThreadRequest"),
        ],
      },
    ],
  },

  // -------------------------------------------------------------------------
  // Host workers.
  // -------------------------------------------------------------------------
  {
    id: "host-entry",
    title: "Host entries",
    group: "Host workers",
    summary:
      "experimental_defineHostEntry: a supervised Node worker on enrolled hosts, called over typed RPC.",
    intro: [
      "The manifest's singular `bb.host` entry default-exports `experimental_defineHostEntry({ contract, handlers })`. The artifact is bundled by `bb plugin build`, downloaded lazily by the host daemon, digest-verified, and run as one worker per plugin generation. Host code is full-trust Node 22 (`child_process`, `fs`, and `fetch` are all available) but may not import private `@bb/*` workspace packages.",
      "Handlers receive an `ExperimentalHostRpcContext`: request and lifecycle abort signals, persistent plugin-scoped and worker-temporary directories, daemon-owned native filesystem watches, typed signals back to the server entry, and explicit worker-retention leases. Active calls and watches retain the worker automatically; otherwise the daemon evicts it after an idle period and restarts it on the next call.",
      "The server side of this pairing is `bb.hosts.experimental_client`; see [Host control plane](/docs/plugin-api/hosts-control).",
    ],
    examples: [
      {
        title: "A host entry with a watch-backed method",
        lang: "ts",
        code: `import { experimental_defineHostEntry } from "@get-bb/plugin-sdk/host";
import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";

const contract = defineRpcContract({
  watchRoot: {
    input: z.object({ rootPath: z.string() }),
    output: z.object({ started: z.boolean() }),
  },
});

export default experimental_defineHostEntry({
  contract,
  handlers: {
    async watchRoot({ rootPath }, ctx) {
      await ctx.experimental_watch({ rootPath }, (event) => {
        if (event.kind === "changed") void reindex(event.changes);
      });
      return { started: true };
    },
  },
});`,
      },
    ],
    symbolGroups: [
      {
        title: "Defining the entry",
        symbols: [
          host("experimental_defineHostEntry"),
          host("ExperimentalHostEntry"),
          host("ExperimentalHostRpcHandlers"),
          host("ExperimentalHostRpcContext"),
          host("ExperimentalHostPaths"),
          host("ExperimentalHostWorkerLease"),
        ],
      },
      {
        title: "Filesystem watches",
        symbols: [
          host("ExperimentalHostWatchOptions"),
          host("ExperimentalHostWatchListener"),
          host("ExperimentalHostWatchEvent"),
          host("ExperimentalHostWatchChange"),
          host("ExperimentalHostWatchChangeType"),
          host("ExperimentalHostWatchSubscription"),
        ],
      },
    ],
  },

  // -------------------------------------------------------------------------
  // Provider bridges.
  // -------------------------------------------------------------------------
  {
    id: "provider-bridge",
    title: "Provider bridges",
    group: "Provider bridges",
    summary:
      "The published authoring surface for agent-provider bridges: entry contract, protocol schemas, bridge kit, and event vocabulary.",
    intro: [
      "A provider bridge is how a plugin implements an agent provider it declared with `bb.agents.experimental_registerProvider`. The bridge ships inside the plugin's `bb.host` artifact (named by `bb.providerBridge` in the manifest) and speaks the Provider Bridge Protocol: JSON-RPC over stdio between the host daemon and the provider process.",
      "`@get-bb/plugin-sdk/provider-bridge` is curated by hand, never `export *`: a name that is not here is bb-internal and may move. Unlike the root and host subpaths, everything here is pure schema and helper code with no daemon-pinned behavior, so a bridge artifact simply bundles it.",
      "This surface is experimental; see `docs/api_to_audit.md` in the bb repository. The first-party bridges under `plugins/provider-*` in the bb repository are the reference implementations.",
    ],
    examples: [
      {
        title: "Declaring a bridge entry",
        lang: "ts",
        code: `import {
  experimental_defineProviderBridge,
  createBridgeIo,
} from "@get-bb/plugin-sdk/provider-bridge";

export default experimental_defineProviderBridge((context) => {
  const io = createBridgeIo(process.stdin, process.stdout);
  // Handle initialize / thread.start / turn.start …, translating the
  // provider's own events into bb thread events.
});`,
      },
    ],
    symbolGroups: [
      {
        title: "The bridge entry contract",
        blurb: "How a module declares itself a bridge.",
        symbols: PB_ENTRY_CONTRACT.map(pb),
      },
      {
        title: "The Provider Bridge Protocol",
        blurb:
          "Request/notification vocabulary and param schemas exchanged with the host daemon.",
        symbols: PB_PROTOCOL.map(pb),
      },
      {
        title: "Launch & environment",
        blurb:
          "Child-process env hygiene and the ACP launch spec, the one core wire shape a bridge parses directly.",
        symbols: PB_LAUNCH_ENV.map(pb),
      },
      {
        title: "Bridge kit & event vocabulary",
        blurb:
          "Authoring helpers (JSON-RPC framing, tool-call and interaction codecs, id scoping, translation helpers) and the persisted-thread event shapes bridge payloads are made of.",
        symbols: PB_REST,
      },
    ],
  },

  // -------------------------------------------------------------------------
  // Testing.
  // -------------------------------------------------------------------------
  {
    id: "testing-backend",
    title: "Testing the backend",
    group: "Testing",
    summary:
      "createFakePluginHost: unit-test server.ts against an in-process stand-in for the bb server.",
    intro: [
      "`createFakePluginHost` builds an in-process stand-in for the bb server's plugin runtime. `host.bb` satisfies `BbPluginApi`; `host.harness` drives and inspects it: `harness.behavior` contains deterministic host inputs (RPC/HTTP/CLI calls, events, settings, tools, interactions, schedules), `harness.inspection` contains registrations and recorded state, and `harness.lifecycle` owns atomic reload and disposal.",
      "The fake is faithful where a plugin can observe it (schema-RPC validation, the KV 256KB cap, append-only migrations, settings semantics, dispose order) and deliberately different elsewhere: storage is process-local, `bb.sdk` is always bound and unstubbed calls throw with the exact path to stub, and services and schedules run only when driven.",
      "Install the SDK with the test stack used by your plugin: `npm install --save-dev @get-bb/plugin-sdk vitest better-sqlite3 zod cron-parser hono`.",
    ],
    examples: [
      {
        title: "Driving a plugin's RPC and inspecting registrations",
        lang: "ts",
        code: `import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import plugin from "./server.js";

const host = createFakePluginHost({ pluginId: "notes" });
await plugin(host.bb);

await host.harness.behavior.callRpc("list", { query: "today" });
expect(host.harness.inspection.registrations.rpcMethods).toContain("list");
await host.harness.lifecycle.dispose();`,
      },
    ],
    symbolGroups: [
      {
        title: "Entry points",
        symbols: [
          testing("createFakePluginHost"),
          testing("CreateFakePluginHostOptions"),
          testing("FakePluginHost"),
          testing("FakePluginHarness"),
          testing("createFakeSdk"),
          testing("makeThreadResponse"),
          testing("PluginContextStaleError"),
        ],
      },
      {
        title: "Harness views",
        symbols: [
          testing("FakePluginBehaviorDrivers"),
          testing("FakePluginInspectionState"),
          testing("FakePluginLifecycleControls"),
          testing("FakePluginRegistrations"),
        ],
      },
      {
        title: "Recorded state",
        symbols: [
          testing("FakeSdkCall"),
          testing("FakeSdkOverrides"),
          testing("FakeSdkHarness"),
          testing("FakeLogLevel"),
          testing("FakeLogEntry"),
          testing("FakeHttpRouteRecord"),
          testing("FakeScheduleRecord"),
          testing("FakeServiceRecord"),
          testing("FakeCliRecord"),
          testing("FakeAgentToolRecord"),
          testing("FakeMentionProviderRecord"),
          testing("FakeRealtimeSignal"),
        ],
      },
    ],
  },
  {
    id: "testing-frontend",
    title: "Testing the frontend",
    group: "Testing",
    summary:
      "loadPluginApp, renderSlot, and content-script mounting: test app.tsx under vitest + jsdom.",
    intro: [
      "`@get-bb/plugin-sdk/testing/app` tests a plugin's `app.tsx` source directly under vitest + jsdom, without the bb host or the esbuild bundle. `loadPluginApp` installs the test runtime, runs the definition's setup against a validating collector (ported from the bb app's interpreter, same error messages), and returns the typed slot registrations.",
      "`renderSlot` mounts one registration's component with mock hook backends (RPC as a method→handler map with a call log, realtime as a channel you can push events into, settings/context as plain values, navigate/composer as recorders) and returns Testing Library queries plus `behavior`/`inspection`/`lifecycle` views.",
      'Import the plugin module through a thunk (`() => import("./app.js")`) so it evaluates after the runtime is installed; use a setup-file `installTestPluginRuntime()` only when a static import is unavoidable. Add `// @vitest-environment jsdom` to test files using `renderSlot`.',
    ],
    examples: [
      {
        title: "Rendering a slot with mocked RPC and realtime",
        lang: "tsx",
        code: `import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";

const app = await loadPluginApp(() => import("./app.js"));
const slot = renderSlot(
  app.homepageSections[0]!,
  { projectId: "proj_1" },
  {
    rpc: { list: () => [] },
    context: { projectId: "proj_1", threadId: null },
  },
);

await slot.behavior.emitRealtime("notes-changed", null);
expect(slot.inspection.rpcCalls).toHaveLength(1);
slot.lifecycle.unmount();`,
      },
    ],
    symbolGroups: [
      {
        title: "Entry points",
        symbols: [
          testingApp("loadPluginApp"),
          testingApp("renderSlot"),
          testingApp("mountPluginContentScripts"),
          testingApp("installTestPluginRuntime"),
        ],
      },
      {
        title: "Captured registrations & options",
        symbols: [
          testingApp("CapturedPluginApp"),
          testingApp("PluginAppSource"),
          testingApp("RenderSlotOptions"),
          testingApp("PluginRpcTestHandlers"),
          testingApp("ContentScriptTestMountOptions"),
        ],
      },
      {
        title: "Rendered-slot views",
        symbols: [
          testingApp("RenderedSlot"),
          testingApp("RenderedSlotBehaviorDrivers"),
          testingApp("RenderedSlotInspectionState"),
          testingApp("RenderedSlotLifecycleControls"),
          testingApp("RpcCall"),
          testingApp("NavigateCall"),
          testingApp("SidebarActionCall"),
          testingApp("ComposerLog"),
          testingApp("MountedPluginContentScripts"),
          testingApp("ContentScriptThreadRowStatusCall"),
        ],
      },
    ],
  },
  {
    id: "testing-host",
    title: "Testing host entries",
    group: "Testing",
    summary:
      "experimental_createHostEntryHarness: drive a bb.host entry's handlers without a daemon.",
    intro: [
      "`@get-bb/plugin-sdk/testing/host` drives a `bb.host` entry deterministically: call handlers with validation, observe emitted signals, and exercise lifecycle disposal, simulating the daemon's validation, cancellation, JSON, and size limits without pretending to model process startup, crashes, or reconnect behavior.",
    ],
    examples: [
      {
        title: "Calling a host entry under test",
        lang: "ts",
        code: `import { experimental_createHostEntryHarness } from "@get-bb/plugin-sdk/testing/host";
import hostEntry from "./host.js";

const harness = experimental_createHostEntryHarness(hostEntry);
const result = await harness.experimental_call("watchRoot", { rootPath: "/tmp/project" });
await harness.experimental_dispose();`,
      },
    ],
    symbolGroups: [
      {
        symbols: [
          testingHost("experimental_createHostEntryHarness"),
          testingHost("ExperimentalCreateHostEntryHarnessOptions"),
          testingHost("ExperimentalHostEntryHarness"),
          testingHost("ExperimentalHostHarnessSignal"),
        ],
      },
    ],
  },
];

// ---------------------------------------------------------------------------
// Lookup helpers.
// ---------------------------------------------------------------------------

export function sectionById(id: string): DocsSection | undefined {
  return DOCS_SECTIONS.find((section) => section.id === id);
}

/** name -> section id, for cross-links and {@link} resolution. */
export const SECTION_BY_SYMBOL_NAME: ReadonlyMap<string, string> = (() => {
  const map = new Map<string, string>();
  for (const section of DOCS_SECTIONS) {
    for (const group of section.symbolGroups) {
      for (const ref of group.symbols) {
        if (!map.has(ref.name)) {
          map.set(ref.name, section.id);
        }
      }
    }
  }
  return map;
})();

export const SECTIONS_BY_GROUP: ReadonlyMap<string, DocsSection[]> = (() => {
  const map = new Map<string, DocsSection[]>();
  for (const group of DOCS_GROUPS) {
    map.set(group, []);
  }
  for (const section of DOCS_SECTIONS) {
    map.get(section.group)?.push(section);
  }
  return map;
})();

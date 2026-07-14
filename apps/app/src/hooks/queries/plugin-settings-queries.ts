import { useQuery, type QueryKey } from "@tanstack/react-query";
import { z } from "zod";

/**
 * Host-rendered plugin management data for the Plugins resource surface:
 * the installed-plugin list plus each
 * running plugin's declarative settings view, backed by GET /api/v1/plugins
 * and GET/PUT /api/v1/plugins/:id/settings. Like the contributions queries,
 * these routes are server-policy glue outside the typed contract, so they
 * are fetched directly and validated locally. Fetchers take an injected
 * fetch so tests can exercise the response mapping.
 */

type FetchLike = (
  input: string,
  init?: RequestInit,
) => Promise<Pick<Response, "ok" | "status" | "json">>;

export type PluginProvenance = "builtin" | "direct" | "marketplace";

export interface PluginUpdateFailure {
  version: string;
  /** Epoch ms; null only when the server sent an unparsable time. */
  at: number | null;
  detail: string;
}

/**
 * Per-plugin update state from GET /api/v1/plugins. Absent fields normalize
 * to the quiet state ("nothing to report") at this boundary so the UI never
 * branches on undefined.
 */
export interface PluginUpdateState {
  outcome: string | null;
  /** Compatible candidate the user can apply now. */
  availableVersion: string | null;
  /** Newer release blocked by bb/SDK compatibility; never actionable. */
  blockedVersion: string | null;
  blockedReasons: string[];
  /** Epoch ms of the last update check; null when never checked. */
  lastCheckAt: number | null;
  /** Last failed update that rolled back; drives "Needs attention". */
  lastFailure: PluginUpdateFailure | null;
}

export interface PluginListItem {
  id: string;
  /** Installed source spec; null only when talking to an older server. */
  source: string | null;
  /** Built-ins can be enabled or disabled, but never edited or deleted. */
  isBuiltin: boolean;
  /** Host path containing the plugin; null only when unavailable. */
  rootDir: string | null;
  version: string;
  enabled: boolean;
  status: string;
  statusDetail: string | null;
  /** Manifest description (package.json); null when absent or not loaded. */
  description: string | null;
  /** `bb.displayName` — human nav/header label; null → fall back to `id`. */
  displayName: string | null;
  /** `bb.icon` — host icon-name hint; null → use the generic plugin icon. */
  icon: string | null;
  /** Hash-busted logo asset URL; null when the plugin ships no logo. */
  logoUrl: string | null;
  /** Dark-theme logo variant URL; null when the plugin ships none. */
  logoDarkUrl: string | null;
  /** True when the loaded plugin declared settings; drives its nav entry. */
  hasSettings: boolean;
  handlerStats: {
    count: number;
    totalMs: number;
    maxMs: number;
    errorCount: number;
  };
  services: Array<{
    name: string;
    state: "running" | "backoff" | "stopped";
  }>;
  schedules: Array<{
    name: string;
    cron: string;
    nextRunAt: number;
    lastRunAt: number | null;
    lastStatus: "running" | "ok" | "error" | null;
    lastError: string | null;
  }>;
  cliCommand: { name: string; summary: string } | null;
  app: { hasApp: boolean };
  provenance: PluginProvenance;
  /** Marketplace display name when provenance is "marketplace". */
  marketplaceName: string | null;
  /** Human source line ("npm · @bb-plugins/linear · pinned"). */
  sourceDisplay: string;
  updateState: PluginUpdateState;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function parseHandlerStats(value: unknown): PluginListItem["handlerStats"] {
  if (!isRecord(value)) {
    return { count: 0, totalMs: 0, maxMs: 0, errorCount: 0 };
  }
  return {
    count: typeof value.count === "number" ? value.count : 0,
    totalMs: typeof value.totalMs === "number" ? value.totalMs : 0,
    maxMs: typeof value.maxMs === "number" ? value.maxMs : 0,
    errorCount: typeof value.errorCount === "number" ? value.errorCount : 0,
  };
}

function parseServices(value: unknown): PluginListItem["services"] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((service) => {
    if (
      !isRecord(service) ||
      typeof service.name !== "string" ||
      (service.state !== "running" &&
        service.state !== "backoff" &&
        service.state !== "stopped")
    ) {
      return [];
    }
    return [{ name: service.name, state: service.state }];
  });
}

function parseSchedules(value: unknown): PluginListItem["schedules"] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((schedule) => {
    if (
      !isRecord(schedule) ||
      typeof schedule.name !== "string" ||
      typeof schedule.cron !== "string" ||
      typeof schedule.nextRunAt !== "number" ||
      !(schedule.lastRunAt === null || typeof schedule.lastRunAt === "number") ||
      !(
        schedule.lastStatus === null ||
        schedule.lastStatus === "running" ||
        schedule.lastStatus === "ok" ||
        schedule.lastStatus === "error"
      ) ||
      !(schedule.lastError === null || typeof schedule.lastError === "string")
    ) {
      return [];
    }
    return [
      {
        name: schedule.name,
        cron: schedule.cron,
        nextRunAt: schedule.nextRunAt,
        lastRunAt: schedule.lastRunAt,
        lastStatus: schedule.lastStatus,
        lastError: schedule.lastError,
      },
    ];
  });
}

export interface PluginListResult {
  plugins: PluginListItem[];
}

/** Servers send epoch ms or ISO strings; normalize to epoch ms once here. */
const timestampSchema = z.union([z.number(), z.string()]);

export function toEpochMs(value: number | string | undefined): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? null : parsed;
  }
  return null;
}

// The server always persists the full failure record; a partial one is a
// contract drift and must drop the row rather than masquerade as quiet.
const updateFailureSchema = z.object({
  version: z.string(),
  at: timestampSchema,
  detail: z.string(),
});

const updateStateSchema = z.object({
  outcome: z.string().optional(),
  availableVersion: z.string().optional(),
  blockedVersion: z.string().optional(),
  blockedReasons: z.array(z.string()).optional(),
  lastCheckAt: timestampSchema.optional(),
  lastFailure: updateFailureSchema.optional(),
});

export const EMPTY_PLUGIN_UPDATE_STATE: PluginUpdateState = {
  outcome: null,
  availableVersion: null,
  blockedVersion: null,
  blockedReasons: [],
  lastCheckAt: null,
  lastFailure: null,
};

// provenance, sourceDisplay, and updateState are server-mandated on every
// row: a row missing any of them is contract drift and drops rather than
// normalizing to a quiet state that could hide a rollback.
const pluginListItemSchema = z.object({
  id: z.string(),
  source: z.string().nullish(),
  rootDir: z.string().nullish(),
  version: z.string(),
  enabled: z.boolean(),
  status: z.string(),
  statusDetail: z.string().nullable(),
  description: z.string().nullish(),
  displayName: z.string().nullish(),
  icon: z.string().nullish(),
  logoUrl: z.string().nullish(),
  logoDarkUrl: z.string().nullish(),
  hasSettings: z.boolean().optional(),
  provenance: z.enum(["builtin", "direct", "marketplace"]),
  marketplaceName: z.string().nullish(),
  sourceDisplay: z.string(),
  updateState: updateStateSchema,
  handlerStats: z.unknown().optional(),
  services: z.unknown().optional(),
  schedules: z.unknown().optional(),
  cliCommand: z.unknown().optional(),
  app: z.unknown().optional(),
});

function parsePluginListItem(value: unknown): PluginListItem | null {
  const parsed = pluginListItemSchema.safeParse(value);
  if (!parsed.success) return null;
  const item = parsed.data;
  const state = item.updateState;
  return {
    id: item.id,
    source: item.source ?? null,
    isBuiltin: item.provenance === "builtin",
    rootDir: item.rootDir ?? null,
    version: item.version,
    enabled: item.enabled,
    status: item.status,
    statusDetail: item.statusDetail,
    description: item.description ?? null,
    displayName: item.displayName ?? null,
    icon: item.icon ?? null,
    logoUrl: item.logoUrl ?? null,
    logoDarkUrl: item.logoDarkUrl ?? null,
    hasSettings: item.hasSettings === true,
    provenance: item.provenance,
    marketplaceName: item.marketplaceName ?? null,
    sourceDisplay: item.sourceDisplay,
    handlerStats: parseHandlerStats(item.handlerStats),
    services: parseServices(item.services),
    schedules: parseSchedules(item.schedules),
    cliCommand:
      isRecord(item.cliCommand) &&
      typeof item.cliCommand.name === "string" &&
      typeof item.cliCommand.summary === "string"
        ? { name: item.cliCommand.name, summary: item.cliCommand.summary }
        : null,
    app: {
      hasApp: isRecord(item.app) && item.app.hasApp === true,
    },
    updateState: {
      outcome: state.outcome ?? null,
      availableVersion: state.availableVersion ?? null,
      blockedVersion: state.blockedVersion ?? null,
      blockedReasons: state.blockedReasons ?? [],
      lastCheckAt: toEpochMs(state.lastCheckAt),
      lastFailure:
        state.lastFailure === undefined
          ? null
          : {
              version: state.lastFailure.version,
              at: toEpochMs(state.lastFailure.at),
              detail: state.lastFailure.detail,
            },
    },
  };
}

// The `{ enabled, plugins }` envelope, both required. `enabled` (the
// experiment flag) is already surfaced through the system config, so only
// the rows are read — but a body missing either field is contract drift and
// renders the quiet empty list rather than half-parsed rows.
const pluginListEnvelopeSchema = z.object({
  enabled: z.boolean(),
  plugins: z.array(z.unknown()),
});

export async function fetchPluginList(
  fetchImpl: FetchLike,
): Promise<PluginListResult> {
  const response = await fetchImpl("/api/v1/plugins");
  // Nothing to list rather than an error: a disabled experiment means "no
  // plugins".
  if (!response.ok) return { plugins: [] };
  const parsed = pluginListEnvelopeSchema.safeParse(
    await response.json().catch(() => null),
  );
  if (!parsed.success) return { plugins: [] };
  return {
    plugins: parsed.data.plugins
      .map(parsePluginListItem)
      .filter((item): item is PluginListItem => item !== null),
  };
}

/** Client mirror of the server's plain-data setting descriptors. */
export type PluginSettingFieldDescriptor =
  | { type: "string"; label: string; description?: string; secret?: true }
  | { type: "boolean"; label: string; description?: string }
  | { type: "select"; label: string; description?: string; options: string[] }
  | { type: "project"; label: string; description?: string };

export interface PluginSettingsView {
  schema: Record<string, PluginSettingFieldDescriptor>;
  /** Non-secret effective values; secret keys map to `{ set: boolean }`. */
  values: Record<string, unknown>;
}

function isSettingDescriptor(
  value: unknown,
): value is PluginSettingFieldDescriptor {
  if (typeof value !== "object" || value === null) return false;
  const descriptor = value as Record<string, unknown>;
  if (typeof descriptor.label !== "string") return false;
  switch (descriptor.type) {
    case "string":
    case "boolean":
    case "project":
      return true;
    case "select":
      return (
        Array.isArray(descriptor.options) &&
        descriptor.options.every((option) => typeof option === "string")
      );
    default:
      return false;
  }
}

function parseSettingsView(body: unknown): PluginSettingsView | null {
  const typed = body as {
    ok?: unknown;
    schema?: unknown;
    values?: unknown;
  } | null;
  if (
    typed?.ok !== true ||
    typeof typed.schema !== "object" ||
    typed.schema === null ||
    typeof typed.values !== "object" ||
    typed.values === null
  ) {
    return null;
  }
  const schema: Record<string, PluginSettingFieldDescriptor> = {};
  for (const [key, descriptor] of Object.entries(typed.schema)) {
    if (isSettingDescriptor(descriptor)) schema[key] = descriptor;
  }
  return { schema, values: typed.values as Record<string, unknown> };
}

/** Null when the plugin is unknown/not running (settings need a loaded factory). */
export async function fetchPluginSettingsView(
  fetchImpl: FetchLike,
  pluginId: string,
): Promise<PluginSettingsView | null> {
  const response = await fetchImpl(
    `/api/v1/plugins/${encodeURIComponent(pluginId)}/settings`,
  );
  if (!response.ok) return null;
  return parseSettingsView(await response.json().catch(() => null));
}

/**
 * PUT /api/v1/plugins/:id/settings with `{ values }` (`null` unsets a key).
 * Resolves with the refreshed view; throws with the server's validation
 * message on rejection.
 */
export async function updatePluginSettings(
  fetchImpl: FetchLike,
  pluginId: string,
  values: Record<string, unknown>,
): Promise<PluginSettingsView> {
  const response = await fetchImpl(
    `/api/v1/plugins/${encodeURIComponent(pluginId)}/settings`,
    {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ values }),
    },
  );
  const body: unknown = await response.json().catch(() => null);
  const view = response.ok ? parseSettingsView(body) : null;
  if (view === null) {
    const error = (body as { error?: unknown } | null)?.error;
    throw new Error(
      typeof error === "string"
        ? error
        : `saving settings failed (HTTP ${response.status})`,
    );
  }
  return view;
}

/**
 * POST /api/v1/plugins/:id/enable|disable. Resolves on success; throws with
 * the server's message on rejection (unknown plugin, experiment off).
 */
export async function setPluginEnabled(
  fetchImpl: FetchLike,
  pluginId: string,
  enabled: boolean,
): Promise<void> {
  const response = await fetchImpl(
    `/api/v1/plugins/${encodeURIComponent(pluginId)}/${enabled ? "enable" : "disable"}`,
    { method: "POST" },
  );
  if (response.ok) return;
  const body = (await response.json().catch(() => null)) as {
    error?: unknown;
  } | null;
  throw new Error(
    typeof body?.error === "string"
      ? body.error
      : `${enabled ? "enabling" : "disabling"} the plugin failed (HTTP ${response.status})`,
  );
}

/**
 * DELETE /api/v1/plugins/:id. Uninstalls the plugin: git:/npm: managed files
 * are deleted; a local path source is left in place. Throws with the server's
 * message on rejection.
 */
export async function removePlugin(
  fetchImpl: FetchLike,
  pluginId: string,
): Promise<void> {
  const response = await fetchImpl(
    `/api/v1/plugins/${encodeURIComponent(pluginId)}`,
    { method: "DELETE" },
  );
  if (response.ok) return;
  const body = (await response.json().catch(() => null)) as {
    error?: unknown;
  } | null;
  throw new Error(
    typeof body?.error === "string"
      ? body.error
      : `removing the plugin failed (HTTP ${response.status})`,
  );
}

export function pluginListQueryKey(enabled: boolean): QueryKey {
  return ["plugin-list", enabled];
}

/** Prefix the realtime `plugins-changed` broadcast invalidates. */
export function allPluginListQueryKeyPrefix(): QueryKey {
  return ["plugin-list"];
}

export function pluginSettingsViewQueryKey(pluginId: string): QueryKey {
  return ["plugin-settings-view", pluginId];
}

/** Prefix the realtime `plugins-changed` broadcast invalidates. */
export function allPluginSettingsViewQueryKeyPrefix(): QueryKey {
  return ["plugin-settings-view"];
}

export function usePluginList(args: { enabled: boolean }) {
  return useQuery({
    queryKey: pluginListQueryKey(args.enabled),
    queryFn: () => fetchPluginList(fetch),
    enabled: args.enabled,
    staleTime: 30_000,
  });
}

export function usePluginSettingsView(
  pluginId: string,
  options: { enabled: boolean },
) {
  return useQuery({
    queryKey: pluginSettingsViewQueryKey(pluginId),
    queryFn: () => fetchPluginSettingsView(fetch, pluginId),
    enabled: options.enabled,
    staleTime: 30_000,
  });
}

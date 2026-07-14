import { useQuery, type QueryKey } from "@tanstack/react-query";

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
      !(
        schedule.lastRunAt === null || typeof schedule.lastRunAt === "number"
      ) ||
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

function parsePluginListItem(value: unknown): PluginListItem | null {
  if (typeof value !== "object" || value === null) return null;
  const item = value as Record<string, unknown>;
  if (
    typeof item.id !== "string" ||
    typeof item.version !== "string" ||
    typeof item.enabled !== "boolean" ||
    typeof item.status !== "string" ||
    !(item.statusDetail === null || typeof item.statusDetail === "string")
  ) {
    return null;
  }
  return {
    id: item.id,
    source: typeof item.source === "string" ? item.source : null,
    isBuiltin:
      typeof item.source === "string" && item.source.startsWith("builtin:"),
    rootDir: typeof item.rootDir === "string" ? item.rootDir : null,
    version: item.version,
    enabled: item.enabled,
    status: item.status,
    statusDetail: item.statusDetail,
    description: typeof item.description === "string" ? item.description : null,
    // Absent on older servers → fall back to the id in the UI.
    displayName: typeof item.displayName === "string" ? item.displayName : null,
    // Absent on older servers → no logo, never a dropped row.
    logoUrl: typeof item.logoUrl === "string" ? item.logoUrl : null,
    logoDarkUrl: typeof item.logoDarkUrl === "string" ? item.logoDarkUrl : null,
    // Absent on older servers → assume no declared settings.
    hasSettings: item.hasSettings === true,
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
  };
}

export async function fetchPluginList(
  fetchImpl: FetchLike,
): Promise<PluginListItem[]> {
  const response = await fetchImpl("/api/v1/plugins");
  // Nothing to list rather than an error: an older server or a disabled
  // experiment both mean "no plugins".
  if (!response.ok) return [];
  const body = (await response.json().catch(() => null)) as {
    plugins?: unknown;
  } | null;
  return Array.isArray(body?.plugins)
    ? body.plugins
        .map(parsePluginListItem)
        .filter((item): item is PluginListItem => item !== null)
    : [];
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

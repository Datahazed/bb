import { jsonValueSchema, type JsonValue } from "@bb/domain";
import { z } from "zod";
import type { CreateSdkAreaArgs } from "./common.js";

export interface PluginIdArgs {
  pluginId: string;
}

export interface PluginInstallArgs {
  source: string;
}

export interface PluginReloadArgs {
  pluginId?: string;
}

export interface PluginSettingsUpdateArgs extends PluginIdArgs {
  values: Record<string, JsonValue>;
}

export interface PluginTokenArgs extends PluginIdArgs {
  rotate?: boolean;
}

export interface PluginRpcArgs<TOutput> extends PluginIdArgs {
  input?: JsonValue;
  method: string;
  outputSchema: z.ZodType<TOutput>;
}

export type PluginDisableResult = JsonValue;
export type PluginEnableResult = JsonValue;
export type PluginGetSettingsResult = JsonValue;
export type PluginInstallResult = JsonValue;
export type PluginListResult = JsonValue;
export type PluginReloadResult = JsonValue;
export type PluginRemoveResult = JsonValue;
export type PluginTokenResult = JsonValue;
export type PluginUpdateSettingsResult = JsonValue;

export interface PluginsArea {
  callRpc<TOutput>(args: PluginRpcArgs<TOutput>): Promise<TOutput>;
  disable(args: PluginIdArgs): Promise<PluginDisableResult>;
  enable(args: PluginIdArgs): Promise<PluginEnableResult>;
  getSettings(args: PluginIdArgs): Promise<PluginGetSettingsResult>;
  install(args: PluginInstallArgs): Promise<PluginInstallResult>;
  list(): Promise<PluginListResult>;
  reload(args?: PluginReloadArgs): Promise<PluginReloadResult>;
  remove(args: PluginIdArgs): Promise<PluginRemoveResult>;
  token(args: PluginTokenArgs): Promise<PluginTokenResult>;
  updateSettings(
    args: PluginSettingsUpdateArgs,
  ): Promise<PluginUpdateSettingsResult>;
}

function pluginPath(pluginId: string, suffix = ""): string {
  return `/api/v1/plugins/${encodeURIComponent(pluginId)}${suffix}`;
}

export function createPluginsArea(args: CreateSdkAreaArgs): PluginsArea {
  const { transport } = args;

  async function requestJson(
    path: string,
    init?: RequestInit,
  ): Promise<JsonValue> {
    const url = transport.baseUrl
      ? `${transport.baseUrl.replace(/\/$/u, "")}${path}`
      : path;
    const response = await transport.resolve(transport.fetch(url, init));
    return jsonValueSchema.parse(await response.json());
  }

  function jsonInit(method: string, body?: JsonValue): RequestInit {
    return {
      method,
      headers: { "content-type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    };
  }

  return {
    async callRpc(input) {
      const envelope = await requestJson(
        pluginPath(input.pluginId, `/rpc/${encodeURIComponent(input.method)}`),
        jsonInit("POST", input.input ?? null),
      );
      const parsed = z
        .object({ ok: z.literal(true), result: jsonValueSchema })
        .parse(envelope);
      return input.outputSchema.parse(parsed.result);
    },
    async disable(input) {
      return requestJson(
        pluginPath(input.pluginId, "/disable"),
        jsonInit("POST"),
      );
    },
    async enable(input) {
      return requestJson(
        pluginPath(input.pluginId, "/enable"),
        jsonInit("POST"),
      );
    },
    async getSettings(input) {
      return requestJson(pluginPath(input.pluginId, "/settings"));
    },
    async install(input) {
      return requestJson(
        "/api/v1/plugins/install",
        jsonInit("POST", { source: input.source }),
      );
    },
    async list() {
      return requestJson("/api/v1/plugins");
    },
    async reload(input = {}) {
      const query = input.pluginId
        ? `?id=${encodeURIComponent(input.pluginId)}`
        : "";
      return requestJson(`/api/v1/plugins/reload${query}`, jsonInit("POST"));
    },
    async remove(input) {
      return requestJson(pluginPath(input.pluginId), { method: "DELETE" });
    },
    async token(input) {
      return requestJson(
        pluginPath(input.pluginId, "/token"),
        jsonInit("POST", { rotate: input.rotate ?? false }),
      );
    },
    async updateSettings(input) {
      return requestJson(
        pluginPath(input.pluginId, "/settings"),
        jsonInit("PUT", { values: input.values }),
      );
    },
  };
}

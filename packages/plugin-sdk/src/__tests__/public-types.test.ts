import { readFile } from "node:fs/promises";
import { describe, expect, expectTypeOf, it } from "vitest";
import type { BbPluginApi } from "../index.js";

type ExpectedBbPluginApiKey =
  | "agents"
  | "background"
  | "cli"
  | "events"
  | "hosts"
  | "http"
  | "log"
  | "onDispose"
  | "pluginId"
  | "realtime"
  | "rpc"
  | "sdk"
  | "server"
  | "settings"
  | "status"
  | "storage"
  | "ui";

const EXPECTED_BACKEND_ROOT_TYPE_EXPORTS = [
  "BbPluginApi",
  "PluginAgents",
  "PluginAgentConfiguration",
  "PluginAgentConfigurationContext",
  "PluginAgentToolContentPart",
  "PluginAgentToolContext",
  "PluginAgentToolRegistrationBase",
  "PluginAgentToolResult",
  "PluginBackground",
  "PluginCli",
  "PluginCliCommandInfo",
  "PluginCliContext",
  "PluginCliRegistration",
  "PluginCliResult",
  "PluginEvents",
  "PluginHosts",
  "PluginHttp",
  "PluginHttpAuthMode",
  "PluginHttpHandler",
  "PluginInteractionCancelReason",
  "PluginInteractionRequest",
  "PluginInteractionResult",
  "PluginKvStorage",
  "PluginLogger",
  "PluginMentionItem",
  "PluginMentionProviderRegistration",
  "PluginMentionSearchContext",
  "PluginMentionTrigger",
  "PluginRealtime",
  "PluginRpc",
  "PluginServerApi",
  "PluginSettingDescriptor",
  "PluginSettingDescriptors",
  "PluginSettingValue",
  "PluginSettings",
  "PluginSettingsHandle",
  "PluginSettingsValues",
  "PluginSharedPortTunnelIdentity",
  "PluginStatusApi",
  "PluginStorage",
  "PluginThreadActionContext",
  "PluginThreadActionRegistration",
  "PluginThreadActionResult",
  "PluginThreadActionToast",
  "PluginThreadEventHandler",
  "PluginThreadEventName",
  "PluginThreadEventPayloads",
  "PluginUi",
] as const;

const EXPECTED_BACKEND_ROOT_VALUE_EXPORTS: readonly string[] = [];

function namesFromMatches(source: string, pattern: RegExp): string[] {
  return Array.from(source.matchAll(pattern), (match) => match[1]).sort();
}

function rootExportNames(
  declarations: string,
  kind: "type" | "value",
): Set<string> {
  const prefix = kind === "type" ? "export type" : "export";
  const match = declarations.match(
    new RegExp(`^${prefix} \\{ ([^}]+) \\};$`, "mu"),
  );

  expect(match, `${prefix} declaration`).not.toBeNull();
  return new Set(match?.[1].split(", ") ?? []);
}

describe("backend plugin SDK public surface", () => {
  it("snapshots every BbPluginApi root member", () => {
    expectTypeOf<keyof BbPluginApi>().toEqualTypeOf<ExpectedBbPluginApiKey>();
  });

  it("keeps every backend contract export in the root declaration bundle", async () => {
    const [backendContract, declarations] = await Promise.all([
      readFile(new URL("../backend-contract.ts", import.meta.url), "utf8"),
      readFile(
        new URL("../../bundled-types/bb-plugin-sdk.d.ts", import.meta.url),
        "utf8",
      ),
    ]);
    const declaredBackendTypes = namesFromMatches(
      backendContract,
      /^export (?:interface|type) ([A-Za-z0-9_]+)/gmu,
    );
    const declaredBackendValues = namesFromMatches(
      backendContract,
      /^export (?:class|const|function) ([A-Za-z0-9_]+)/gmu,
    );
    const rootTypeExports = rootExportNames(declarations, "type");
    const rootValueExports = rootExportNames(declarations, "value");

    expect(declaredBackendTypes).toEqual(
      [...EXPECTED_BACKEND_ROOT_TYPE_EXPORTS].sort(),
    );
    expect(declaredBackendValues).toEqual(EXPECTED_BACKEND_ROOT_VALUE_EXPORTS);
    for (const exportName of EXPECTED_BACKEND_ROOT_TYPE_EXPORTS) {
      expect(rootTypeExports.has(exportName), exportName).toBe(true);
    }
    for (const exportName of EXPECTED_BACKEND_ROOT_VALUE_EXPORTS) {
      expect(rootValueExports.has(exportName), exportName).toBe(true);
    }
  });
});

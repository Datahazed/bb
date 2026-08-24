import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { JsonValue } from "@get-bb/plugin-sdk/provider-bridge";
import { type FakePiBridgeHarness, startFakePiBridge } from "./test-support.js";

/**
 * Pi's enabled-model preference through the plugin's bridge RPC
 * (`provider/custom` `model-settings/*`) and its effect on `model/list`: the
 * global `settings.json` in the agent dir (`PI_CODING_AGENT_DIR`) is read
 * and written as a file, and the picker leads with the enabled models in
 * pi's cycling order.
 */

let harness: FakePiBridgeHarness;
let agentDir: string;
let nextId = 3000;

beforeEach(async () => {
  harness = await startFakePiBridge({ prefix: "bb-pi-model-settings-", initialize: true });
  agentDir = join(harness.workspaceDir, "agent");
  mkdirSync(agentDir, { recursive: true });
  vi.stubEnv("PI_CODING_AGENT_DIR", agentDir);
}, 90_000);

afterEach(async () => {
  await harness.teardown();
}, 90_000);

function customCall(method: string, input: JsonValue) {
  return harness.request((nextId += 1), "provider/custom", { method, input });
}

it("reads the catalog with no scope, writes exact ids, and scopes the picker", async () => {
  const read = await customCall("model-settings/read", null);
  expect(read.result).toEqual({
    result: {
      models: [
        { id: "fake-provider/fake-model", displayName: "Fake Model", provider: "fake-provider", reasoning: true },
        { id: "fake-provider/fake-mini", displayName: "Fake Mini", provider: "fake-provider", reasoning: false },
      ],
      enabledModelIds: null,
    },
  });
  expect(existsSync(join(agentDir, "settings.json"))).toBe(false);

  const written = await customCall("model-settings/write", {
    enabledModelIds: ["fake-provider/fake-mini"],
  });
  expect(written.result).toMatchObject({ result: { enabledModelIds: ["fake-provider/fake-mini"] } });
  expect(JSON.parse(readFileSync(join(agentDir, "settings.json"), "utf8"))).toEqual({
    enabledModels: ["fake-provider/fake-mini"],
  });

  const listed = await harness.request((nextId += 1), "model/list", { cwd: harness.workspaceDir });
  const result = listed.result as {
    models: { id: string; isDefault: boolean }[];
    selectedOnlyModels: { id: string; isDefault: boolean }[];
  };
  expect(result.models.map((model) => model.id)).toEqual(["fake-provider/fake-mini"]);
  expect(result.models[0]?.isDefault).toBe(true);
  expect(result.selectedOnlyModels.map((model) => model.id)).toEqual(["fake-provider/fake-model"]);
  expect(result.selectedOnlyModels[0]?.isDefault).toBe(false);

  // Enable all: the key is removed, the rest of the file is kept.
  writeFileSync(
    join(agentDir, "settings.json"),
    JSON.stringify({ theme: "dark", enabledModels: ["fake-provider/fake-mini"] }),
  );
  const reset = await customCall("model-settings/write", { enabledModelIds: null });
  expect(reset.result).toMatchObject({ result: { enabledModelIds: null } });
  expect(JSON.parse(readFileSync(join(agentDir, "settings.json"), "utf8"))).toEqual({ theme: "dark" });
}, 90_000);

it("refuses an empty selection or a model this host does not serve", async () => {
  const empty = await customCall("model-settings/write", { enabledModelIds: [] });
  expect(empty.error).toMatchObject({ message: expect.stringContaining("At least one") });
  const unknown = await customCall("model-settings/write", {
    enabledModelIds: ["fake-provider/nope"],
  });
  expect(unknown.error).toMatchObject({ message: expect.stringContaining("not available") });
  const method = await customCall("model-settings/nope", null);
  expect(method.error).toMatchObject({ message: expect.stringContaining("Unknown") });
}, 90_000);

it("honors pi's own patterns and the project file's override when listing", async () => {
  writeFileSync(join(agentDir, "settings.json"), JSON.stringify({ enabledModels: ["fake-provider/*mini*"] }));
  const fromGlobal = await harness.request((nextId += 1), "model/list", { cwd: harness.workspaceDir });
  expect((fromGlobal.result as { models: { id: string }[] }).models.map((m) => m.id)).toEqual([
    "fake-provider/fake-mini",
  ]);

  mkdirSync(join(harness.workspaceDir, ".pi"), { recursive: true });
  writeFileSync(
    join(harness.workspaceDir, ".pi", "settings.json"),
    JSON.stringify({ enabledModels: ["fake-model", "fake-mini"] }),
  );
  const fromProject = await harness.request((nextId += 1), "model/list", { cwd: harness.workspaceDir });
  expect((fromProject.result as { models: { id: string }[] }).models.map((m) => m.id)).toEqual([
    "fake-provider/fake-model",
    "fake-provider/fake-mini",
  ]);
}, 90_000);

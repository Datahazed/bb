import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createAgentRuntimeWithCanonicalProviderDriverFactory } from "./runtime.js";
import { builtinProviderDriverTestFactory } from "./test/builtin-provider-driver-factory.js";

describe("AgentRuntime Codex canonical driver", () => {
  const directories: string[] = [];

  afterEach(() => {
    for (const directory of directories.splice(0)) {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("uses the isolated canonical process for Codex discovery", async () => {
    const directory = mkdtempSync(
      join(tmpdir(), "bb-codex-canonical-runtime-"),
    );
    directories.push(directory);
    const runtime = createAgentRuntimeWithCanonicalProviderDriverFactory(
      {
        workspacePath: directory,
        threadStorageRootPath: join(directory, "thread-storage"),
        onEvent: () => {},
        onToolCall: async () => ({ success: true, contentItems: [] }),
      },
      builtinProviderDriverTestFactory,
    );

    const models = await runtime.listModels({
      providerId: "codex",
      cwd: directory,
    });
    expect(models.models.length).toBeGreaterThan(0);
    expect(runtime.listRunningProviders()).toContain("codex");
    await runtime.shutdown();
  });
});

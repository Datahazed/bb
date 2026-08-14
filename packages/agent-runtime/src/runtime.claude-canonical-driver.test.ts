import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { ThreadEvent } from "@bb/domain";
import { createAgentRuntimeWithCanonicalProviderDriverFactory } from "./runtime.js";
import {
  builtinProviderDriverTestFactory,
  builtinProviderProcessScope,
} from "./test/builtin-provider-driver-factory.js";

describe("AgentRuntime Claude Code canonical driver", () => {
  const directories: string[] = [];

  afterEach(() => {
    for (const directory of directories.splice(0)) {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("uses the isolated canonical process for Claude discovery", async () => {
    const directory = mkdtempSync(
      join(tmpdir(), "bb-claude-canonical-runtime-"),
    );
    directories.push(directory);
    const events: ThreadEvent[] = [];
    const runtime = createAgentRuntimeWithCanonicalProviderDriverFactory(
      {
        workspacePath: directory,
        threadStorageRootPath: join(directory, "thread-storage"),
        onEvent: (event) => events.push(event),
        onToolCall: async () => ({ success: true, contentItems: [] }),
      },
      builtinProviderDriverTestFactory,
      builtinProviderProcessScope,
    );

    const models = await runtime.listModels({
      providerId: "claude-code",
      cwd: directory,
    });
    expect(models.models.length).toBeGreaterThan(0);
    expect(runtime.listRunningProviders()).toContain("claude-code");
    expect(events).toEqual([]);

    await runtime.shutdown();
  });
});

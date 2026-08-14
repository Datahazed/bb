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

describe("AgentRuntime Pi canonical driver", () => {
  const directories: string[] = [];

  afterEach(() => {
    for (const directory of directories.splice(0)) {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("uses the isolated canonical process for Pi discovery", async () => {
    const directory = mkdtempSync(join(tmpdir(), "bb-pi-canonical-runtime-"));
    directories.push(directory);
    const events: ThreadEvent[] = [];
    const runtime = createAgentRuntimeWithCanonicalProviderDriverFactory(
      {
        workspacePath: directory,
        threadStorageRootPath: join(directory, "thread-storage"),
        env: { PI_OFFLINE: "1" },
        onEvent: (event) => events.push(event),
        onToolCall: async () => ({ success: true, contentItems: [] }),
      },
      builtinProviderDriverTestFactory,
      builtinProviderProcessScope,
    );

    const models = await runtime.listModels({
      providerId: "pi",
      cwd: directory,
    });
    expect(
      models.models.length + models.selectedOnlyModels.length,
    ).toBeGreaterThan(0);
    expect(runtime.listRunningProviders()).toContain("pi");
    expect(events).toEqual([]);

    await runtime.shutdown();
  });
});

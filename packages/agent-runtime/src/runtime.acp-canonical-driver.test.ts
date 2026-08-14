import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { ThreadEvent } from "@bb/domain";
import { createAgentRuntimeWithCanonicalProviderDriverFactory } from "./runtime.js";
import {
  builtinProviderDriverLaunchSpec,
  builtinProviderDriverTestFactory,
  builtinProviderProcessScope,
} from "./test/builtin-provider-driver-factory.js";
import { promptTextInput } from "./test/prompt-input.js";
import {
  fullRuntimeOptions,
  waitForRuntimeThreadEvent,
} from "./test/runtime-test-harness.js";

const fakeAgentPath = join(
  import.meta.dirname,
  "../../../plugins/acp/src/fake-acp-agent.mjs",
);

describe("AgentRuntime ACP canonical driver", () => {
  const directories: string[] = [];

  afterEach(() => {
    for (const directory of directories.splice(0)) {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("discovers models and runs a turn through the isolated canonical process", async () => {
    const directory = mkdtempSync(join(tmpdir(), "bb-acp-canonical-runtime-"));
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
    const providerDriver = builtinProviderDriverLaunchSpec("acp-fake", {
      displayName: "Fake ACP",
      command: process.execPath,
      args: [fakeAgentPath],
      env: { FAKE_ACP_MODEL_CONFIG: "1" },
      nativeReasoning: {
        configId: "reasoning_effort",
        supportedLevels: ["none", "low", "medium", "high", "xhigh"],
        defaultLevel: "medium",
      },
    });

    const models = await runtime.listModels({
      providerId: "acp-fake",
      providerDriver,
      cwd: directory,
    });
    expect(models.models.length).toBeGreaterThan(0);

    const { providerThreadId } = await runtime.startThread({
      environmentId: "env-1",
      projectId: "project-1",
      threadId: "thread-1",
      providerId: "acp-fake",
      providerDriver,
      options: {
        ...fullRuntimeOptions,
        model: models.models[0]?.id ?? "fake/default",
        reasoningLevel: models.models[0]?.defaultReasoningEffort ?? "medium",
      },
    });
    await runtime.runTurn({
      threadId: "thread-1",
      clientRequestId: "creq_23456789ab",
      input: [promptTextInput({ text: "hello" })],
      options: {
        ...fullRuntimeOptions,
        model: models.models[0]?.id ?? "fake/default",
        reasoningLevel: models.models[0]?.defaultReasoningEffort ?? "medium",
      },
    });

    await waitForRuntimeThreadEvent({
      events,
      threadId: "thread-1",
      label: "ACP turn completion",
      timeoutMs: 10_000,
      predicate: (event) => event.type === "turn/completed",
    });
    expect(providerThreadId).toMatch(/^fake-sess-/u);
    expect(events.some((event) => event.type === "turn/completed")).toBe(true);
    expect(runtime.listRunningProviders()).toContain("acp-fake");
    await runtime.shutdown();
  }, 15_000);
});

import { describe, expect, it } from "vitest";
import type { DynamicTool } from "@bb/domain";
import type { AgentRuntimeExecutionOptions } from "./types.js";
import { builtinProviderDriverLaunchSpec } from "./test/builtin-provider-driver-factory.js";
import {
  cleanup,
  createTestRuntime,
  getAgentText,
  newThreadId,
  waitForThreadTurnCompleted,
  waitForRuntimeCondition,
  waitForThreadTurnCompletedCount,
} from "./test/runtime-integration-harness.js";
import { promptTextInput } from "./test/prompt-input.js";

const runLiveOpenCodeAcp = process.env.BB_TEST_ACP_OPENCODE === "1";
const providerId = "acp-opencode-live";
const dynamicTool = {
  name: "bb_test_ping",
  description:
    "Returns PONG_FROM_LIVE_ACP_TOOL. Call this tool when explicitly requested.",
  inputSchema: { type: "object", properties: {} },
} satisfies DynamicTool;

function launchSpec() {
  return {
    displayName: "OpenCode (live ACP validation)",
    command: process.env.BB_TEST_ACP_OPENCODE_COMMAND ?? "opencode",
    args: ["acp", "--pure"],
    env: {},
  };
}

async function resolveOptions(args: {
  providerDriver: ReturnType<typeof builtinProviderDriverLaunchSpec>;
  ctx: ReturnType<typeof createTestRuntime>;
}): Promise<AgentRuntimeExecutionOptions> {
  const catalog = await args.ctx.runtime.listModels({
    providerId,
    providerDriver: args.providerDriver,
    cwd: args.ctx.tmpDir,
  });
  const model =
    catalog.models.find((candidate) => candidate.isDefault) ??
    catalog.models[0];
  if (!model) {
    throw new Error("OpenCode ACP returned no available models");
  }
  return {
    model: model.id,
    reasoningLevel: model.defaultReasoningEffort ?? "medium",
    serviceTier: "default",
    providerOptions: {},
    planModeEnabled: false,
    workflowsEnabled: false,
    permissionMode: "full",
    permissionScope: "full",
    approvalReviewer: null,
    permissionEscalation: null,
  };
}

describe.skipIf(!runLiveOpenCodeAcp)("OpenCode live ACP provider", () => {
  it("runs tools and preserves context across process resume", async () => {
    const providerDriver = builtinProviderDriverLaunchSpec(
      providerId,
      launchSpec(),
    );
    const rememberedToken = "BANANA_ACP_RESUME";
    const ctx1 = createTestRuntime(providerId, {
      onToolCall: async (request) => ({
        success: request.tool === dynamicTool.name,
        contentItems: [{ type: "inputText", text: "PONG_FROM_LIVE_ACP_TOOL" }],
      }),
    });
    let ctx2: ReturnType<typeof createTestRuntime> | undefined;

    try {
      const options = await resolveOptions({ providerDriver, ctx: ctx1 });
      const threadId = newThreadId();
      const start = await ctx1.runtime.startThread({
        environmentId: "env-live-acp",
        projectId: "project-live-acp",
        threadId,
        providerId,
        providerDriver,
        options,
        dynamicTools: [dynamicTool],
      });
      expect(start.providerThreadId).toBeTruthy();

      await ctx1.runtime.runTurn({
        threadId,
        clientRequestId: "creq_23456789ab",
        options,
        input: [
          promptTextInput({
            text: `Remember the exact token ${rememberedToken}. Reply only with STORED.`,
          }),
        ],
      });
      await waitForThreadTurnCompleted({
        ctx: ctx1,
        threadId,
        timeoutMs: 90_000,
        label: "OpenCode ACP memory turn/completed",
      });

      await ctx1.runtime.runTurn({
        threadId,
        clientRequestId: "creq_23456789ac",
        options,
        input: [
          promptTextInput({
            text: "Call the bb_test_ping tool now, then reply with its result.",
          }),
        ],
      });
      await waitForRuntimeCondition({
        ctx: ctx1,
        threadId,
        predicate: () =>
          ctx1.toolCalls.some((request) => request.tool === dynamicTool.name),
        timeoutMs: 90_000,
        label: "OpenCode ACP dynamic tool call",
      });
      await waitForThreadTurnCompletedCount({
        ctx: ctx1,
        threadId,
        count: 2,
        timeoutMs: 90_000,
        label: "OpenCode ACP tool turn/completed",
      });

      await ctx1.runtime.shutdown();
      ctx2 = createTestRuntime(providerId, { workspacePath: ctx1.tmpDir });
      await ctx2.runtime.resumeThread({
        environmentId: "env-live-acp",
        projectId: "project-live-acp",
        threadId,
        providerThreadId: start.providerThreadId,
        providerId,
        providerDriver,
        options,
        dynamicTools: [dynamicTool],
      });
      await ctx2.runtime.runTurn({
        threadId,
        clientRequestId: "creq_23456789ad",
        options,
        input: [
          promptTextInput({
            text: "What exact token did I ask you to remember? Reply only with that token.",
          }),
        ],
      });
      await waitForThreadTurnCompleted({
        ctx: ctx2,
        threadId,
        timeoutMs: 90_000,
        label: "OpenCode ACP resumed turn/completed",
      });
      expect(getAgentText(ctx2.events)).toContain(rememberedToken);
    } finally {
      await ctx1.runtime.shutdown();
      if (ctx2) {
        await ctx2.runtime.shutdown();
      }
      cleanup(ctx1);
    }
  }, 240_000);
});

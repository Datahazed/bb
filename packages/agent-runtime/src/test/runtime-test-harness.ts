import type { AgentRuntimeExecutionOptions } from "../types.js";

export {
  waitForRuntimeState,
  waitForRuntimeThreadEvent,
  waitForThreadAgentMessageText,
  waitForThreadTurnCompleted,
  waitForThreadTurnStarted,
} from "./runtime-wait-helpers.js";

export const fullRuntimeOptions = {
  model: "test-model",
  serviceTier: "default",
  reasoningLevel: "medium",
  providerOptions: {},
  planModeEnabled: false,
  workflowsEnabled: false,
  permissionMode: "full",
  permissionScope: "full",
  approvalReviewer: null,
  permissionEscalation: null,
} satisfies AgentRuntimeExecutionOptions;

export function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

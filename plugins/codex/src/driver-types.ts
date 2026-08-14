import type {
  PendingInteractionPayload,
  PendingInteractionResolution,
  ReasoningLevel,
  RuntimePermissionPolicy,
  ServiceTier,
} from "@bb/domain";
import type { JsonObject } from "@bb/domain";

/** Codex-local compatibility shape used by its app-server request builders. */
export type ProviderExecutionContext = {
  model?: string;
  serviceTier?: ServiceTier;
  reasoningLevel?: ReasoningLevel;
  providerOptions: JsonObject;
  workflowsEnabled: boolean;
  memoryEnabled?: boolean;
  providerSubagentsEnabled?: boolean;
  instructions?: string;
  envVars?: Record<string, string>;
} & RuntimePermissionPolicy;

export interface DecodedToolCallRequest {
  requestId: string | number;
  providerThreadId: string;
  turnId: string | null;
  callId: string;
  tool: string;
  arguments?: unknown;
  threadId?: string;
}

export interface DecodedInteractiveRequest {
  requestId: string | number;
  method: string;
  providerThreadId: string;
  turnId: string | null;
  payload: PendingInteractionPayload;
  threadId?: string;
}

export interface BuildInteractiveResponseArgs {
  request: DecodedInteractiveRequest;
  resolution: PendingInteractionResolution;
}

import {
  providerDriverInitializeParamsSchema,
  providerDriverInitializeResultSchema,
  providerSessionOpenParamsSchema,
  providerSessionOpenResultSchema,
  providerTurnSubmitParamsSchema,
  providerTurnSubmitResultSchema,
  type ProviderDriverInitializeParams,
  type ProviderDriverInitializeResult,
  type ProviderSessionOpenParams,
  type ProviderSessionOpenResult,
  type ProviderTurnSubmitParams,
  type ProviderTurnSubmitResult,
} from "../src/index.js";

export function makeInitializeParams(): ProviderDriverInitializeParams {
  return providerDriverInitializeParamsSchema.parse({
    supportedProtocolVersions: [1],
    expected: {
      pluginId: "pi",
      driverId: "pi",
      providerId: "pi",
      artifactDigest: "a".repeat(64),
    },
    host: {
      platform: "darwin",
      architecture: "arm64",
    },
    paths: {
      providerDataDir: "/tmp/provider-data/pi",
    },
    config: {},
  });
}

export function makeInitializeResult(): ProviderDriverInitializeResult {
  return providerDriverInitializeResultSchema.parse({
    protocolVersion: 1,
    identity: {
      pluginId: "pi",
      driverId: "pi",
      providerId: "pi",
    },
    processCapabilities: {
      multiplexSessions: true,
    },
  });
}

export function makeSessionOpenParams(
  overrides: Partial<ProviderSessionOpenParams> = {},
): ProviderSessionOpenParams {
  return providerSessionOpenParamsSchema.parse({
    operationId: "op-session-open-1",
    attachmentId: "attachment-1",
    bbThreadId: "thread-1",
    mode: { kind: "start" },
    workspace: {
      cwd: "/tmp/workspace",
      additionalWriteRoots: [],
      threadStoragePath: "/tmp/thread-storage/thread-1",
    },
    execution: {
      model: "anthropic/claude-test",
      reasoningLevel: "medium",
      serviceTier: "default",
      permission: {
        permissionMode: "full",
        permissionScope: "full",
        approvalReviewer: null,
        permissionEscalation: null,
      },
      features: {
        workflowsEnabled: false,
        memoryEnabled: false,
        subagentsEnabled: true,
      },
      providerOptions: {},
    },
    instructions: {
      mode: "append",
      text: "Follow the workspace instructions.",
    },
    skillSources: [],
    dynamicTools: [],
    disallowedTools: [],
    outputSchema: null,
    shellEnvironment: {},
    ...overrides,
  });
}

export function makeSessionOpenResult(
  overrides: Partial<ProviderSessionOpenResult> = {},
): ProviderSessionOpenResult {
  return providerSessionOpenResultSchema.parse({
    providerSessionId: "provider-session-1",
    sessionFormatVersion: null,
    ...overrides,
  });
}

export function makeStartTurnParams(
  overrides: Partial<ProviderTurnSubmitParams> = {},
): ProviderTurnSubmitParams {
  const session = makeSessionOpenParams();
  return providerTurnSubmitParamsSchema.parse({
    operationId: "op-turn-submit-1",
    clientRequestId: "creq_23456789ab",
    attachmentId: "attachment-1",
    mode: "start",
    turnId: "turn-1",
    inputGroups: [[{ type: "text", text: "Hello", mentions: [] }]],
    execution: session.execution,
    ...overrides,
  });
}

export function makeAcceptedStartResult(
  overrides: Partial<ProviderTurnSubmitResult> = {},
): ProviderTurnSubmitResult {
  return providerTurnSubmitResultSchema.parse({
    outcome: "accepted",
    disposition: "started",
    turnId: "turn-1",
    providerTurnId: null,
    ...overrides,
  });
}

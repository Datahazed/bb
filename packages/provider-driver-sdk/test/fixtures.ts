import {
  providerDriverInitializeParamsSchema,
  providerSessionOpenParamsSchema,
  providerTurnSubmitParamsSchema,
  type ProviderDriverInitializeParams,
  type ProviderSessionOpenParams,
  type ProviderTurnSubmitParams,
} from "@bb/provider-driver-contract";

export function makeInitializeParams(): ProviderDriverInitializeParams {
  return providerDriverInitializeParamsSchema.parse({
    supportedProtocolVersions: [2],
    expected: {
      pluginId: "fake",
      driverId: "fake",
      providerId: "fake",
      artifactDigest: "a".repeat(64),
    },
    host: { platform: "darwin", architecture: "arm64" },
    paths: { providerDataDir: "/tmp/provider-driver-sdk-test" },
    config: {},
  });
}

export function makeSessionOpenParams(): ProviderSessionOpenParams {
  return providerSessionOpenParamsSchema.parse({
    operationId: "open-1",
    attachmentId: "attachment-1",
    bbThreadId: "thread-1",
    mode: { kind: "start" },
    workspace: {
      cwd: "/tmp/workspace",
      additionalWriteRoots: [],
      threadStoragePath: "/tmp/thread-storage",
    },
    execution: {
      model: "fake/model",
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
        subagentsEnabled: false,
      },
      providerOptions: {},
    },
    instructions: { mode: "append", text: "Test instructions" },
    skillSources: [],
    dynamicTools: [],
    disallowedTools: [],
    outputSchema: null,
    shellEnvironment: {},
  });
}

export function makeTurnSubmitParams(): ProviderTurnSubmitParams {
  return providerTurnSubmitParamsSchema.parse({
    operationId: "submit-1",
    clientRequestId: "creq_23456789ab",
    attachmentId: "attachment-1",
    mode: "start",
    turnId: "turn-1",
    inputGroups: [[{ type: "text", text: "Hello", mentions: [] }]],
    execution: makeSessionOpenParams().execution,
  });
}

import {
  defineProviderDriver,
  serveProviderDriverProcess,
} from "@bb/provider-driver-sdk";

const driver = defineProviderDriver({
  identity: {
    pluginId: "test-plugin",
    driverId: "test-driver",
    providerId: "test-provider",
  },
  processCapabilities: { multiplexSessions: true },
  inspect: () => ({
    readiness: { status: "ready" },
    capabilities: {
      multiplexSessions: true,
      supportedSessionOperations: [],
      supportedPermissionModes: ["full"],
      supportsServiceTier: false,
      supportsSteering: true,
      supportsUserQuestions: false,
    },
    models: [],
    selectedOnlyModels: [],
    diagnostics: [],
  }),
  openSession: () => ({
    providerSessionId: "sdk-provider-session",
    sessionFormatVersion: "test-v1",
  }),
  detachSession: () => ({ providerCheckpointId: null }),
  discardSession: () => {},
  submitTurn: (params, context) => {
    const turnId =
      params.mode === "start" ? params.turnId : params.expectedTurnId;
    context.events.emit({
      type: "turn.settled",
      attachmentId: params.attachmentId,
      turnId,
      outcome: "completed",
      error: null,
      providerCheckpointId: "sdk-checkpoint",
    });
    return {
      outcome: "accepted",
      disposition: params.mode === "start" ? "started" : "steered",
      turnId,
      providerTurnId: "sdk-provider-turn",
    };
  },
  cancelTurn: () => ({ outcome: "cancellation_requested" }),
});

serveProviderDriverProcess(driver);

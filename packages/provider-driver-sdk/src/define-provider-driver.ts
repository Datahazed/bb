import {
  providerDriverIdSchema,
  providerDriverPluginIdSchema,
  providerDriverProviderIdSchema,
  type ProviderDriverEvent,
  type ProviderDriverHostInteractionRequestParams,
  type ProviderDriverHostInteractionRequestResult,
  type ProviderDriverHostToolCallParams,
  type ProviderDriverHostToolCallResult,
  type ProviderDriverInitializeParams,
  type ProviderDriverInspectParams,
  type ProviderDriverInspectResult,
  type ProviderDriverOperationResult,
  type ProviderSessionArchiveParams,
  type ProviderSessionClearGoalParams,
  type ProviderSessionCompactParams,
  type ProviderSessionDetachParams,
  type ProviderSessionDetachResult,
  type ProviderSessionDiscardParams,
  type ProviderSessionOpenParams,
  type ProviderSessionOpenResult,
  type ProviderSessionRenameParams,
  type ProviderTurnCancelParams,
  type ProviderTurnCancelResult,
  type ProviderTurnSubmitParams,
  type ProviderTurnSubmitResult,
} from "@bb/provider-driver-contract";

export type ProviderDriverEventInput = ProviderDriverEvent extends infer Event
  ? Event extends ProviderDriverEvent
    ? Omit<Event, "sequence">
    : never
  : never;

export interface ProviderDriverEventEmitter {
  /**
   * Queues one canonical event. The SDK assigns the connection sequence and
   * validates lifecycle scope before writing it to the protocol pipe.
   */
  emit(event: ProviderDriverEventInput): void;
}

export interface ProviderDriverHost {
  callTool(
    params: ProviderDriverHostToolCallParams,
  ): Promise<ProviderDriverHostToolCallResult>;
  requestInteraction(
    params: ProviderDriverHostInteractionRequestParams,
  ): Promise<ProviderDriverHostInteractionRequestResult>;
}

export interface ProviderDriverContext {
  readonly events: ProviderDriverEventEmitter;
  readonly host: ProviderDriverHost;
  readonly initialization: ProviderDriverInitializeParams;
}

export interface ProviderDriverIdentity {
  readonly pluginId: string;
  readonly driverId: string;
  readonly providerId: string;
}

export interface ProviderDriverDefinition {
  readonly identity: ProviderDriverIdentity;
  readonly processCapabilities: {
    readonly multiplexSessions: boolean;
  };

  initialize?(params: ProviderDriverInitializeParams): Promise<void> | void;
  inspect(
    params: ProviderDriverInspectParams,
    context: ProviderDriverContext,
  ): Promise<ProviderDriverInspectResult> | ProviderDriverInspectResult;
  openSession(
    params: ProviderSessionOpenParams,
    context: ProviderDriverContext,
  ): Promise<ProviderSessionOpenResult> | ProviderSessionOpenResult;
  detachSession(
    params: ProviderSessionDetachParams,
    context: ProviderDriverContext,
  ): Promise<ProviderSessionDetachResult> | ProviderSessionDetachResult;
  discardSession(
    params: ProviderSessionDiscardParams,
    context: ProviderDriverContext,
  ): Promise<void> | void;
  submitTurn(
    params: ProviderTurnSubmitParams,
    context: ProviderDriverContext,
  ): Promise<ProviderTurnSubmitResult> | ProviderTurnSubmitResult;
  cancelTurn(
    params: ProviderTurnCancelParams,
    context: ProviderDriverContext,
  ): Promise<ProviderTurnCancelResult> | ProviderTurnCancelResult;

  renameSession?(
    params: ProviderSessionRenameParams,
    context: ProviderDriverContext,
  ): Promise<ProviderDriverOperationResult> | ProviderDriverOperationResult;
  setSessionArchived?(
    params: ProviderSessionArchiveParams,
    context: ProviderDriverContext,
  ): Promise<ProviderDriverOperationResult> | ProviderDriverOperationResult;
  compactSession?(
    params: ProviderSessionCompactParams,
    context: ProviderDriverContext,
  ): Promise<ProviderDriverOperationResult> | ProviderDriverOperationResult;
  clearSessionGoal?(
    params: ProviderSessionClearGoalParams,
    context: ProviderDriverContext,
  ): Promise<ProviderDriverOperationResult> | ProviderDriverOperationResult;
  shutdown?(context: ProviderDriverContext): Promise<void> | void;
}

/** Defines one canonical provider driver and validates its wire identity. */
export function defineProviderDriver(
  definition: ProviderDriverDefinition,
): ProviderDriverDefinition {
  providerDriverPluginIdSchema.parse(definition.identity.pluginId);
  providerDriverIdSchema.parse(definition.identity.driverId);
  providerDriverProviderIdSchema.parse(definition.identity.providerId);
  return definition;
}

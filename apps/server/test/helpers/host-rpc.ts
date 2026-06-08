/**
 * Engine-seam online-RPC responders: bind a handler on the harness's
 * `TestEngineRouting` (the in-process replacement for the daemon's RPC
 * socket). While a responder is registered, RPCs are answered inline from
 * `handle`; unregistering restores the default capture behavior
 * (`pendingOnlineRpcs` + `reportQueuedCommandSuccess`).
 */
import type { AvailableModel, ProviderInfo } from "@bb/domain";
import type {
  HostDaemonOnlineRpcCommand,
  HostDaemonOnlineRpcResult,
  HostDaemonOnlineRpcResultForCommand,
} from "@bb/host-daemon-contract";
import { hostDaemonOnlineRpcResultSchemaByType } from "@bb/host-daemon-contract";
import type { TestAppHarness } from "./test-app.js";

interface ProviderModelResponse {
  models: AvailableModel[];
  selectedOnlyModels: AvailableModel[];
}

interface ProviderModelError {
  errorCode: string;
  errorMessage: string;
}

export interface CapturedOnlineRpcRequest {
  command: HostDaemonOnlineRpcCommand;
}

export interface RegisterProviderHostRpcArgs {
  modelErrorsByProviderId?: Record<string, ProviderModelError>;
  modelsByProviderId?: Record<string, ProviderModelResponse>;
  providers: ProviderInfo[];
}

export type HostRpcHandlerResult =
  | {
      ok: true;
      result: HostDaemonOnlineRpcResult;
    }
  | {
      ok: false;
      errorCode: string;
      errorMessage: string;
    };

export interface RegisterHostRpcResponderArgs {
  handle: (request: CapturedOnlineRpcRequest) => HostRpcHandlerResult;
}

export interface HostRpcResponder {
  requests: CapturedOnlineRpcRequest[];
  unregister(): void;
}

export type ProviderHostRpcResponder = HostRpcResponder;

class HostRpcResponderError extends Error {
  readonly code: string;

  constructor(args: { errorCode: string; errorMessage: string }) {
    super(args.errorMessage);
    this.code = args.errorCode;
  }
}

function buildProviderRpcResult(
  args: RegisterProviderHostRpcArgs,
  request: CapturedOnlineRpcRequest,
): HostRpcHandlerResult {
  if (request.command.type === "provider.list") {
    return { ok: true, result: { providers: args.providers } };
  }
  if (request.command.type !== "provider.list_models") {
    throw new Error(`Unexpected provider RPC command ${request.command.type}`);
  }

  const providerId = request.command.providerId;
  const error = args.modelErrorsByProviderId?.[providerId];
  if (error) {
    return {
      ok: false,
      errorCode: error.errorCode,
      errorMessage: error.errorMessage,
    };
  }

  return {
    ok: true,
    result: args.modelsByProviderId?.[providerId] ?? {
      models: [],
      selectedOnlyModels: [],
    },
  };
}

export function registerHostRpcResponder(
  harness: TestAppHarness,
  args: RegisterHostRpcResponderArgs,
): HostRpcResponder {
  const requests: CapturedOnlineRpcRequest[] = [];
  harness.engineRouting.bindOnlineRpcHandler(async (command) => {
    const request: CapturedOnlineRpcRequest = { command };
    requests.push(request);
    const outcome = args.handle(request);
    if (!outcome.ok) {
      throw new HostRpcResponderError(outcome);
    }
    // The per-type schema guarantees the runtime command/result pairing;
    // TypeScript cannot correlate the parsed union member to the generic.
    return hostDaemonOnlineRpcResultSchemaByType[command.type].parse(
      outcome.result,
    ) as HostDaemonOnlineRpcResultForCommand;
  });

  return {
    requests,
    unregister() {
      harness.engineRouting.unbindOnlineRpcHandler();
    },
  };
}

export function registerProviderHostRpcResponder(
  harness: TestAppHarness,
  args: RegisterProviderHostRpcArgs,
): ProviderHostRpcResponder {
  return registerHostRpcResponder(harness, {
    handle: (request) => buildProviderRpcResult(args, request),
  });
}

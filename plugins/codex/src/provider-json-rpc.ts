export type JsonRpcObject = Record<string, unknown>;

export interface JsonRpcMessage extends JsonRpcObject {
  jsonrpc: "2.0";
  id?: string | number;
  method: string;
  params?: unknown;
}

export interface ProviderInboundRequest {
  id?: string | number;
  method: string;
  params?: unknown;
}

export type ProviderRuntimeEvent = JsonRpcObject;

export const JSON_RPC_INVALID_PARAMS_CODE = -32602;

export class ProviderRequestDecodeError extends Error {
  readonly code = JSON_RPC_INVALID_PARAMS_CODE;

  constructor(message: string) {
    super(message);
    this.name = "ProviderRequestDecodeError";
  }
}

export class ProviderResponseEncodeError extends Error {
  readonly code = JSON_RPC_INVALID_PARAMS_CODE;

  constructor(message: string) {
    super(message);
    this.name = "ProviderResponseEncodeError";
  }
}

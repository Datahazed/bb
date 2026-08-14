import { PROVIDER_DRIVER_MAX_FRAME_BYTES } from "./limits.js";

export const PROVIDER_DRIVER_FRAME_HEADER_BYTES = 4;

export type ProviderDriverFrameErrorCode =
  | "empty_frame"
  | "frame_too_large"
  | "invalid_json"
  | "invalid_utf8"
  | "truncated_frame"
  | "unencodable_message";

export class ProviderDriverFrameError extends Error {
  constructor(
    readonly code: ProviderDriverFrameErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ProviderDriverFrameError";
  }
}

function frameError(
  code: ProviderDriverFrameErrorCode,
  message: string,
): never {
  throw new ProviderDriverFrameError(code, message);
}

/** Encodes one JSON value as a four-byte big-endian length-prefixed frame. */
export function encodeProviderDriverFrame(value: unknown): Uint8Array {
  let json: string | undefined;
  try {
    json = JSON.stringify(value);
  } catch (error) {
    frameError(
      "unencodable_message",
      `Provider driver message is not JSON encodable: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (json === undefined) {
    frameError(
      "unencodable_message",
      "Provider driver message is not JSON encodable",
    );
  }

  const payload = new TextEncoder().encode(json);
  if (payload.length === 0) {
    frameError("empty_frame", "Provider driver frame cannot be empty");
  }
  if (payload.length > PROVIDER_DRIVER_MAX_FRAME_BYTES) {
    frameError(
      "frame_too_large",
      `Provider driver frame is ${payload.length} bytes; maximum is ${PROVIDER_DRIVER_MAX_FRAME_BYTES}`,
    );
  }

  const frame = new Uint8Array(
    PROVIDER_DRIVER_FRAME_HEADER_BYTES + payload.length,
  );
  new DataView(frame.buffer).setUint32(0, payload.length, false);
  frame.set(payload, PROVIDER_DRIVER_FRAME_HEADER_BYTES);
  return frame;
}

/**
 * Incremental decoder for the dedicated provider-driver byte stream.
 * It rejects oversized lengths before buffering the declared payload.
 */
export class ProviderDriverFrameDecoder {
  private readonly header = new Uint8Array(PROVIDER_DRIVER_FRAME_HEADER_BYTES);
  private headerBytes = 0;
  private payload: Uint8Array | null = null;
  private payloadBytes = 0;

  push(chunk: Uint8Array): unknown[] {
    const values: unknown[] = [];
    let offset = 0;

    while (offset < chunk.length) {
      if (this.payload === null) {
        const headerBytesToCopy = Math.min(
          PROVIDER_DRIVER_FRAME_HEADER_BYTES - this.headerBytes,
          chunk.length - offset,
        );
        this.header.set(
          chunk.subarray(offset, offset + headerBytesToCopy),
          this.headerBytes,
        );
        this.headerBytes += headerBytesToCopy;
        offset += headerBytesToCopy;
        if (this.headerBytes < PROVIDER_DRIVER_FRAME_HEADER_BYTES) {
          continue;
        }

        const payloadLength = new DataView(
          this.header.buffer,
          this.header.byteOffset,
          this.header.byteLength,
        ).getUint32(0, false);
        if (payloadLength === 0) {
          frameError("empty_frame", "Provider driver frame cannot be empty");
        }
        if (payloadLength > PROVIDER_DRIVER_MAX_FRAME_BYTES) {
          frameError(
            "frame_too_large",
            `Provider driver frame declares ${payloadLength} bytes; maximum is ${PROVIDER_DRIVER_MAX_FRAME_BYTES}`,
          );
        }
        this.payload = new Uint8Array(payloadLength);
        this.payloadBytes = 0;
      }

      const payloadBytesToCopy = Math.min(
        this.payload.length - this.payloadBytes,
        chunk.length - offset,
      );
      this.payload.set(
        chunk.subarray(offset, offset + payloadBytesToCopy),
        this.payloadBytes,
      );
      this.payloadBytes += payloadBytesToCopy;
      offset += payloadBytesToCopy;
      if (this.payloadBytes < this.payload.length) {
        continue;
      }

      values.push(this.parsePayload(this.payload));
      this.headerBytes = 0;
      this.payload = null;
      this.payloadBytes = 0;
    }
    return values;
  }

  finish(): void {
    if (this.headerBytes !== 0 || this.payload !== null) {
      const incompleteBytes = this.headerBytes + this.payloadBytes;
      frameError(
        "truncated_frame",
        `Provider driver stream ended with ${incompleteBytes} incomplete frame bytes`,
      );
    }
  }

  private parsePayload(payload: Uint8Array): unknown {
    let json: string;
    try {
      json = new TextDecoder("utf-8", { fatal: true }).decode(payload);
    } catch {
      frameError("invalid_utf8", "Provider driver frame is not valid UTF-8");
    }

    try {
      return JSON.parse(json);
    } catch {
      frameError("invalid_json", "Provider driver frame is not valid JSON");
    }
  }
}

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
export function encodeProviderDriverFrame(value: unknown): Buffer {
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

  const payload = Buffer.from(json, "utf8");
  if (payload.length === 0) {
    frameError("empty_frame", "Provider driver frame cannot be empty");
  }
  if (payload.length > PROVIDER_DRIVER_MAX_FRAME_BYTES) {
    frameError(
      "frame_too_large",
      `Provider driver frame is ${payload.length} bytes; maximum is ${PROVIDER_DRIVER_MAX_FRAME_BYTES}`,
    );
  }

  const frame = Buffer.allocUnsafe(
    PROVIDER_DRIVER_FRAME_HEADER_BYTES + payload.length,
  );
  frame.writeUInt32BE(payload.length, 0);
  payload.copy(frame, PROVIDER_DRIVER_FRAME_HEADER_BYTES);
  return frame;
}

/**
 * Incremental decoder for the dedicated provider-driver byte stream.
 * It rejects oversized lengths before buffering the declared payload.
 */
export class ProviderDriverFrameDecoder {
  private readonly header = Buffer.alloc(PROVIDER_DRIVER_FRAME_HEADER_BYTES);
  private headerBytes = 0;
  private payload: Buffer | null = null;
  private payloadBytes = 0;

  push(chunk: Uint8Array): unknown[] {
    const bytes = Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength);
    const values: unknown[] = [];
    let offset = 0;

    while (offset < bytes.length) {
      if (this.payload === null) {
        const headerBytesToCopy = Math.min(
          PROVIDER_DRIVER_FRAME_HEADER_BYTES - this.headerBytes,
          bytes.length - offset,
        );
        bytes.copy(
          this.header,
          this.headerBytes,
          offset,
          offset + headerBytesToCopy,
        );
        this.headerBytes += headerBytesToCopy;
        offset += headerBytesToCopy;
        if (this.headerBytes < PROVIDER_DRIVER_FRAME_HEADER_BYTES) {
          continue;
        }

        const payloadLength = this.header.readUInt32BE(0);
        if (payloadLength === 0) {
          frameError("empty_frame", "Provider driver frame cannot be empty");
        }
        if (payloadLength > PROVIDER_DRIVER_MAX_FRAME_BYTES) {
          frameError(
            "frame_too_large",
            `Provider driver frame declares ${payloadLength} bytes; maximum is ${PROVIDER_DRIVER_MAX_FRAME_BYTES}`,
          );
        }
        this.payload = Buffer.allocUnsafe(payloadLength);
        this.payloadBytes = 0;
      }

      const payloadBytesToCopy = Math.min(
        this.payload.length - this.payloadBytes,
        bytes.length - offset,
      );
      bytes.copy(
        this.payload,
        this.payloadBytes,
        offset,
        offset + payloadBytesToCopy,
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

  private parsePayload(payload: Buffer): unknown {
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

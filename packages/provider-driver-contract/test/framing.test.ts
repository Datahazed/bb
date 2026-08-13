import { describe, expect, it } from "vitest";
import {
  PROVIDER_DRIVER_FRAME_HEADER_BYTES,
  PROVIDER_DRIVER_MAX_FRAME_BYTES,
  ProviderDriverFrameDecoder,
  ProviderDriverFrameError,
  encodeProviderDriverFrame,
} from "../src/index.js";

function expectFrameError(
  work: () => unknown,
  code: ProviderDriverFrameError["code"],
): void {
  try {
    work();
    throw new Error("Expected provider driver frame error");
  } catch (error) {
    expect(error).toBeInstanceOf(ProviderDriverFrameError);
    expect((error as ProviderDriverFrameError).code).toBe(code);
  }
}

describe("provider driver framing", () => {
  it("decodes fragmented and coalesced frames", () => {
    const first = encodeProviderDriverFrame({ id: 1, value: "first" });
    const second = encodeProviderDriverFrame({ id: 2, value: "second" });
    const bytes = Buffer.concat([first, second]);
    const decoder = new ProviderDriverFrameDecoder();

    expect(decoder.push(bytes.subarray(0, 2))).toEqual([]);
    expect(decoder.push(bytes.subarray(2, first.length + 3))).toEqual([
      { id: 1, value: "first" },
    ]);
    expect(decoder.push(bytes.subarray(first.length + 3))).toEqual([
      { id: 2, value: "second" },
    ]);
    decoder.finish();
  });

  it("rejects an oversized declaration before receiving its payload", () => {
    const header = Buffer.alloc(PROVIDER_DRIVER_FRAME_HEADER_BYTES);
    header.writeUInt32BE(PROVIDER_DRIVER_MAX_FRAME_BYTES + 1);
    const decoder = new ProviderDriverFrameDecoder();

    expectFrameError(() => decoder.push(header), "frame_too_large");
  });

  it("rejects invalid UTF-8 and JSON", () => {
    const invalidUtf8 = Buffer.from([0xff]);
    const invalidUtf8Frame = Buffer.concat([
      Buffer.from([0, 0, 0, invalidUtf8.length]),
      invalidUtf8,
    ]);
    expectFrameError(
      () => new ProviderDriverFrameDecoder().push(invalidUtf8Frame),
      "invalid_utf8",
    );

    const invalidJson = Buffer.from("not-json");
    const invalidJsonFrame = Buffer.concat([
      Buffer.from([0, 0, 0, invalidJson.length]),
      invalidJson,
    ]);
    expectFrameError(
      () => new ProviderDriverFrameDecoder().push(invalidJsonFrame),
      "invalid_json",
    );
  });

  it("rejects a truncated final frame", () => {
    const frame = encodeProviderDriverFrame({ id: 1 });
    const decoder = new ProviderDriverFrameDecoder();
    decoder.push(frame.subarray(0, frame.length - 1));
    expectFrameError(() => decoder.finish(), "truncated_frame");
  });
});

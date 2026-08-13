import { describe, expect, it } from "vitest";
import {
  PROVIDER_DRIVER_MAX_FRAME_BYTES,
  providerDriverEventSchema,
  providerDriverInitializeParamsSchema,
  providerDriverRequestSchema,
  providerDriverTurnSettledEventSchema,
  supportsCurrentProviderDriverProtocol,
} from "../src/index.js";
import { makeInitializeParams, makeSessionOpenParams } from "./fixtures.js";

describe("provider driver contract", () => {
  it("requires strict request envelopes", () => {
    const request = {
      jsonrpc: "2.0",
      id: 1,
      method: "session.open",
      params: makeSessionOpenParams(),
    };

    expect(providerDriverRequestSchema.parse(request)).toEqual(request);
    expect(
      providerDriverRequestSchema.safeParse({ ...request, unexpected: true })
        .success,
    ).toBe(false);
  });

  it("validates artifact digests and offered protocol versions", () => {
    const params = makeInitializeParams();
    expect(providerDriverInitializeParamsSchema.parse(params)).toEqual(params);
    expect(
      providerDriverInitializeParamsSchema.safeParse({
        ...params,
        expected: { ...params.expected, artifactDigest: "not-a-digest" },
      }).success,
    ).toBe(false);
    expect(supportsCurrentProviderDriverProtocol([1])).toBe(true);
    expect(supportsCurrentProviderDriverProtocol([2])).toBe(false);
  });

  it("requires a classified error for a failed settlement", () => {
    const base = {
      type: "turn.settled",
      attachmentId: "attachment-1",
      sequence: 1,
      turnId: "turn-1",
      outcome: "failed",
      providerCheckpointId: null,
    };
    expect(
      providerDriverTurnSettledEventSchema.safeParse({ ...base, error: null })
        .success,
    ).toBe(false);
    expect(
      providerDriverTurnSettledEventSchema.safeParse({
        ...base,
        error: {
          code: "provider_rate_limited",
          category: "rate_limit",
          message: "Try again later",
          retry: {
            disposition: "after",
            retryAt: "2026-08-12T13:00:00.000Z",
          },
        },
      }).success,
    ).toBe(true);
  });

  it("does not accept raw provider events as canonical events", () => {
    expect(
      providerDriverEventSchema.safeParse({
        type: "sdk/message",
        attachmentId: "attachment-1",
        sequence: 1,
        message: { type: "agent_end" },
      }).success,
    ).toBe(false);
  });

  it("declares a bounded frame budget", () => {
    expect(PROVIDER_DRIVER_MAX_FRAME_BYTES).toBeGreaterThan(0);
    expect(Number.isSafeInteger(PROVIDER_DRIVER_MAX_FRAME_BYTES)).toBe(true);
  });
});

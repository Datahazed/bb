import { describe, expect, it } from "vitest";
import { parseWorkflowNotificationEnvelope } from "../src/workflow-notification-envelope.js";

describe("parseWorkflowNotificationEnvelope", () => {
  it("extracts workflow identity, status, and the visible result boundary", () => {
    const text = [
      "[BB workflow finished · wfr_123]",
      "",
      "Run wfr_123 (p1-infra) succeeded.",
      'Result: {"verdict":"CONFIRMED"}',
      "Run `bb workflows status wfr_123` for authoritative details.",
    ].join("\n");

    const parsed = parseWorkflowNotificationEnvelope(text);

    expect(parsed).toEqual({
      bodyStart: text.indexOf("Result:"),
      name: "p1-infra",
      runId: "wfr_123",
      status: "succeeded",
    });
  });

  it("supports names with parentheses and every terminal status", () => {
    for (const status of ["failed", "cancelled"] as const) {
      expect(
        parseWorkflowNotificationEnvelope(
          `[BB workflow finished · wfr_x]\r\n\r\nRun wfr_x (release (arm64)) ${status}.\r\nError: stopped`,
        ),
      ).toMatchObject({ name: "release (arm64)", status });
    }
  });

  it("rejects incomplete or mismatched workflow headers", () => {
    expect(
      parseWorkflowNotificationEnvelope(
        "[BB workflow finished · wfr_1]\n\nResult: missing status line",
      ),
    ).toBeNull();
    expect(
      parseWorkflowNotificationEnvelope(
        "[BB workflow finished · wfr_1]\n\nRun wfr_2 (build) succeeded.\nResult: null",
      ),
    ).toBeNull();
  });
});

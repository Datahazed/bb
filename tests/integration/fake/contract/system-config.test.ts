/**
 * Contract tripwire — single-host rebuild plan §6 Phase 0 / §4.1, §4.4.
 *
 * Pins the surfaces the frozen desktop probe (apps/desktop/src/server-probe.ts)
 * requires from the server. The probe schemas are mirrored here LITERALLY
 * instead of importing desktop code or reusing server-contract's
 * systemConfigResponseSchema: the package schema allows `hostDaemonPort: null`
 * (api-types.ts), so it would not trip the regression the desktop actually
 * breaks on. These tests must keep passing unchanged after the host-daemon
 * merges into the server.
 */
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { withHarness } from "../../helpers/harness.js";

// Mirror of apps/desktop/src/server-probe.ts healthResponseSchema.
const desktopProbeHealthSchema = z
  .object({
    ok: z.boolean(),
  })
  .passthrough();

// Mirror of apps/desktop/src/server-probe.ts systemConfigResponseSchema.
const desktopProbeSystemConfigSchema = z
  .object({
    hostDaemonPort: z.number().int().min(1).max(65_535),
    voiceTranscriptionEnabled: z.boolean(),
  })
  .passthrough();

describe("contract: desktop server probe", () => {
  it("GET /health serves JSON {ok:true} as the desktop probe requires", async () => {
    await withHarness(async (harness) => {
      const response = await fetch(`${harness.serverUrl}/health`);

      expect(response.status).toBe(200);
      // A wrong content-type or HTML body (SPA catch-all) makes the desktop
      // shell conclude the server is incompatible — assert it explicitly.
      expect(response.headers.get("content-type")).toContain(
        "application/json",
      );
      const health = desktopProbeHealthSchema.parse(await response.json());
      expect(health.ok).toBe(true);
    });
  });

  it("GET /api/v1/system/config keeps hostDaemonPort and voiceTranscriptionEnabled probe-compatible", async () => {
    await withHarness(async (harness) => {
      const response = await fetch(
        `${harness.serverUrl}/api/v1/system/config`,
      );

      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toContain(
        "application/json",
      );
      // The desktop probe hard-requires a non-null int port and a boolean
      // voice flag; a `null` hostDaemonPort bricks attach-vs-own detection
      // even though the public API schema would tolerate it.
      //
      // Deliberately NOT asserted: hostDaemonPort === the daemon local API's
      // bound port. The harness configures a dummy port today, and after the
      // single-host merge the value becomes the server's own port — only the
      // probe SHAPE is frozen.
      desktopProbeSystemConfigSchema.parse(await response.json());
    });
  });
});

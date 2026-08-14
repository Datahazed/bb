import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { internalAuthHeaders } from "../helpers/commands.js";
import { withTestHarness } from "../helpers/test-app.js";

describe("internal provider driver artifacts", () => {
  it("serves only a loaded plugin's digest over daemon-authenticated transport", async () => {
    await withTestHarness(async (harness) => {
      const pluginRoot = join(harness.config.dataDir, "driver-plugin");
      await mkdir(pluginRoot, { recursive: true });
      await writeFile(
        join(pluginRoot, "package.json"),
        JSON.stringify({
          name: "bb-plugin-echo-driver",
          version: "1.0.0",
          type: "module",
          bb: {
            name: "Echo driver",
            description: "Internal artifact route fixture.",
            branding: { icon: "Code" },
            server: "./server.ts",
            experimental_hostDrivers: [
              { id: "echo", entry: "./echo-driver.ts" },
            ],
          },
        }),
      );
      await writeFile(
        join(pluginRoot, "server.ts"),
        "export default function plugin() {}\n",
      );
      await writeFile(
        join(pluginRoot, "echo-driver.ts"),
        'console.error("echo driver");\n',
      );
      await harness.pluginService.installPath(pluginRoot);
      const [artifact] = harness.pluginService.listHostDriverArtifacts();
      if (artifact === undefined) throw new Error("artifact missing");
      const path = `/internal/provider-drivers/artifacts/${artifact.descriptor.digest}`;

      expect((await harness.app.request(path)).status).toBe(401);
      const response = await harness.app.request(path, {
        headers: internalAuthHeaders(harness, { hostId: "host-artifact" }),
      });
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toContain(
        "application/gzip",
      );
      expect(response.headers.get("x-bb-artifact-digest")).toBe(
        artifact.descriptor.digest,
      );
      expect((await response.arrayBuffer()).byteLength).toBe(
        artifact.sizeBytes,
      );

      await harness.pluginService.setEnabled("echo-driver", false);
      expect(
        (
          await harness.app.request(path, {
            headers: internalAuthHeaders(harness, {
              hostId: "host-artifact",
            }),
          })
        ).status,
      ).toBe(404);
    });
  });
});

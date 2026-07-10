import { describe, expect, it } from "vitest";
import { fetchPluginList } from "./plugin-settings-queries";

describe("fetchPluginList", () => {
  it("preserves the plugin root directory used by overview Edit actions", async () => {
    const plugins = await fetchPluginList(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        plugins: [
          {
            id: "linear",
            source: "path:/plugins/linear",
            rootDir: "/plugins/linear",
            version: "0.1.0",
            enabled: true,
            status: "running",
            statusDetail: null,
            description: "Linear integration.",
            logoUrl: null,
            logoDarkUrl: null,
          },
        ],
      }),
    }));

    expect(plugins).toHaveLength(1);
    expect(plugins[0]?.source).toBe("path:/plugins/linear");
    expect(plugins[0]?.rootDir).toBe("/plugins/linear");
  });

  it("keeps older plugin-list responses usable without a root directory", async () => {
    const plugins = await fetchPluginList(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        plugins: [
          {
            id: "legacy",
            version: "0.1.0",
            enabled: false,
            status: "disabled",
            statusDetail: null,
          },
        ],
      }),
    }));

    expect(plugins).toHaveLength(1);
    expect(plugins[0]?.source).toBeNull();
    expect(plugins[0]?.rootDir).toBeNull();
  });
});

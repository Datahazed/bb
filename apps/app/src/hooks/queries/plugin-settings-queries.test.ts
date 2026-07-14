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
            handlerStats: {
              count: 4,
              totalMs: 12,
              maxMs: 5,
              errorCount: 1,
            },
            services: [{ name: "sync", state: "backoff" }],
            schedules: [
              {
                name: "refresh",
                cron: "*/5 * * * *",
                nextRunAt: 200,
                lastRunAt: 100,
                lastStatus: "error",
                lastError: "rate limited",
              },
            ],
            cliCommand: { name: "linear", summary: "Manage Linear" },
            app: { hasApp: true, bundle: null },
          },
        ],
      }),
    }));

    expect(plugins).toHaveLength(1);
    expect(plugins[0]?.source).toBe("path:/plugins/linear");
    expect(plugins[0]?.isBuiltin).toBe(false);
    expect(plugins[0]?.rootDir).toBe("/plugins/linear");
    expect(plugins[0]?.handlerStats.errorCount).toBe(1);
    expect(plugins[0]?.services).toEqual([{ name: "sync", state: "backoff" }]);
    expect(plugins[0]?.schedules[0]?.lastError).toBe("rate limited");
    expect(plugins[0]?.cliCommand?.name).toBe("linear");
    expect(plugins[0]?.app.hasApp).toBe(true);
  });

  it("identifies built-in plugins from their authoritative source", async () => {
    const plugins = await fetchPluginList(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        plugins: [
          {
            id: "connect",
            source: "builtin:connect",
            rootDir: "/app/builtin-plugins/connect",
            version: "0.2.0",
            enabled: true,
            status: "running",
            statusDetail: null,
          },
        ],
      }),
    }));

    expect(plugins[0]?.isBuiltin).toBe(true);
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
    expect(plugins[0]?.isBuiltin).toBe(false);
    expect(plugins[0]?.rootDir).toBeNull();
    expect(plugins[0]?.services).toEqual([]);
    expect(plugins[0]?.schedules).toEqual([]);
    expect(plugins[0]?.app.hasApp).toBe(false);
  });
});

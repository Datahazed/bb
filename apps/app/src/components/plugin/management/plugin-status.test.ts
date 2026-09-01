import { describe, expect, it } from "vitest";
import {
  EMPTY_PLUGIN_UPDATE_STATE,
  type PluginListItem,
  type PluginUpdateState,
} from "@/hooks/queries/plugin-settings-queries";
import {
  installedPluginProblemLine,
  pluginRowSignal,
  pluginRuntimeStatusPresentation,
} from "./plugin-status";

function plugin(
  updateState: Partial<PluginUpdateState> = {},
  overrides: Partial<PluginListItem> = {},
): PluginListItem {
  return {
    id: "linear",
    source: "npm:@example/linear@^1.6.0",
    rootDir: "/plugins/linear",
    version: "1.6.2",
    enabled: true,
    status: "running",
    statusDetail: null,
    lastProblem: null,
    categoryId: null,
    category: null,
    description: null,
    name: null,
    icon: null,
    compactIconUrl: null,
    logoUrl: null,
    logoDarkUrl: null,
    hasSettings: false,
    provenance: "catalog",
    isOrphanedBuiltin: false,
    catalogEntryId: "linear",
    publisherLabel: "BB Community",
    sourceDisplay: "npm · @bb-plugins/linear · tracks compatible",
    updateState: { ...EMPTY_PLUGIN_UPDATE_STATE, ...updateState },
    handlerStats: { count: 0, totalMs: 0, maxMs: 0, errorCount: 0 },
    services: [],
    schedules: [],
    cliCommand: null,
    capabilities: [],
    app: { hasApp: false, bundle: null },
    ...overrides,
  };
}

describe("pluginRowSignal (the one-signal rule)", () => {
  it("badges an available compatible update", () => {
    expect(pluginRowSignal(plugin({ availableVersion: "1.7.0" }))).toEqual({
      kind: "update",
      version: "1.7.0",
      retry: false,
    });
  });

  it("never badges a newer-but-incompatible release", () => {
    expect(
      pluginRowSignal(
        plugin({
          blockedVersion: "1.9.0",
          blockedReasons: ["requires bb >= 0.15"],
        }),
      ),
    ).toBeNull();
  });

  it("never badges a pinned/quiet plugin", () => {
    expect(pluginRowSignal(plugin())).toBeNull();
  });

  it("surfaces an update-source security refusal", () => {
    expect(
      pluginRowSignal(
        plugin({
          outcome: "unavailable",
          detail:
            "The cached checkout does not prove that this ref was a branch.",
        }),
      ),
    ).toEqual({
      kind: "status",
      icon: "AlertTriangle",
      label: "Needs attention",
      tone: "warning",
      detail: "The cached checkout does not prove that this ref was a branch.",
    });
  });

  it("names a rolled-back update and lets it outrank an available update", () => {
    expect(
      pluginRowSignal(
        plugin({
          availableVersion: "1.7.0",
          lastFailure: { version: "1.7.0", at: 1, detail: "boom" },
        }),
      ),
    ).toEqual({
      kind: "status",
      icon: "RotateCcw",
      label: "Update failed",
      tone: "error",
      detail: "boom",
    });
  });

  it.each([
    ["error", "CircleX", "Failed", "error"],
    ["incompatible", "AlertCircle", "Incompatible", "error"],
    ["missing", "FileQuestion", "Missing", "error"],
    ["needs-configuration", "Settings", "Needs configuration", "warning"],
    ["degraded", "AlertTriangle", "Degraded", "warning"],
  ] as const)(
    "names the %s runtime status instead of collapsing it into attention",
    (status, icon, label, tone) => {
      expect(
        pluginRowSignal(
          plugin(
            {},
            { status, statusDetail: `${status} detail from the server` },
          ),
        ),
      ).toEqual({
        kind: "status",
        icon,
        label,
        tone,
        detail: `${status} detail from the server`,
      });
    },
  );

  it("provides a useful rollback explanation when the server has no detail", () => {
    expect(
      pluginRowSignal(
        plugin({
          lastFailure: { version: "1.7.0", at: 1, detail: "" },
        }),
      ),
    ).toEqual({
      kind: "status",
      icon: "RotateCcw",
      label: "Update failed",
      tone: "error",
      detail: "Update to 1.7.0 failed and was rolled back.",
    });
  });
});

describe("pluginRuntimeStatusPresentation", () => {
  it("keeps healthy and disabled lifecycle states quiet", () => {
    expect(pluginRuntimeStatusPresentation(plugin())).toBeNull();
    expect(
      pluginRuntimeStatusPresentation(
        plugin({}, { enabled: false, status: "disabled" }),
      ),
    ).toBeNull();
  });

  it("gives local and installed plugin errors appropriate recovery", () => {
    expect(
      pluginRuntimeStatusPresentation(
        plugin({}, { status: "error", source: "path:/plugins/linear" }),
      ),
    ).toMatchObject({
      label: "Failed",
      condition: "The plugin couldn't start.",
      recovery: "Fix the plugin, then reload it.",
    });
    expect(
      pluginRuntimeStatusPresentation(plugin({}, { status: "error" })),
    ).toMatchObject({
      label: "Failed",
      condition: "The plugin couldn't start.",
      recovery:
        "Reload the plugin. If it still fails, remove it and install it again.",
    });
  });

  it("gives missing bundled and installed plugins source-appropriate recovery", () => {
    expect(
      pluginRuntimeStatusPresentation(
        plugin(
          {},
          {
            status: "missing",
            provenance: "builtin",
            source: "builtin:linear",
          },
        ),
      ),
    ).toMatchObject({
      recovery: "Restart bb. If the files are still missing, reinstall bb.",
    });
    expect(
      pluginRuntimeStatusPresentation(plugin({}, { status: "missing" })),
    ).toMatchObject({
      recovery: "Remove the plugin, then install it again from its source.",
    });
  });

  it("explains that saved settings automatically retry configuration", () => {
    expect(
      pluginRuntimeStatusPresentation(
        plugin({}, { status: "needs-configuration", hasSettings: true }),
      ),
    ).toMatchObject({
      label: "Needs configuration",
      condition: "Required settings are incomplete.",
      recovery:
        "Open Settings to finish configuration; bb reloads the plugin after you save.",
    });
  });
});

describe("installedPluginProblemLine", () => {
  const now = Date.UTC(2026, 7, 25, 12, 0, 0);
  const at = now - 2 * 60 * 1000;
  const lastProblem = (status: PluginListItem["status"], message: string) => ({
    class: status,
    message,
    at,
  });

  it("keeps healthy running and disabled rows quiet", () => {
    expect(installedPluginProblemLine(plugin(), now)).toBeNull();
    expect(
      installedPluginProblemLine(
        plugin(
          {},
          {
            enabled: false,
            status: "disabled",
            lastProblem: lastProblem("error", "old failure"),
          },
        ),
        now,
      ),
    ).toBeNull();
  });

  it.each([
    [
      "incompatible",
      "requires bb >=0.40",
      "Not running — requires bb >=0.40 · 2m ago",
      "error",
    ],
    [
      "error",
      "startup exploded\nprivate stack",
      "Not running — crashed on load: startup exploded · 2m ago",
      "error",
    ],
    [
      "missing",
      "missing artifact",
      "Not running — source missing at /plugins/linear · 2m ago",
      "error",
    ],
    [
      "degraded",
      "service sync did not stop",
      "Partly running — service sync did not stop · 2m ago",
      "warning",
    ],
    [
      "needs-configuration",
      "Set an API token",
      "Not running — needs configuration → its Settings · 2m ago",
      "warning",
    ],
  ] as const)(
    "renders one compact %s problem clause instead of the description",
    (status, message, text, tone) => {
      expect(
        installedPluginProblemLine(
          plugin(
            {},
            {
              status,
              statusDetail: message,
              lastProblem: lastProblem(status, message),
            },
          ),
          now,
        ),
      ).toEqual({ text, tone, attentionCount: null });
    },
  );

  it("reports durable handler errors on an otherwise running plugin", () => {
    expect(
      installedPluginProblemLine(
        plugin(
          {},
          {
            handlerStats: {
              count: 0,
              totalMs: 0,
              maxMs: 0,
              errorCount: 3,
            },
            lastProblem: lastProblem("error", "request failed"),
          },
        ),
        now,
      ),
    ).toEqual({
      text: ", last 2m ago — request failed",
      tone: "warning",
      attentionCount: "3 errors",
    });
  });

  it("explains a failed reload while the previous version keeps running", () => {
    expect(
      installedPluginProblemLine(
        plugin(
          {},
          {
            statusDetail: "reload failed: invalid export",
            lastProblem: lastProblem("error", "invalid export"),
          },
        ),
        now,
      ),
    ).toEqual({
      text: "Running the previous version — reload failed: invalid export · 2m ago",
      tone: "error",
      attentionCount: null,
    });
  });
});

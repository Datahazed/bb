import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { planPluginScreenshots } from "../plugin-screenshot.js";

/** The plugins bb ships, which are the closest thing to real submissions. */
const PLUGINS_DIR = new URL("../../../../plugins", import.meta.url).pathname;
const plan = (name: string, pluginId: string, fixtureThreadId?: string) =>
  planPluginScreenshots({
    rootDir: join(PLUGINS_DIR, name),
    pluginId,
    ...(fixtureThreadId === undefined ? {} : { fixtureThreadId }),
  });

describe("planPluginScreenshots", () => {
  it("leads a panel plugin's listing with its own panel", async () => {
    const result = await plan("tasks", "tasks");
    expect(result.steps[0]).toMatchObject({
      slot: "navPanel",
      url: "/plugins/tasks/tasks",
      outputFile: "01-panel.png",
    });
  });

  it("plans nothing for a plugin that paints nothing, and does not fail", async () => {
    // provider-retry continues turns after a limit resets. A listing for it
    // should never be held up waiting for a screenshot that cannot exist.
    const result = await plan("provider-retry", "provider-retry");
    expect(result.steps.filter((step) => step.kind === "route")).toEqual([]);
  });

  it("reports fixture-only surfaces instead of photographing an empty app", async () => {
    const withoutFixture = await plan("inline-vis", "inline-vis");
    expect(withoutFixture.steps).toEqual([]);
    expect(withoutFixture.needsFixture).toContain("messageDirective");

    const withFixture = await plan("inline-vis", "inline-vis", "thr_fixture");
    expect(withFixture.needsFixture).toEqual([]);
    expect(withFixture.steps).toEqual([
      {
        slot: "messageDirective",
        kind: "fixture",
        url: "/threads/thr_fixture",
        outputFile: "06-message.png",
        requires: "a thread whose last message carries the plugin's directive",
      },
    ]);
  });

  it("uses the plugin's real id in the panel URL, not its directory name", async () => {
    // The docs plugin installs as `simple-notes`; a URL built from the folder
    // would 404 for every listing screenshot it takes.
    const result = await plan("docs", "simple-notes");
    expect(result.steps[0]?.url).toBe("/plugins/simple-notes/docs");
  });

  it("ignores a plugin's vendored SDK declarations", async () => {
    // Every plugin vendors types/ that mention every slot in the SDK. Reading
    // those would plan a screenshot of every surface for every plugin.
    const result = await plan("provider-codex", "provider-codex");
    expect(result.slots).not.toContain("navPanel");
    expect(result.slots).not.toContain("homepageSection");
  });
});

describe("the capture harness planner", async () => {
  const { createRequire } = await import("node:module");
  const requireCjs = createRequire(import.meta.url);
  const harness = requireCjs(
    "../../../desktop/scripts/plugin-capture.cjs",
  ) as {
    planSteps: (
      plan: {
        pluginId: string;
        surfaces: ReadonlyArray<{
          slot: string;
          kind: string;
          route: string;
          stem: string;
        }>;
        fixtureThreadId?: string;
      },
      slotIndex: Record<
        string,
        Array<{ pluginId: string; path?: string | null }>
      >,
    ) => Array<{ slot: string; url: string; outputFile: string }>;
    SNAPSHOT_KEYS: Record<string, string>;
  };

  it("maps every capturable surface to a live snapshot key", async () => {
    const { PLUGIN_CAPTURE_SURFACES } = await import("@bb/domain");
    for (const surface of PLUGIN_CAPTURE_SURFACES) {
      expect(harness.SNAPSHOT_KEYS[surface.slot], surface.slot).toBeTruthy();
    }
  });

  it("shoots only the target plugin's registrations", () => {
    const steps = harness.planSteps(
      {
        pluginId: "tasks",
        surfaces: [
          {
            slot: "navPanel",
            kind: "route",
            route: "/plugins/:pluginId/:panelPath",
            stem: "01-panel",
          },
        ],
      },
      {
        navPanels: [
          { pluginId: "tasks", path: "/board" },
          { pluginId: "someone-else", path: "other" },
        ],
      },
    );
    expect(steps).toEqual([
      { slot: "navPanel", url: "/plugins/tasks/board", outputFile: "01-panel.png" },
    ]);
  });

  it("skips fixture surfaces without a fixture thread, like the CLI planner", () => {
    const surfaces = [
      {
        slot: "messageDirective",
        kind: "fixture",
        route: "/threads/:threadId",
        stem: "06-message",
      },
    ];
    const slotIndex = { messageDirectives: [{ pluginId: "tasks" }] };
    expect(
      harness.planSteps({ pluginId: "tasks", surfaces }, slotIndex),
    ).toEqual([]);
    expect(
      harness.planSteps(
        { pluginId: "tasks", surfaces, fixtureThreadId: "thr_1" },
        slotIndex,
      ),
    ).toEqual([
      {
        slot: "messageDirective",
        url: "/threads/thr_1",
        outputFile: "06-message.png",
      },
    ]);
  });
});

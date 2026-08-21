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

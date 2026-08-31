import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  planPluginScreenshots,
  resolvePluginCaptureHarnessPath,
  runPluginCapture,
} from "../plugin-screenshot.js";
import {
  collectLogPayloads,
  getHelpOutput,
  runCommand,
  setupCommandOutputTestEnvironment,
  type CommandRegistrar,
} from "./helpers/command-output-harness.js";
import { registerPluginCommands } from "../commands/plugin.js";

const PLUGINS_DIR = new URL("../../../../plugins", import.meta.url).pathname;
const plan = (name: string, pluginId: string, fixtureThreadId?: string) =>
  planPluginScreenshots({
    rootDir: join(PLUGINS_DIR, name),
    pluginId,
    ...(fixtureThreadId === undefined ? {} : { fixtureThreadId }),
  });
const tempDirs: string[] = [];

async function makeTempDir(prefix: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), prefix));
  tempDirs.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(
    tempDirs
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
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
    const result = await plan("docs", "simple-notes");
    expect(result.steps[0]?.url).toBe("/plugins/simple-notes/docs");
  });

  it("ignores a plugin's vendored SDK declarations", async () => {
    const result = await plan("provider-codex", "provider-codex");
    expect(result.slots).not.toContain("navPanel");
    expect(result.slots).not.toContain("homepageSection");
  });
});

describe("bb plugin screenshot", () => {
  setupCommandOutputTestEnvironment();
  const register: CommandRegistrar = (program) =>
    registerPluginCommands(program, () => "http://server");

  it("documents planning, capture, app-origin, and fixture controls in help", async () => {
    const help = await getHelpOutput(["plugin", "screenshot"], register);
    expect(help).toContain("bb plugin screenshot [options] [path]");
    expect(help).toContain("--capture <outDir>");
    expect(help).toContain("--app-url <url>");
    expect(help).toContain("--fixture-thread <id>");
    expect(help).toContain("--json");
  });

  it("prints reachable shots and explicitly reports fixture-only surfaces", async () => {
    const pluginDir = await makeTempDir("bb-plugin-screenshot-command-");
    await writeFile(
      join(pluginDir, "package.json"),
      JSON.stringify({ name: "@acme/bb-plugin-showcase" }),
    );
    await writeFile(
      join(pluginDir, "app.tsx"),
      `app.slots.navPanel({ path: "showcase", component: Showcase });\n` +
        `app.slots.messageDirective({ id: "showcase", component: Message });\n`,
    );

    await runCommand(["plugin", "screenshot", pluginDir], register);

    expect(collectLogPayloads(vi.mocked(console.log))).toEqual([
      "01-panel.png  /plugins/showcase/showcase  (navPanel)",
      "skipped messageDirective — needs the capture fixture; pass --fixture-thread <id>",
    ]);
  });

  it("runs capture and emits its report when JSON output is requested", async () => {
    const pluginDir = await makeTempDir("bb-plugin-screenshot-command-");
    const harnessDir = await makeTempDir("bb-plugin-screenshot-harness-");
    const electronBinary = join(harnessDir, "electron-stub");
    const invocationPath = join(harnessDir, "invocation.json");
    const outDir = join(harnessDir, "shots");
    await writeFile(
      join(pluginDir, "package.json"),
      JSON.stringify({ name: "@acme/bb-plugin-showcase" }),
    );
    await writeFile(
      join(pluginDir, "app.tsx"),
      `app.slots.navPanel({ path: "showcase", component: Showcase });\n`,
    );
    await writeFile(
      electronBinary,
      `#!/usr/bin/env node\n` +
        `const { readFileSync, writeFileSync } = require("node:fs");\n` +
        `const harnessPath = process.argv[2];\n` +
        `const plan = JSON.parse(readFileSync(process.argv[3], "utf8"));\n` +
        `writeFileSync(${JSON.stringify(invocationPath)}, JSON.stringify({ harnessPath, plan }));\n` +
        `process.stdout.write(JSON.stringify({ pluginId: plan.pluginId, written: [{ slot: "navPanel", url: plan.appUrl + "/plugins/showcase/showcase", file: plan.outDir + "/01-panel.png" }] }));\n`,
    );
    await chmod(electronBinary, 0o755);
    vi.stubEnv("BB_ELECTRON", electronBinary);

    await runCommand(
      ["plugin", "screenshot", pluginDir, "--json", "--capture", outDir],
      register,
    );

    const invocation = JSON.parse(await readFile(invocationPath, "utf8")) as {
      harnessPath: string;
      plan: { pluginId: string; outDir: string };
    };
    expect(invocation.harnessPath).toMatch(/plugin-capture\.cjs$/u);
    expect(invocation.plan).toMatchObject({
      pluginId: "showcase",
      outDir,
    });
    expect(
      JSON.parse(collectLogPayloads(vi.mocked(console.log))[0] ?? ""),
    ).toEqual({
      pluginId: "showcase",
      written: [
        {
          slot: "navPanel",
          url: "http://server/plugins/showcase/showcase",
          file: `${outDir}/01-panel.png`,
        },
      ],
    });
  });

  it("passes the app origin and output directory to the capture process", async () => {
    const harnessDir = await makeTempDir("bb-plugin-screenshot-runner-");
    const harnessPath = join(harnessDir, "capture.mjs");
    const outDir = join(harnessDir, "shots");
    await writeFile(
      harnessPath,
      `import { readFileSync } from "node:fs";\n` +
        `const plan = JSON.parse(readFileSync(process.argv.at(-1), "utf8"));\n` +
        `process.stdout.write(JSON.stringify({ pluginId: plan.pluginId, written: [{ slot: "navPanel", url: plan.appUrl, file: plan.outDir + "/01-panel.png" }] }));\n`,
    );

    const report = await runPluginCapture({
      appUrl: "http://vite.test:5173",
      pluginId: "showcase",
      outDir,
      harnessPath,
      electronBinary: process.execPath,
    });

    expect(report).toEqual({
      pluginId: "showcase",
      written: [
        {
          slot: "navPanel",
          url: "http://vite.test:5173",
          file: `${outDir}/01-panel.png`,
        },
      ],
    });
    expect(await readFile(harnessPath, "utf8")).toContain("plan.appUrl");
  });

  it("resolves the capture harness from the command module's directory", async () => {
    const commandsDir = new URL("../commands/", import.meta.url).pathname;
    const harnessPath = resolvePluginCaptureHarnessPath(commandsDir);

    expect(await readFile(harnessPath, "utf8")).toContain(
      "Listing-screenshot capture harness",
    );
  });
});

describe("the capture harness planner", async () => {
  const { createRequire } = await import("node:module");
  const requireCjs = createRequire(import.meta.url);
  const harness = requireCjs("../../../desktop/scripts/plugin-capture.cjs") as {
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
      {
        slot: "navPanel",
        url: "/plugins/tasks/board",
        outputFile: "01-panel.png",
      },
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

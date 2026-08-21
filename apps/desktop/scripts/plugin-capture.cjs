/**
 * Listing-screenshot capture harness for `bb plugin screenshot --capture`.
 *
 * Runs under the desktop package's Electron. One invocation:
 *   electron plugin-capture.cjs <plan.json>
 *
 * The plan carries the server URL, the plugin id, the output directory, and
 * the surface catalog (routes + file stems). Which surfaces the plugin
 * actually registered is read from the running app itself via the
 * `__bbPluginSlotSnapshot` hook — the author has the plugin installed, so the
 * renderer is the source of truth; nothing here parses plugin source.
 *
 * Writes one PNG per planned surface and prints a JSON report to stdout.
 */
const { mkdirSync, readFileSync, writeFileSync } = require("node:fs");
const { join } = require("node:path");

const WIDTH = 1440;
const HEIGHT = 900;
const QUIET_MS = 700;
const QUIET_TIMEOUT_MS = 10000;
const READY_TIMEOUT_MS = 20000;

/** Snapshot arrays are keyed by plural slot names; the catalog by slot name. */
const SNAPSHOT_KEYS = {
  navPanel: "navPanels",
  homepageSection: "homepageSections",
  settingsSection: "settingsSections",
  experimental_threadList: "threadLists",
  sidebarFooterAction: "sidebarFooterActions",
  messageDirective: "messageDirectives",
  threadPanelAction: "threadPanelActions",
  experimental_threadHeaderAction: "threadHeaderActions",
  "composer.customize": "composerCustomizations",
  pendingInteraction: "pendingInteractions",
  fileOpener: "fileOpeners",
};

/** Which catalog surfaces this plugin registered, plus its nav panel paths. */
function planSteps(plan, slotIndex) {
  const steps = [];
  for (const surface of plan.surfaces) {
    const registrations = slotIndex[SNAPSHOT_KEYS[surface.slot] ?? ""] ?? [];
    const mine = registrations.filter((r) => r.pluginId === plan.pluginId);
    if (mine.length === 0) continue;
    if (surface.kind === "fixture" && !plan.fixtureThreadId) continue;

    if (surface.route.includes(":panelPath")) {
      mine.forEach((reg, index) => {
        const panelPath = String(reg.path ?? "").replace(/^\/+/, "");
        if (panelPath === "") return;
        steps.push({
          slot: surface.slot,
          url: surface.route
            .replace(":pluginId", plan.pluginId)
            .replace(":panelPath", panelPath),
          outputFile:
            mine.length > 1
              ? `${surface.stem}-${index + 1}.png`
              : `${surface.stem}.png`,
        });
      });
      continue;
    }
    steps.push({
      slot: surface.slot,
      url: surface.route
        .replace(":pluginId", plan.pluginId)
        .replace(":threadId", plan.fixtureThreadId ?? ""),
      outputFile: `${surface.stem}.png`,
    });
  }
  return steps;
}

async function waitForSnapshot(webContents) {
  // eslint-disable-next-line no-constant-condition
  const start = Date.now();
  for (;;) {
    const ready = await webContents.executeJavaScript(
      "typeof window.__bbPluginSlotSnapshot === 'function'",
    );
    if (ready) return;
    if (Date.now() - start > READY_TIMEOUT_MS) {
      throw new Error(
        "app never exposed __bbPluginSlotSnapshot — is this bb older than the capture hook?",
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

function pluginIdsIn(slotIndex) {
  const ids = new Set();
  for (const rows of Object.values(slotIndex)) {
    for (const row of rows) if (row.pluginId) ids.add(row.pluginId);
  }
  return [...ids].sort();
}

async function waitForPlugin(webContents, pluginId) {
  const start = Date.now();
  let slotIndex = {};
  for (;;) {
    slotIndex = await webContents.executeJavaScript(READ_SNAPSHOT);
    if (pluginIdsIn(slotIndex).includes(pluginId)) return slotIndex;
    if (Date.now() - start > READY_TIMEOUT_MS) {
      const seen = pluginIdsIn(slotIndex);
      throw new Error(
        `${pluginId} registered no surface within ${READY_TIMEOUT_MS}ms. ` +
          (seen.length
            ? `Plugins that did: ${seen.join(", ")}.`
            : "No plugin registered anything — is the app signed in and past onboarding?"),
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
}

/**
 * Resolve once the page stops changing.
 *
 * Registration is not readiness: a panel mounts, then fetches, and shooting in
 * between photographs skeleton rows. Waiting for the DOM to go quiet covers
 * that without the harness knowing anything about a given plugin's loading UI.
 */
const WAIT_FOR_QUIET = (quietMs, timeoutMs) => `new Promise((resolve) => {
  let timer = null;
  const done = () => { observer.disconnect(); clearTimeout(cap); resolve(true); };
  const bump = () => { clearTimeout(timer); timer = setTimeout(done, ${quietMs}); };
  const observer = new MutationObserver(bump);
  observer.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true });
  const cap = setTimeout(done, ${timeoutMs});
  bump();
})`;

/** Registrations hold React components; pull out only JSON-safe identity. */
const READ_SNAPSHOT = `(() => {
  const s = window.__bbPluginSlotSnapshot();
  const pick = (rows) => (rows ?? []).map((r) => ({
    pluginId: r.pluginId ?? null,
    id: r.id ?? null,
    path: r.path ?? null,
  }));
  const out = {};
  for (const key of Object.keys(s)) out[key] = pick(s[key]);
  return out;
})()`;

async function main() {
  // Lazy: this file is also required under plain node to test planSteps.
  const { app, BrowserWindow } = require("electron");
  const planPath = process.argv[process.argv.length - 1];
  const plan = JSON.parse(readFileSync(planPath, "utf8"));
  mkdirSync(plan.outDir, { recursive: true });

  await app.whenReady();
  const win = new BrowserWindow({
    show: false,
    width: WIDTH,
    height: HEIGHT,
    webPreferences: { backgroundThrottling: false },
  });

  await win.loadURL(new URL("/", plan.appUrl).toString());
  await waitForSnapshot(win.webContents);
  // Plugin frontends mount after the shell: wait until this plugin has
  // registered something, or say which plugins did so the miss is debuggable.
  const slotIndex = await waitForPlugin(win.webContents, plan.pluginId);
  const steps = planSteps(plan, slotIndex);

  const written = [];
  for (const step of steps) {
    await win.loadURL(new URL(step.url, plan.appUrl).toString());
    // Re-check registration on the destination, not just on the way in: a
    // plugin whose service restarts (seeding its demo data does exactly that)
    // is briefly unregistered, and its route renders blank until it returns.
    await waitForPlugin(win.webContents, plan.pluginId);
    await win.webContents.executeJavaScript(
      WAIT_FOR_QUIET(QUIET_MS, QUIET_TIMEOUT_MS),
    );
    const image = await win.webContents.capturePage();
    const outPath = join(plan.outDir, step.outputFile);
    writeFileSync(outPath, image.toPNG());
    written.push({ slot: step.slot, url: step.url, file: outPath });
  }

  process.stdout.write(
    JSON.stringify({ pluginId: plan.pluginId, written }, null, 2) + "\n",
  );
  app.exit(written.length > 0 || steps.length === 0 ? 0 : 1);
}

if (process.versions.electron) {
  main().catch((error) => {
    process.stderr.write(String(error?.stack ?? error) + "\n");
    require("electron").app.exit(1);
  });
}

module.exports = { planSteps, SNAPSHOT_KEYS };

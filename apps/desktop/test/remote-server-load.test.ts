import { describe, expect, it } from "vitest";
import {
  loadRemoteServerPage,
  type RemoteServerStartupError,
} from "../src/remote-server-load.js";

const SERVER_URL = "http://host.example:38886";

interface RemoteServerLoadHarness {
  errors: RemoteServerStartupError[];
  loadedUrls: string[];
  warnings: string[];
}

function createHarness(): RemoteServerLoadHarness {
  return { errors: [], loadedUrls: [], warnings: [] };
}

function createElectronLoadFailure(): Error {
  // Shape of the real rejection: an Electron internal frame the user must never
  // see on the startup screen.
  const error = new Error(`ERR_FAILED (-2) loading '${SERVER_URL}'`);
  error.stack = `${error.message}\n    at rejectAndCleanup (node:electron/js2c/browser_init:2:89743)`;
  return error;
}

describe("loading a remote bb server", () => {
  it("reports a successful load", async () => {
    const harness = createHarness();

    const loaded = await loadRemoteServerPage({
      async loadStartupError(args) {
        harness.errors.push(args);
      },
      async loadUrl(args) {
        harness.loadedUrls.push(args.url);
      },
      logWarning(message) {
        harness.warnings.push(message);
      },
      serverUrl: SERVER_URL,
    });

    expect(loaded).toBe(true);
    expect(harness.loadedUrls).toEqual([SERVER_URL]);
    expect(harness.errors).toEqual([]);
  });

  it("turns an unreachable host into a recoverable screen", async () => {
    const harness = createHarness();

    const loaded = await loadRemoteServerPage({
      async loadStartupError(args) {
        harness.errors.push(args);
      },
      loadUrl() {
        return Promise.reject(createElectronLoadFailure());
      },
      logWarning(message) {
        harness.warnings.push(message);
      },
      serverUrl: SERVER_URL,
    });

    expect(loaded).toBe(false);
    expect(harness.errors).toHaveLength(1);
    const [startupError] = harness.errors;
    expect(startupError?.actions).toEqual(["retry", "use-this-mac"]);
    expect(startupError?.details).toContain(SERVER_URL);
    // The Electron internals belong in the log, not on the screen.
    expect(startupError?.details).not.toContain("ERR_FAILED");
    expect(startupError?.details).not.toContain("js2c");
    expect(startupError?.logs).toBe("");
    expect(harness.warnings).toHaveLength(1);
    expect(harness.warnings[0]).toContain("ERR_FAILED");
    expect(harness.warnings[0]).toContain("js2c");
  });
});

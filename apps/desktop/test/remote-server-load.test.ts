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

  // A saved target keeps user information and the query string, so it can hold a
  // password or a token. The user photographs this screen for a bug report and
  // attaches the log to it.
  it("keeps a credential and a query token out of the screen and the log", async () => {
    const harness = createHarness();
    const secretUrl = "https://alice:hunter2@bb.example:38886/?token=s3cret";

    const loaded = await loadRemoteServerPage({
      async loadStartupError(args) {
        harness.errors.push(args);
      },
      loadUrl() {
        return Promise.reject(
          new Error(`ERR_CONNECTION_REFUSED (-102) loading '${secretUrl}'`),
        );
      },
      logWarning(message) {
        harness.warnings.push(message);
      },
      serverUrl: secretUrl,
    });

    expect(loaded).toBe(false);
    const printed = [harness.errors[0]?.details ?? "", ...harness.warnings];
    for (const text of printed) {
      expect(text).not.toContain("hunter2");
      expect(text).not.toContain("alice");
      expect(text).not.toContain("s3cret");
      expect(text).not.toContain("token=");
    }
    // Naming the host is the point of the screen, so that part survives.
    expect(harness.errors[0]?.details).toContain("https://bb.example:38886/");
    // The code is the part of the Electron message worth keeping.
    expect(harness.warnings[0]).toContain("ERR_CONNECTION_REFUSED (-102)");
  });

  it("names no address when the saved target does not parse", async () => {
    const harness = createHarness();

    await loadRemoteServerPage({
      async loadStartupError(args) {
        harness.errors.push(args);
      },
      loadUrl() {
        return Promise.reject(new Error("ERR_FAILED (-2) loading 'nonsense'"));
      },
      logWarning(message) {
        harness.warnings.push(message);
      },
      serverUrl: "nonsense://it is not a url",
    });

    expect(harness.errors[0]?.details).toContain("the saved bb server");
    expect(harness.errors[0]?.details).not.toContain("nonsense");
    expect(harness.warnings[0]).not.toContain("nonsense");
  });

  it("still loads the complete URL, secret parts included", async () => {
    const harness = createHarness();
    const secretUrl = "https://alice:hunter2@bb.example:38886/?token=s3cret";

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
      serverUrl: secretUrl,
    });

    expect(loaded).toBe(true);
    expect(harness.loadedUrls).toEqual([secretUrl]);
  });
});

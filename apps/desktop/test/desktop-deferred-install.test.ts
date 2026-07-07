import { describe, expect, it, vi } from "vitest";
import {
  createDeferredInstallController,
  type CreateDeferredInstallControllerArgs,
} from "../src/desktop-deferred-install.js";

const ACTIVITY_URL = "http://127.0.0.1:4990/api/v1/system/agents/activity";

const silentLogger = {
  error(): void {},
  info(): void {},
  warn(): void {},
};

function activityResponse(busyThreadCount: number): Response {
  return new Response(JSON.stringify({ busyThreadCount }), {
    headers: { "content-type": "application/json" },
    status: 200,
  });
}

interface HarnessOverrides {
  busyCounts?: () => number | Error;
  hasProbe?: boolean;
  updateDownloaded?: () => boolean;
}

function createHarness(overrides: HarnessOverrides = {}) {
  const installUpdate = vi.fn(() => Promise.resolve());
  const busyCounts = overrides.busyCounts ?? (() => 0);
  const updateDownloaded = overrides.updateDownloaded ?? (() => true);
  const fetchImpl = vi.fn(async () => {
    const result = busyCounts();
    if (result instanceof Error) {
      throw result;
    }
    return activityResponse(result);
  });

  const args: CreateDeferredInstallControllerArgs = {
    getProbe: () =>
      (overrides.hasProbe ?? true) ? { activityUrl: ACTIVITY_URL } : null,
    isUpdateDownloaded: updateDownloaded,
    installUpdate,
    logger: silentLogger,
    fetchImpl: fetchImpl as unknown as typeof fetch,
    pollIntervalMs: 5,
    quietPeriodMs: 25,
  };
  const controller = createDeferredInstallController(args);
  return { controller, fetchImpl, installUpdate };
}

describe("desktop deferred install controller", () => {
  it("refuses to defer without a downloaded update or an owned runtime", () => {
    const noUpdate = createHarness({ updateDownloaded: () => false });
    expect(noUpdate.controller.request()).toBe(false);
    expect(noUpdate.controller.getState()).toBeNull();

    const noRuntime = createHarness({ hasProbe: false });
    expect(noRuntime.controller.canDefer()).toBe(false);
    expect(noRuntime.controller.request()).toBe(false);
  });

  it("relaunches after agents stay idle for the quiet period", async () => {
    const harness = createHarness();
    expect(harness.controller.request()).toBe(true);
    expect(harness.controller.getState()).toEqual({
      requestedAt: expect.any(String),
    });

    await vi.waitFor(() => {
      expect(harness.installUpdate).toHaveBeenCalledTimes(1);
    });
  });

  it("keeps waiting while agents are busy or the server is unreachable", async () => {
    let busy: number | Error = 2;
    const harness = createHarness({ busyCounts: () => busy });
    harness.controller.request();

    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(harness.installUpdate).not.toHaveBeenCalled();

    busy = new Error("server restarting");
    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(harness.installUpdate).not.toHaveBeenCalled();

    busy = 0;
    await vi.waitFor(() => {
      expect(harness.installUpdate).toHaveBeenCalledTimes(1);
    });
    harness.controller.stop();
  });

  it("cancel clears the deferral and stops polling", async () => {
    let busy = 1;
    const harness = createHarness({ busyCounts: () => busy });
    const changes: Array<ReturnType<typeof harness.controller.getState>> = [];
    harness.controller.subscribe(() => {
      changes.push(harness.controller.getState());
    });

    harness.controller.request();
    harness.controller.cancel();
    expect(harness.controller.getState()).toBeNull();
    expect(changes.at(-1)).toBeNull();

    busy = 0;
    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(harness.installUpdate).not.toHaveBeenCalled();
  });

  it("auto-cancels when the downloaded update goes away", async () => {
    let downloaded = true;
    const harness = createHarness({
      busyCounts: () => 1,
      updateDownloaded: () => downloaded,
    });
    harness.controller.request();

    downloaded = false;
    await vi.waitFor(() => {
      expect(harness.controller.getState()).toBeNull();
    });
    expect(harness.installUpdate).not.toHaveBeenCalled();
  });
});

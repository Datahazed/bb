import { afterEach, describe, expect, it, vi } from "vitest";

const { posthog } = vi.hoisted(() => ({
  posthog: {
    capture: vi.fn(),
    init: vi.fn(),
  },
}));

vi.mock("posthog-js", () => ({ default: posthog }));

describe("landing analytics", () => {
  afterEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    posthog.capture.mockClear();
    posthog.init.mockClear();
  });

  it("avoids browser persistence and disables remote features", async () => {
    vi.stubGlobal("window", {});
    vi.stubEnv("VITE_POSTHOG_KEY", "phc_test");

    const { initAnalytics } = await import("./analytics");
    initAnalytics();

    await vi.waitFor(() => expect(posthog.init).toHaveBeenCalledOnce());
    expect(posthog.init).toHaveBeenCalledWith(
      "phc_test",
      expect.objectContaining({
        advanced_disable_flags: true,
        disable_external_dependency_loading: true,
        disable_persistence: true,
        disable_session_recording: true,
        disable_surveys: true,
      }),
    );
  });
});

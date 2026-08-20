import { describe, expect, it } from "vitest";

import appConfigFactory from "./app.config.js";
import appJson from "./app.json";
import fingerprintConfig from "./fingerprint.config.js";

// The two config files below decide who receives an over-the-air update.
// Both failure modes are silent: an update that reaches nobody looks like a
// successful publish, and an E2E build that fetches a production bundle looks
// like a flaky flow. Neither shows up in a typecheck.

const evaluate = () => appConfigFactory({ config: appJson.expo });

describe("app.config.js", () => {
  it("keeps the update client on by default", () => {
    delete process.env.BB_DISABLE_UPDATES;
    const config = evaluate();

    expect(config.updates).toEqual({ url: appJson.expo.updates.url });
    expect(config).toMatchObject({ runtimeVersion: { policy: "fingerprint" } });
  });

  it("disables updates for the E2E Release build", () => {
    process.env.BB_DISABLE_UPDATES = "1";
    try {
      // Release E2E binaries must not ask the production channel for a bundle
      // mid-flow; prebuild turns this into EXUpdatesEnabled=false.
      expect(evaluate().updates).toMatchObject({ enabled: false });
    } finally {
      delete process.env.BB_DISABLE_UPDATES;
    }
  });

  it("changes nothing else about the app config", () => {
    process.env.BB_DISABLE_UPDATES = "1";
    try {
      const { updates: _disabled, ...rest } = evaluate();
      const { updates: _original, ...original } = appJson.expo;

      expect(rest).toEqual(original);
    } finally {
      delete process.env.BB_DISABLE_UPDATES;
    }
  });
});

describe("fingerprint.config.js", () => {
  // mobile-ios-eas.yml rewrites app.json `version` on every nightly. Without
  // this skip the version alone forks the runtime fingerprint each night, and
  // no update ever matches an installed build.
  it("keeps the marketing version out of the fingerprint", () => {
    expect(fingerprintConfig.sourceSkips).toContain("ExpoConfigVersions");
  });
});

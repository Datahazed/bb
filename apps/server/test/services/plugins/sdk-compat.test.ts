import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import semver from "semver";
import { PLUGIN_SDK_VERSION } from "@bb/domain";
import { isPluginSdkRangeSatisfied } from "../../../src/services/plugins/sdk-compat.js";

const major = semver.major(PLUGIN_SDK_VERSION);

describe("isPluginSdkRangeSatisfied", () => {
  it("loads a persisted 0.4.6 scaffold manifest after the SDK upgrade", async () => {
    const persistedManifest = JSON.parse(
      await readFile(
        new URL("./fixtures/plugin-scaffold-0.4.6-package.json", import.meta.url),
        "utf8",
      ),
    ) as {
      engines: { bbPluginSdk: string };
      devDependencies: { "@get-bb/plugin-sdk": string };
    };

    expect(persistedManifest.devDependencies["@get-bb/plugin-sdk"]).toBe(
      "0.4.6",
    );
    expect(persistedManifest.engines.bbPluginSdk).toBe(">=0.4.6");
    expect(
      isPluginSdkRangeSatisfied(persistedManifest.engines.bbPluginSdk),
    ).toBe(true);
  });

  it("accepts a caret range the running SDK has grown past", () => {
    // The regression this guards: `^0.4.1` stops at 0.5.0 under semver, so an
    // SDK minor bump unloaded every installed plugin at once.
    expect(isPluginSdkRangeSatisfied(`^${major}.0.1`)).toBe(true);
    expect(isPluginSdkRangeSatisfied(`${major}.0.1`)).toBe(true);
  });

  it("rejects a floor above the running SDK", () => {
    const ahead = semver.inc(PLUGIN_SDK_VERSION, "minor");
    if (ahead === null) throw new Error("cannot increment SDK version");
    expect(isPluginSdkRangeSatisfied(`>=${ahead}`)).toBe(false);
    expect(isPluginSdkRangeSatisfied(`^${ahead}`)).toBe(false);
  });

  it("rejects a range pinned to a different major", () => {
    expect(isPluginSdkRangeSatisfied(`^${major + 1}.0.0`)).toBe(false);
  });

  it("returns false for a malformed range instead of throwing", () => {
    expect(() => isPluginSdkRangeSatisfied("not-a-range")).not.toThrow();
    expect(isPluginSdkRangeSatisfied("not-a-range")).toBe(false);
  });

  it("accepts the ranges the scaffold and the running SDK produce", () => {
    expect(isPluginSdkRangeSatisfied(`>=${PLUGIN_SDK_VERSION}`)).toBe(true);
    expect(isPluginSdkRangeSatisfied(PLUGIN_SDK_VERSION)).toBe(true);
    expect(isPluginSdkRangeSatisfied("*")).toBe(true);
  });
});

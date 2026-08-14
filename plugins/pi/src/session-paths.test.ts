import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  PI_DRIVER_SESSION_DIR_ENV,
  resolvePiDriverSessionDir,
} from "./session-paths.js";

describe("Pi driver session paths", () => {
  it("preserves existing sessions while preferring the canonical override", () => {
    expect(
      resolvePiDriverSessionDir({
        env: {
          [PI_DRIVER_SESSION_DIR_ENV]: "./canonical-sessions",
          BB_PI_BRIDGE_SESSION_DIR: "./legacy-sessions",
        },
      }),
    ).toBe(resolve("./canonical-sessions"));

    expect(
      resolvePiDriverSessionDir({
        env: { BB_PI_BRIDGE_SESSION_DIR: "./legacy-sessions" },
      }),
    ).toBe(resolve("./legacy-sessions"));

    expect(resolvePiDriverSessionDir({ env: {} })).toBe(
      join(homedir(), ".bb", "pi-bridge-sessions"),
    );
  });
});

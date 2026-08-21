import { describe, expect, it } from "vitest";
import {
  ABOUT_DIALOG_COPY_BUTTON_LABEL,
  buildDesktopAboutDetails,
  createDesktopAboutDialogOptions,
  createDesktopAboutPanelOptions,
  formatBuildAge,
  type DesktopAboutFacts,
} from "../src/desktop-about-panel.js";

const BUILD_DATE = "2026-06-27T06:41:01.941Z";
const BUILD_MS = Date.parse(BUILD_DATE);
const DAY_MS = 86_400_000;

function createFacts(
  overrides: Partial<DesktopAboutFacts> = {},
): DesktopAboutFacts {
  return {
    applicationName: "bb",
    buildDate: BUILD_DATE,
    channel: "latest",
    commit: "042b3c1a4c53f2c3808067f519fbfc67b72cad80",
    electronVersion: "41.7.0",
    osArch: "arm64",
    osRelease: "23.3.0",
    osType: "Darwin",
    platform: "darwin",
    pluginSdkVersion: "0.4.12",
    version: "0.39.0",
    ...overrides,
  };
}

describe("formatBuildAge", () => {
  it("counts elapsed days", () => {
    expect(formatBuildAge(BUILD_DATE, BUILD_MS + 3 * DAY_MS)).toBe(
      "3 days old",
    );
    expect(formatBuildAge(BUILD_DATE, BUILD_MS + DAY_MS)).toBe("1 day old");
    expect(formatBuildAge(BUILD_DATE, BUILD_MS + DAY_MS - 1)).toBe("today");
  });

  it("reads a build newer than the clock as fresh, not as a negative age", () => {
    expect(formatBuildAge(BUILD_DATE, BUILD_MS - 5 * DAY_MS)).toBe("today");
  });

  it("has no age for an unparseable date", () => {
    expect(formatBuildAge("not-a-date", BUILD_MS)).toBeNull();
  });
});

describe("buildDesktopAboutDetails", () => {
  it("reports every build fact a bug report needs", () => {
    expect(buildDesktopAboutDetails(createFacts(), BUILD_MS + 3 * DAY_MS)).toBe(
      [
        "Version: 0.39.0",
        "Build Type: Stable",
        "Commit: 042b3c1a4c53f2c3808067f519fbfc67b72cad80",
        `Date: ${BUILD_DATE} (3 days old)`,
        "Plugin SDK: 0.4.12",
        "Electron: 41.7.0",
        "OS: Darwin arm64 23.3.0",
      ].join("\n"),
    );
  });

  it("omits the age when no clock is supplied", () => {
    expect(buildDesktopAboutDetails(createFacts(), null)).toContain(
      `Date: ${BUILD_DATE}\n`,
    );
  });

  it("labels a nightly build as such", () => {
    expect(
      buildDesktopAboutDetails(createFacts({ channel: "nightly" }), BUILD_MS),
    ).toContain("Build Type: Nightly");
  });

  it("says unknown rather than printing an empty value", () => {
    // A tarball checkout builds with no git metadata; "Commit: " alone reads
    // like a rendering bug.
    const details = buildDesktopAboutDetails(
      createFacts({ buildDate: "", commit: "", pluginSdkVersion: "  " }),
      BUILD_MS,
    );
    expect(details).toContain("Commit: unknown");
    expect(details).toContain("Date: unknown");
    expect(details).toContain("Plugin SDK: unknown");
  });
});

describe("createDesktopAboutDialogOptions", () => {
  it("offers a Copy button whose id addresses the copyable detail block", () => {
    const options = createDesktopAboutDialogOptions(
      createFacts(),
      BUILD_MS + 3 * DAY_MS,
    );
    expect(options.message).toBe("bb");
    expect(options.buttons[options.copyButtonId]).toBe(
      ABOUT_DIALOG_COPY_BUTTON_LABEL,
    );
    // Dismissing must never be the copy action: cancelId and defaultId both
    // have to land on a different button.
    expect(options.cancelId).not.toBe(options.copyButtonId);
    expect(options.defaultId).not.toBe(options.copyButtonId);
    expect(options.detail).toContain("3 days old");
  });
});

describe("createDesktopAboutPanelOptions", () => {
  it("puts the details in credits on macOS", () => {
    const options = createDesktopAboutPanelOptions(createFacts());
    expect(options.applicationVersion).toBe("0.39.0");
    expect(options.credits).toContain("Electron: 41.7.0");
  });

  it("falls back to the version field on Linux, which has no credits field", () => {
    const options = createDesktopAboutPanelOptions(
      createFacts({ osType: "Linux", platform: "linux" }),
    );
    expect(options.credits).toBeUndefined();
    expect(options.applicationVersion.startsWith("0.39.0\n\n")).toBe(true);
    expect(options.applicationVersion).toContain("OS: Linux arm64 23.3.0");
  });
});

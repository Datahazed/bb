import { describe, expect, it } from "vitest";
import {
  buildServiceWorkerPrecacheManifest,
  type ManifestBundle,
  type ManifestBundleChunk,
} from "../../vite-service-worker.js";

function chunk(
  fileName: string,
  overrides: Partial<Omit<ManifestBundleChunk, "type" | "fileName">> = {},
): ManifestBundleChunk {
  return {
    type: "chunk",
    fileName,
    isEntry: false,
    facadeModuleId: null,
    imports: [],
    dynamicImports: [],
    ...overrides,
  };
}

const ROUTE_ID = "/repo/apps/app/src/views/SplitWorkspaceRoute.tsx";

function fixtureBundle(): ManifestBundle {
  return {
    "assets/index-AAA.js": chunk("assets/index-AAA.js", {
      isEntry: true,
      facadeModuleId: "/repo/apps/app/src/main.tsx",
      imports: ["assets/boot-BBB.js"],
      dynamicImports: [
        "assets/SplitWorkspaceRoute-CCC.js",
        "assets/SettingsView-DDD.js",
      ],
      viteMetadata: { importedCss: new Set(["assets/index-EEE.css"]) },
    }),
    "assets/boot-BBB.js": chunk("assets/boot-BBB.js", {
      imports: ["assets/shared-FFF.js"],
    }),
    "assets/shared-FFF.js": chunk("assets/shared-FFF.js"),
    "assets/SplitWorkspaceRoute-CCC.js": chunk(
      "assets/SplitWorkspaceRoute-CCC.js",
      {
        facadeModuleId: `${ROUTE_ID}?some=query`,
        imports: ["assets/shared-FFF.js", "assets/route-only-GGG.js"],
        dynamicImports: ["assets/lazy-panel-HHH.js"],
        viteMetadata: { importedCss: new Set(["assets/markdown-III.css"]) },
      },
    ),
    "assets/route-only-GGG.js": chunk("assets/route-only-GGG.js"),
    "assets/lazy-panel-HHH.js": chunk("assets/lazy-panel-HHH.js"),
    "assets/SettingsView-DDD.js": chunk("assets/SettingsView-DDD.js", {
      facadeModuleId: "/repo/apps/app/src/views/SettingsView.tsx",
      imports: ["assets/settings-only-JJJ.js"],
    }),
    "assets/settings-only-JJJ.js": chunk("assets/settings-only-JJJ.js"),
    "assets/index-EEE.css": { type: "asset", fileName: "assets/index-EEE.css" },
    "assets/markdown-III.css": {
      type: "asset",
      fileName: "assets/markdown-III.css",
    },
    "assets/inter-latin-wght-normal-KKK.woff2": {
      type: "asset",
      fileName: "assets/inter-latin-wght-normal-KKK.woff2",
    },
    "assets/inter-cyrillic-wght-normal-LLL.woff2": {
      type: "asset",
      fileName: "assets/inter-cyrillic-wght-normal-LLL.woff2",
    },
    "index.html": { type: "asset", fileName: "index.html" },
  };
}

const options = {
  assetFileNamePatterns: [/^assets\/inter-latin-wght-normal-[^/]*\.woff2$/u],
  indexHtml: '<!doctype html><body class="bb-app-shell"></body>',
  routeModuleIds: [ROUTE_ID],
};

describe("buildServiceWorkerPrecacheManifest", () => {
  it("precaches the boot closure, the route closure, their CSS and the latin font only", () => {
    const manifest = buildServiceWorkerPrecacheManifest(
      fixtureBundle(),
      options,
    );
    expect(manifest.assetUrls).toEqual([
      "/assets/SplitWorkspaceRoute-CCC.js",
      "/assets/boot-BBB.js",
      "/assets/index-AAA.js",
      "/assets/index-EEE.css",
      "/assets/inter-latin-wght-normal-KKK.woff2",
      "/assets/markdown-III.css",
      "/assets/route-only-GGG.js",
      "/assets/shared-FFF.js",
    ]);
    // Other lazy views, the route's own lazy panels, non-latin fonts and the
    // html itself (fetched fresh at install) stay out of the precache list.
    expect(manifest.assetUrls).not.toContain("/assets/SettingsView-DDD.js");
    expect(manifest.assetUrls).not.toContain("/assets/settings-only-JJJ.js");
    expect(manifest.assetUrls).not.toContain("/assets/lazy-panel-HHH.js");
    expect(manifest.assetUrls).not.toContain(
      "/assets/inter-cyrillic-wght-normal-LLL.woff2",
    );
    expect(manifest.assetUrls).not.toContain("/index.html");
  });

  it("derives a build id that changes with the asset list or the shell html", () => {
    const base = buildServiceWorkerPrecacheManifest(fixtureBundle(), options);
    const same = buildServiceWorkerPrecacheManifest(fixtureBundle(), options);
    expect(same.buildId).toBe(base.buildId);
    expect(base.buildId).toMatch(/^[0-9a-f]{16}$/u);

    const rotated = fixtureBundle();
    delete rotated["assets/route-only-GGG.js"];
    rotated["assets/route-only-ZZZ.js"] = chunk("assets/route-only-ZZZ.js");
    const routeChunk = rotated["assets/SplitWorkspaceRoute-CCC.js"];
    if (routeChunk?.type !== "chunk") throw new Error("fixture drift");
    routeChunk.imports = ["assets/shared-FFF.js", "assets/route-only-ZZZ.js"];
    expect(
      buildServiceWorkerPrecacheManifest(rotated, options).buildId,
    ).not.toBe(base.buildId);

    expect(
      buildServiceWorkerPrecacheManifest(fixtureBundle(), {
        ...options,
        indexHtml: `${options.indexHtml}<!-- changed -->`,
      }).buildId,
    ).not.toBe(base.buildId);
  });

  it("fails the build when index.html lost the app-shell marker the worker installs by", () => {
    expect(() =>
      buildServiceWorkerPrecacheManifest(fixtureBundle(), {
        ...options,
        indexHtml: '<!doctype html><body class="dark bb-app-shell"></body>',
      }),
    ).toThrow(/does not contain class="bb-app-shell"/u);
  });

  it("fails the build when a configured route module has no chunk", () => {
    expect(() =>
      buildServiceWorkerPrecacheManifest(fixtureBundle(), {
        ...options,
        routeModuleIds: ["/repo/apps/app/src/views/Renamed.tsx"],
      }),
    ).toThrow(/no chunk for route module/u);
  });
});

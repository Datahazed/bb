import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { mergeConfig, type ViteUserConfig } from "vitest/config";

/**
 * Wraps a package's Vitest config so workspace imports (`@bb/*`) resolve to
 * package sources instead of built `dist/` output.
 *
 * Every workspace package's export map carries a `source` condition pointing
 * at `src/` — the same condition used by `node --conditions=source` in dev,
 * esbuild bundling (`scripts/build-utils.mjs`), and tsc (`customConditions`
 * in `packages/tsconfig/typecheck-overrides.json`). Vitest resolves test
 * imports through Vite's server environment, which only honors conditions
 * under `ssr.resolve`, so a plain `resolve.conditions` entry has no effect on
 * tests. Only `source` is listed here: Vitest contributes its own default
 * conditions through a config plugin, and Vite concatenates these arrays
 * with them during config merge.
 */
/**
 * Vitest APIs that mutate worker-global state (the module registry, globals,
 * or `process.env`). Files calling any of these need their own isolated
 * worker; running them with `isolate: false` makes mocks bleed across files
 * or silently fail to apply when the target module is already loaded.
 * `vi.hoisted` is listed because its only purpose is to run before the
 * file's imports evaluate — such a file depends on a fresh module graph.
 */
const MODULE_REGISTRY_API = "mock|doMock|unmock|doUnmock|resetModules|hoisted";
const STUB_API = "stubGlobal|stubEnv";
const isolationRequiringApi = (options: IsolationOptions) =>
  new RegExp(
    `\\bvi\\.(${
      options.stubsRestoredAfterEachTest
        ? MODULE_REGISTRY_API
        : `${MODULE_REGISTRY_API}|${STUB_API}`
    })\\(`,
  );

/**
 * Source patterns that mutate state every file in a worker shares and that
 * Vitest does not undo between files: assigning or defining properties on
 * the global object, `navigator`, `document`, or a prototype; replacing the
 * document's root markup (which detaches the `document.body` Testing
 * Library's `screen` is bound to); installing fake timers. Such a file runs
 * green on its own and breaks whichever file happens to follow it, so it is
 * routed to the isolated project rather than trusted to clean up.
 */
const GLOBAL_MUTATION =
  /\b(window|globalThis|global|self|navigator|document)\.[\w$]+\s*=[^=]|\bprototype\.[\w$]+\s*=[^=]|Object\.define(Property|Properties)\(\s*(window|globalThis|global|self|navigator|document|[\w$]+\.prototype)\b|documentElement\.innerHTML\s*=|\bvi\.useFakeTimers\(/;

const TEST_FILE = /\.test\.tsx?$/;
const SKIP_DIRS = new Set(["node_modules", "dist"]);

export interface IsolationOptions {
  /**
   * The package's config sets `unstubGlobals: true` and `unstubEnvs: true`,
   * so `vi.stubGlobal`/`vi.stubEnv` cannot outlive the test that called
   * them and no longer force a file into its own worker.
   */
  stubsRestoredAfterEachTest?: boolean;
}

/**
 * Finds test files under `roots` (relative to `pkgDir`) that use
 * worker-global vitest APIs or patch worker-global objects directly (see
 * `GLOBAL_MUTATION`) and therefore must keep the default isolated
 * worker. Everything else can run in a shared worker context
 * (`isolate: false`), which skips re-importing the module graph for every
 * file — by far the dominant cost of the big suites in CI.
 *
 * Returns package-relative posix paths, usable directly as vitest
 * `include`/`exclude` entries.
 */
export function findIsolationRequiringTests(
  pkgDir: string,
  roots: string[],
  options: IsolationOptions = {},
): string[] {
  const apiPattern = isolationRequiringApi(options);
  const matches: string[] = [];
  const walk = (dir: string) => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) walk(fullPath);
      } else if (TEST_FILE.test(entry.name)) {
        const source = readFileSync(fullPath, "utf8");
        if (apiPattern.test(source) || GLOBAL_MUTATION.test(source)) {
          matches.push(
            path.relative(pkgDir, fullPath).split(path.sep).join("/"),
          );
        }
      }
    }
  };
  for (const root of roots) walk(path.join(pkgDir, root));
  return matches.sort();
}

/**
 * `@hugeicons/core-free-icons`'s entry point re-exports ~10,000 one-icon
 * files; Node takes ~600ms to link that graph, and every isolated test file
 * that reaches an icon (every component test, through
 * `@bb/shared-ui/icon-extended` in the app's setup file) pays it again in
 * its own worker. The package also ships the same exports as a single
 * bundled module, which links in ~130ms. Tests only ever read icon data, so
 * they resolve the bare import to that bundle.
 */
const SINGLE_FILE_ICON_BARREL = {
  find: /^@hugeicons\/core-free-icons$/,
  replacement: "@hugeicons/core-free-icons/dist/esm/index.min",
};

export function defineWorkspaceTestConfig(
  config: ViteUserConfig,
): ViteUserConfig {
  return mergeConfig(
    {
      resolve: {
        alias: [SINGLE_FILE_ICON_BARREL],
        conditions: ["source"],
      },
      test: {
        coverage: {
          provider: "v8",
          include: ["**/*.{ts,tsx,js,jsx,mjs,cjs}"],
          exclude: [
            "**/*.d.ts",
            "**/*.test.{ts,tsx,js,jsx,mjs,cjs}",
            "**/*.spec.{ts,tsx,js,jsx,mjs,cjs}",
            "**/*.stories.{ts,tsx,js,jsx}",
            "**/*.gen.{ts,tsx,js,jsx}",
            "**/__fixtures__/**",
            "**/__tests__/**",
            "**/generated/**",
            ".turbo/**",
            "coverage/**",
            "dist/**",
            "node_modules/**",
            "scripts/**",
            "test/**",
            "tests/**",
            "*.config.{ts,js,mts,mjs}",
            "vite.{ts,js,mts,mjs}",
            "vitest.{ts,js,mts,mjs}",
          ],
          reporter: ["text-summary", "json-summary"],
        },
      },
      ssr: {
        resolve: {
          conditions: ["source"],
          externalConditions: ["source"],
        },
      },
    },
    config,
  );
}

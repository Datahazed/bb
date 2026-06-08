/**
 * Bundles the runtime artifacts the engine hands to provider processes and
 * runtime shells, shipping them alongside the server dist (single-host plan
 * §5.9 / §6 Phase 3):
 *
 *   - `bb-claude-code-bridge.mjs` / `bb-pi-bridge.mjs` — provider bridges the
 *     agent runtime spawns via `BB_BRIDGE_DIR`.
 *   - `bb` — the bundled CLI placed on runtime-shell PATH via `BB_CLI_DIR`
 *     (also the `bb` bin the bb-app launcher executes).
 *   - `title` — the terminal-title helper shipped next to `bb` on PATH.
 *
 * Adapted from the deleted host-daemon bundle build; the daemon bundle
 * target itself died with the daemon.
 */
import { chmod, copyFile, stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import {
  createNativeExternalPatterns,
  NODE_ESM_REQUIRE_BANNER,
} from "../../../scripts/build-utils.mjs";

const scriptsDir = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(scriptsDir, "..");
const workspaceRoot = resolve(packageRoot, "..", "..");

const bundleTargets = [
  {
    entryPoint: resolve(
      workspaceRoot,
      "packages",
      "agent-runtime",
      "src",
      "claude-code",
      "bridge",
      "bridge.ts",
    ),
    label: "claude-code bridge",
    outfile: resolve(packageRoot, "dist", "bb-claude-code-bridge.mjs"),
  },
  {
    entryPoint: resolve(
      workspaceRoot,
      "packages",
      "agent-runtime",
      "src",
      "pi",
      "bridge",
      "bridge.ts",
    ),
    label: "pi bridge",
    outfile: resolve(packageRoot, "dist", "bb-pi-bridge.mjs"),
  },
  {
    entryPoint: resolve(workspaceRoot, "apps", "cli", "src", "index.ts"),
    executable: true,
    label: "bb cli",
    outfile: resolve(packageRoot, "dist", "bb"),
  },
];

async function main() {
  for (const target of bundleTargets) {
    await build({
      banner: {
        js: NODE_ESM_REQUIRE_BANNER,
      },
      bundle: true,
      conditions: ["source"],
      entryPoints: [target.entryPoint],
      external: createNativeExternalPatterns(),
      format: "esm",
      legalComments: "none",
      minify: true,
      outfile: target.outfile,
      platform: "node",
      sourcemap: false,
      target: "node22",
    });
    if (target.executable) {
      await chmod(target.outfile, 0o755);
    }
    const bundleStats = await stat(target.outfile);
    console.log(`${target.label}: ${bundleStats.size} bytes`);
  }

  const titleCommandPath = resolve(
    workspaceRoot,
    "apps",
    "cli",
    "bin",
    "title",
  );
  const outputTitleCommandPath = resolve(packageRoot, "dist", "title");
  await copyFile(titleCommandPath, outputTitleCommandPath);
  await chmod(outputTitleCommandPath, 0o755);
}

void main().catch((error) => {
  const message =
    error instanceof Error ? (error.stack ?? error.message) : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});

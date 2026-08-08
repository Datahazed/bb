#!/usr/bin/env node
// Fails when the boot payload grows past bundle-budget.json, or when a heavy
// package that should load on demand reaches the boot path again.
//
// Run after `pnpm build` in apps/app. Reads bundle-stats.json (written by the
// bb:bundle-stats Vite plugin) and the brotli files written by
// scripts/precompress-app-dist.mjs.
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const appDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const distDir = path.resolve(appDir, process.argv[2] ?? "dist");
const statsPath = path.join(appDir, "bundle-stats.json");
const budgetPath = path.join(appDir, "bundle-budget.json");

const die = (message) => {
  console.error(message);
  process.exit(1);
};

if (!fs.existsSync(statsPath)) {
  die(`missing ${path.relative(appDir, statsPath)} — run the app build first`);
}
if (!fs.existsSync(distDir)) {
  die(`missing ${path.relative(appDir, distDir)} — run the app build first`);
}

const stats = JSON.parse(fs.readFileSync(statsPath, "utf8"));
const budget = JSON.parse(fs.readFileSync(budgetPath, "utf8"));

const kb = (n) => `${(n / 1024).toFixed(1)} KB`;
const failures = [];
const minPrecompressBytes = 1024;

// A chunk with no .br file would otherwise weigh zero against the compressed
// budget. The precompressor deliberately leaves files below 1 KB untouched,
// so count their full size and fail only when a larger compressed file is gone.
const missingBrotli = new Set();
const measureChunks = (chunks) => {
  let bytes = 0;
  let brotliBytes = 0;
  for (const chunk of chunks) {
    bytes += chunk.bytes;
    const brotliPath = path.join(distDir, `${chunk.fileName}.br`);
    if (fs.existsSync(brotliPath)) {
      brotliBytes += fs.statSync(brotliPath).size;
    } else if (chunk.bytes < minPrecompressBytes) {
      brotliBytes += chunk.bytes;
    } else {
      missingBrotli.add(chunk.fileName);
    }
  }
  return { bytes, brotliBytes };
};

const bootPayload = measureChunks(stats.bootChunks);
const workspaceRoutePayload = measureChunks(stats.workspaceRouteChunks);

const findForbiddenPackages = (chunks, forbiddenPackages) => {
  const forbidden = new Set(forbiddenPackages);
  const offenders = new Map();
  for (const chunk of chunks) {
    for (const pkg of chunk.packages) {
      if (!forbidden.has(pkg)) continue;
      if (!offenders.has(pkg)) offenders.set(pkg, []);
      offenders.get(pkg).push(chunk.fileName);
    }
  }
  return offenders;
};

const bootOffenders = findForbiddenPackages(
  stats.bootChunks,
  budget.forbiddenBootPackages,
);
const workspaceRouteOffenders = findForbiddenPackages(
  stats.workspaceRouteChunks,
  budget.forbiddenWorkspaceRoutePackages,
);

console.log(
  `boot payload: ${kb(bootPayload.bytes)} raw / ${kb(bootPayload.brotliBytes)} brotli`,
);
console.log(
  `  budget:     ${kb(budget.maxBootBytes)} raw / ${kb(budget.maxBootBrotliBytes)} brotli`,
);
console.log(`  chunks:     ${stats.bootChunks.length}`);
console.log(
  `workspace route: ${kb(workspaceRoutePayload.bytes)} raw / ${kb(workspaceRoutePayload.brotliBytes)} brotli`,
);
console.log(`  chunks:          ${stats.workspaceRouteChunks.length}`);
console.log(
  `checkout chunk:  ${kb(stats.workspaceCheckoutDisplayChunk.bytes)} raw`,
);
console.log(
  `  budget:        ${kb(budget.maxWorkspaceCheckoutDisplayChunkBytes)} raw`,
);

if (missingBrotli.size > 0) {
  failures.push(
    `${missingBrotli.size} measured chunk(s) have no .br file, so the compressed total is understated: ${[...missingBrotli].join(", ")}. Run scripts/precompress-app-dist.mjs.`,
  );
}
if (bootPayload.bytes > budget.maxBootBytes) {
  failures.push(
    `boot payload is ${kb(bootPayload.bytes)}, over the ${kb(budget.maxBootBytes)} raw budget by ${kb(bootPayload.bytes - budget.maxBootBytes)}.`,
  );
}
if (bootPayload.brotliBytes > budget.maxBootBrotliBytes) {
  failures.push(
    `boot payload is ${kb(bootPayload.brotliBytes)} brotli, over the ${kb(budget.maxBootBrotliBytes)} budget by ${kb(bootPayload.brotliBytes - budget.maxBootBrotliBytes)}.`,
  );
}
if (
  stats.workspaceCheckoutDisplayChunk.bytes >
  budget.maxWorkspaceCheckoutDisplayChunkBytes
) {
  failures.push(
    `workspace checkout display chunk is ${kb(stats.workspaceCheckoutDisplayChunk.bytes)}, over the ${kb(budget.maxWorkspaceCheckoutDisplayChunkBytes)} raw budget.`,
  );
}
for (const [pkg, chunks] of bootOffenders) {
  failures.push(
    `${pkg} is in the boot payload (${chunks.join(", ")}). It must load on demand.`,
  );
}
for (const [pkg, chunks] of workspaceRouteOffenders) {
  failures.push(
    `${pkg} is in the workspace route preload (${chunks.join(", ")}). It must load on demand.`,
  );
}

if (failures.length > 0) {
  console.error("\nBundle budget failed:\n");
  for (const failure of failures) console.error(`  - ${failure}`);
  console.error("\nBoot chunks, largest first:");
  for (const chunk of [...stats.bootChunks].sort((a, b) => b.bytes - a.bytes)) {
    console.error(`  ${kb(chunk.bytes).padStart(10)}  ${chunk.fileName}`);
  }
  console.error(
    "\nA package usually reaches the boot path through a barrel re-export: some" +
      "\nmodule that App renders eagerly imports one small helper from an index.ts" +
      "\nthat also exports heavy components. Import from the defining module" +
      "\ninstead, or move the caller behind React.lazy.\n" +
      "\nRun `node scripts/why-eager.mjs <package>` in apps/app to print the exact" +
      "\nstatic import chain from the entry to the package.\n",
  );
  process.exit(1);
}

console.log("\nBundle budget OK.");

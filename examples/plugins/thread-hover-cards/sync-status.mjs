import { access, readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const AUTHORED_FILES = [
  "app.tsx",
  "icons.ts",
  "markdown-preview.ts",
  "server.ts",
  "styles.ts",
  "test/app.test.mjs",
  "test/server.test.ts",
];

const exampleRoot = dirname(fileURLToPath(import.meta.url));
const input =
  process.argv.slice(2).find((argument) => argument !== "--")?.trim() ||
  process.env.BB_PLUGINS_DIR?.trim();

if (!input) {
  console.error(
    "Usage: pnpm sync:status -- /path/to/bb-plugins\n" +
      "Or set BB_PLUGINS_DIR to the bb-plugins checkout.",
  );
  process.exitCode = 2;
} else {
  const requestedRoot = resolve(input);
  const nestedPluginRoot = join(
    requestedRoot,
    "plugins",
    "thread-hover-cards",
  );
  const sourceRoot = (await exists(join(nestedPluginRoot, "package.json")))
    ? nestedPluginRoot
    : requestedRoot;

  if (!(await exists(join(sourceRoot, "package.json")))) {
    console.error(`No thread-hover-cards plugin found at ${sourceRoot}`);
    process.exitCode = 2;
  } else {
    const same = [];
    const different = [];
    const missing = [];

    for (const relativePath of AUTHORED_FILES) {
      const sourcePath = join(sourceRoot, relativePath);
      const examplePath = join(exampleRoot, relativePath);
      try {
        const [source, example] = await Promise.all([
          readFile(sourcePath),
          readFile(examplePath),
        ]);
        (source.equals(example) ? same : different).push(relativePath);
      } catch {
        missing.push(relativePath);
      }
    }

    console.log(`Source:  ${sourceRoot}`);
    console.log(`Example: ${exampleRoot}`);
    printGroup("Same", same);
    printGroup("Different", different);
    printGroup("Missing", missing);

    if (different.length > 0) {
      console.log("\nReview a changed file with:");
      console.log(
        `git diff --no-index -- ${shellQuote(join(sourceRoot, different[0]))} ${shellQuote(join(exampleRoot, different[0]))}`,
      );
    }

    console.log(
      "\nThis command reports drift only; it never overwrites either checkout.",
    );
  }
}

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function printGroup(label, files) {
  console.log(`\n${label} (${files.length})`);
  for (const file of files) console.log(`  ${file}`);
}

function shellQuote(value) {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

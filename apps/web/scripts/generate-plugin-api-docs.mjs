// Generates the plugin API docs model from the plugin SDK's committed
// bundled declarations (packages/plugin-sdk/bundled-types/*.d.ts) — the same
// files plugin authors read from node_modules. The emitted module is
// committed; `--check` fails when it is stale (same convention as
// packages/templates/scripts/generate-templates.mjs).
//
//   node apps/web/scripts/generate-plugin-api-docs.mjs          # write
//   node apps/web/scripts/generate-plugin-api-docs.mjs --check  # verify
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const REPO_ROOT = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
);
const BUNDLED_TYPES_DIR = join(
  REPO_ROOT,
  "packages",
  "plugin-sdk",
  "bundled-types",
);
const SDK_PACKAGE_JSON = join(
  REPO_ROOT,
  "packages",
  "plugin-sdk",
  "package.json",
);
const OUTPUT_PATH = join(
  REPO_ROOT,
  "apps",
  "web",
  "src",
  "docs-plugin-api",
  "api-model.generated.ts",
);

/**
 * The public entry points the docs cover. The `internal/*` subpaths are
 * deliberately absent: they are host/build implementation details, not part
 * of the authoring surface.
 */
const MODULES = [
  { id: "root", importPath: "@get-bb/plugin-sdk", file: "bb-plugin-sdk.d.ts" },
  {
    id: "app",
    importPath: "@get-bb/plugin-sdk/app",
    file: "bb-plugin-sdk-app.d.ts",
  },
  {
    id: "host",
    importPath: "@get-bb/plugin-sdk/host",
    file: "bb-plugin-sdk-host.d.ts",
  },
  {
    id: "provider-bridge",
    importPath: "@get-bb/plugin-sdk/provider-bridge",
    file: "bb-plugin-sdk-provider-bridge.d.ts",
  },
  {
    id: "testing",
    importPath: "@get-bb/plugin-sdk/testing",
    file: "bb-plugin-sdk-testing.d.ts",
  },
  {
    id: "testing-app",
    importPath: "@get-bb/plugin-sdk/testing/app",
    file: "bb-plugin-sdk-testing-app.d.ts",
  },
  {
    id: "testing-host",
    importPath: "@get-bb/plugin-sdk/testing/host",
    file: "bb-plugin-sdk-testing-host.d.ts",
  },
];

const SIGNATURE_MAX_LENGTH = 1600;
const MEMBER_SIGNATURE_MAX_LENGTH = 700;

function truncate(text, maxLength) {
  if (text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, maxLength)}\n/* … truncated — read the bundled declarations for the full type */`;
}

/** Last /** … *\/ block in the node's leading trivia, with comment markers stripped. */
function extractJsDoc(node, sourceText) {
  const ranges =
    ts.getLeadingCommentRanges(sourceText, node.getFullStart()) ?? [];
  const blocks = ranges.filter(
    (range) =>
      range.kind === ts.SyntaxKind.MultiLineCommentTrivia &&
      sourceText.slice(range.pos, range.pos + 3) === "/**",
  );
  const last = blocks[blocks.length - 1];
  if (!last) {
    return null;
  }
  const raw = sourceText.slice(last.pos, last.end);
  const body = raw.replace(/^\/\*\*/, "").replace(/\*\/$/, "");
  const lines = body
    .split("\n")
    .map((line) => line.replace(/^\s*\* ?/, "").trimEnd());
  while (lines.length > 0 && lines[0] === "") {
    lines.shift();
  }
  while (lines.length > 0 && lines[lines.length - 1] === "") {
    lines.pop();
  }
  const text = lines.join("\n").trim();
  return text.length > 0 ? text : null;
}

function isExperimentalName(name) {
  return name.startsWith("experimental_") || name.startsWith("Experimental");
}

function stripDeclareExport(text) {
  return text.replace(/^export\s+/, "").replace(/^declare\s+/, "");
}

function memberName(member) {
  if (!member.name) {
    return null;
  }
  if (ts.isIdentifier(member.name) || ts.isStringLiteral(member.name)) {
    return member.name.text;
  }
  return member.name.getText();
}

function extractMembers(declaration, sourceText) {
  const members = [];
  for (const member of declaration.members ?? []) {
    const name = memberName(member);
    if (name === null) {
      // Index/call/construct signatures keep their full text as the "name".
      members.push({
        name: member.getText().split("\n")[0],
        kind: "signature",
        optional: false,
        signature: truncate(member.getText(), MEMBER_SIGNATURE_MAX_LENGTH),
        doc: extractJsDoc(member, sourceText),
        experimental: false,
      });
      continue;
    }
    const optional = member.questionToken !== undefined;
    const kind =
      ts.isMethodSignature(member) || ts.isMethodDeclaration(member)
        ? "method"
        : "property";
    members.push({
      name,
      kind,
      optional,
      signature: truncate(member.getText(), MEMBER_SIGNATURE_MAX_LENGTH),
      doc: extractJsDoc(member, sourceText),
      experimental: isExperimentalName(name),
    });
  }
  return members;
}

function interfaceHeader(declaration) {
  const name = declaration.name.text;
  const typeParams =
    declaration.typeParameters && declaration.typeParameters.length > 0
      ? `<${declaration.typeParameters.map((p) => p.getText()).join(", ")}>`
      : "";
  const heritage =
    declaration.heritageClauses && declaration.heritageClauses.length > 0
      ? ` ${declaration.heritageClauses.map((c) => c.getText()).join(" ")}`
      : "";
  return `interface ${name}${typeParams}${heritage}`;
}

function collectDeclarations(sourceFile, sourceText) {
  /** name -> { kind, doc, signature, members } (function overloads merge). */
  const byName = new Map();
  const directExports = new Set();
  const directTypeOnlyExports = new Set();

  const hasExportModifier = (node) =>
    (ts.getCombinedModifierFlags(node) & ts.ModifierFlags.Export) !== 0;

  for (const statement of sourceFile.statements) {
    if (ts.isInterfaceDeclaration(statement)) {
      byName.set(statement.name.text, {
        kind: "interface",
        doc: extractJsDoc(statement, sourceText),
        signature: interfaceHeader(statement),
        members: extractMembers(statement, sourceText),
      });
      if (hasExportModifier(statement)) directExports.add(statement.name.text);
    } else if (ts.isTypeAliasDeclaration(statement)) {
      byName.set(statement.name.text, {
        kind: "type",
        doc: extractJsDoc(statement, sourceText),
        signature: truncate(
          stripDeclareExport(statement.getText()),
          SIGNATURE_MAX_LENGTH,
        ),
        members: [],
      });
      if (hasExportModifier(statement)) directExports.add(statement.name.text);
    } else if (ts.isFunctionDeclaration(statement) && statement.name) {
      const name = statement.name.text;
      const overloadText = truncate(
        stripDeclareExport(statement.getText()),
        SIGNATURE_MAX_LENGTH,
      );
      const existing = byName.get(name);
      if (existing && existing.kind === "function") {
        existing.signature = `${existing.signature}\n${overloadText}`;
        if (!existing.doc) existing.doc = extractJsDoc(statement, sourceText);
      } else {
        byName.set(name, {
          kind: "function",
          doc: extractJsDoc(statement, sourceText),
          signature: overloadText,
          members: [],
        });
      }
      if (hasExportModifier(statement)) directExports.add(name);
    } else if (ts.isClassDeclaration(statement) && statement.name) {
      byName.set(statement.name.text, {
        kind: "class",
        doc: extractJsDoc(statement, sourceText),
        signature: `class ${statement.name.text}${
          statement.heritageClauses
            ? ` ${statement.heritageClauses.map((c) => c.getText()).join(" ")}`
            : ""
        }`,
        members: extractMembers(statement, sourceText),
      });
      if (hasExportModifier(statement)) directExports.add(statement.name.text);
    } else if (ts.isEnumDeclaration(statement)) {
      byName.set(statement.name.text, {
        kind: "enum",
        doc: extractJsDoc(statement, sourceText),
        signature: truncate(
          stripDeclareExport(statement.getText()),
          SIGNATURE_MAX_LENGTH,
        ),
        members: [],
      });
      if (hasExportModifier(statement)) directExports.add(statement.name.text);
    } else if (ts.isVariableStatement(statement)) {
      const doc = extractJsDoc(statement, sourceText);
      for (const declaration of statement.declarationList.declarations) {
        if (!ts.isIdentifier(declaration.name)) continue;
        byName.set(declaration.name.text, {
          kind: "const",
          doc,
          signature: truncate(
            `const ${declaration.getText()}`,
            SIGNATURE_MAX_LENGTH,
          ),
          members: [],
        });
        if (hasExportModifier(statement))
          directExports.add(declaration.name.text);
      }
    }
  }

  return { byName, directExports, directTypeOnlyExports };
}

function collectExportNames(sourceFile) {
  /** name -> { typeOnly } in statement order. */
  const names = new Map();
  for (const statement of sourceFile.statements) {
    if (!ts.isExportDeclaration(statement) || !statement.exportClause) continue;
    if (!ts.isNamedExports(statement.exportClause)) continue;
    for (const specifier of statement.exportClause.elements) {
      const name = specifier.name.text;
      const typeOnly = statement.isTypeOnly || specifier.isTypeOnly;
      if (!names.has(name) || names.get(name).typeOnly) {
        names.set(name, { typeOnly });
      }
    }
  }
  return names;
}

function buildModuleDoc(moduleSpec) {
  const filePath = join(BUNDLED_TYPES_DIR, moduleSpec.file);
  const sourceText = readFileSync(filePath, "utf8");
  const sourceFile = ts.createSourceFile(
    moduleSpec.file,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
  );

  const { byName, directExports } = collectDeclarations(sourceFile, sourceText);
  const exportNames = collectExportNames(sourceFile);
  for (const name of directExports) {
    if (!exportNames.has(name)) {
      exportNames.set(name, { typeOnly: false });
    }
  }

  const exports = [];
  const missing = [];
  // Emit in declaration order so pages read like the source, with
  // export-only names (rare) appended in export order.
  const declared = [...byName.keys()].filter((name) => exportNames.has(name));
  const undeclared = [...exportNames.keys()].filter(
    (name) => !byName.has(name),
  );
  for (const name of undeclared) {
    missing.push(
      `${moduleSpec.file}: exported name "${name}" has no top-level declaration`,
    );
  }
  for (const name of declared) {
    const info = byName.get(name);
    exports.push({
      name,
      kind: info.kind,
      exportedAsType:
        exportNames.get(name).typeOnly ||
        info.kind === "interface" ||
        info.kind === "type",
      doc: info.doc,
      signature: info.signature,
      members: info.members,
      experimental: isExperimentalName(name),
    });
  }

  if (missing.length > 0) {
    throw new Error(
      `plugin API docs generation failed:\n${missing.join("\n")}`,
    );
  }

  return {
    id: moduleSpec.id,
    importPath: moduleSpec.importPath,
    sourceFile: `packages/plugin-sdk/bundled-types/${moduleSpec.file}`,
    exports,
  };
}

export function generatePluginApiDocsModel() {
  const sdkPackage = JSON.parse(readFileSync(SDK_PACKAGE_JSON, "utf8"));
  return {
    sdkVersion: sdkPackage.version,
    modules: MODULES.map(buildModuleDoc),
  };
}

export function renderGeneratedModule() {
  const model = generatePluginApiDocsModel();
  return `// Generated by apps/web/scripts/generate-plugin-api-docs.mjs — do not edit.
// Source of truth: packages/plugin-sdk/bundled-types/*.d.ts (the published
// plugin SDK declarations). Regenerate with:
//   pnpm --filter @bb/web docs:generate
import type { PluginApiDocsModel } from "./model";

export const PLUGIN_API_MODEL: PluginApiDocsModel = ${JSON.stringify(model, null, 2)};
`;
}

function main() {
  const check = process.argv.includes("--check");
  const next = renderGeneratedModule();
  if (check) {
    let current = null;
    try {
      current = readFileSync(OUTPUT_PATH, "utf8");
    } catch {
      // Missing counts as stale.
    }
    if (current !== next) {
      console.error(
        "apps/web/src/docs-plugin-api/api-model.generated.ts is stale. " +
          "Run: pnpm --filter @bb/web docs:generate",
      );
      process.exit(1);
    }
    return;
  }
  writeFileSync(OUTPUT_PATH, next);
  console.log(`wrote ${OUTPUT_PATH}`);
}

const invokedDirectly =
  process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (invokedDirectly) {
  main();
}

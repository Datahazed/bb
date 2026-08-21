import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  finalizeListedFiles,
  finalizeListedPaths,
  listPathsRecursively,
  listRootPaths,
  normalizeListedPath,
} from "./file-list.js";

const execFileAsync = promisify(execFile);

async function runGit(args: string[], cwd: string): Promise<void> {
  await execFileAsync("git", args, { cwd });
}

async function initGitRepo(root: string): Promise<void> {
  await runGit(["init", "-q", "-b", "main"], root);
  await runGit(["config", "user.name", "BB Tests"], root);
  await runGit(["config", "user.email", "bb@example.com"], root);
  await runGit(["config", "commit.gpgsign", "false"], root);
}

const WALK_ALL = {
  includeFiles: true,
  includeDirectories: true,
  includeHidden: true,
  excludeNames: new Set<string>(),
  maxEntries: 50_000,
};

describe("finalizeListedFiles", () => {
  it("preserves walk order for an empty query", () => {
    const result = finalizeListedFiles({
      filePaths: ["src/z.ts", "src/a.ts", "src/m.ts"],
      limit: 2,
    });

    expect(result.files.map((file) => file.path)).toEqual([
      "src/z.ts",
      "src/a.ts",
    ]);
    expect(result.truncated).toBe(true);
  });

  it("sets the display name from the path basename", () => {
    const result = finalizeListedFiles({
      filePaths: ["src/components/PromptBox.tsx"],
      limit: 5,
    });

    expect(result.files).toEqual([
      {
        path: "src/components/PromptBox.tsx",
        name: "PromptBox.tsx",
      },
    ]);
    expect(result.truncated).toBe(false);
  });

  it("does not report truncation below the limit", () => {
    const result = finalizeListedFiles({
      filePaths: ["a.ts", "b.ts"],
      limit: 3,
    });

    expect(result.files.map((file) => file.path)).toEqual(["a.ts", "b.ts"]);
    expect(result.truncated).toBe(false);
  });

  it("does not report truncation exactly at the limit", () => {
    const result = finalizeListedFiles({
      filePaths: ["a.ts", "b.ts", "c.ts"],
      limit: 3,
    });

    expect(result.files.map((file) => file.path)).toEqual([
      "a.ts",
      "b.ts",
      "c.ts",
    ]);
    expect(result.truncated).toBe(false);
  });

  it("reports truncation above the limit", () => {
    const result = finalizeListedFiles({
      filePaths: ["a.ts", "b.ts", "c.ts", "d.ts"],
      limit: 3,
    });

    expect(result.files.map((file) => file.path)).toEqual([
      "a.ts",
      "b.ts",
      "c.ts",
    ]);
    expect(result.truncated).toBe(true);
  });

  it("applies query matching before truncating", () => {
    const result = finalizeListedFiles({
      filePaths: [
        "src/a.ts",
        "src/b.ts",
        "apps/app/src/components/promptbox/PromptBox.tsx",
      ],
      query: "PromptBox",
      limit: 1,
    });

    expect(result.files.map((file) => file.path)).toEqual([
      "apps/app/src/components/promptbox/PromptBox.tsx",
    ]);
    expect(result.truncated).toBe(false);
  });

  it("reports truncation after query matching when more matches remain", () => {
    const result = finalizeListedFiles({
      filePaths: ["src/prompt-a.ts", "src/prompt-b.ts", "src/prompt-c.ts"],
      query: "prompt",
      limit: 2,
    });

    expect(result.files).toHaveLength(2);
    expect(result.truncated).toBe(true);
  });

  it("returns an empty untruncated list when a query has no matches", () => {
    const result = finalizeListedFiles({
      filePaths: ["src/a.ts", "src/b.ts"],
      query: "prompt",
      limit: 2,
    });

    expect(result.files).toEqual([]);
    expect(result.truncated).toBe(false);
  });
});

describe("finalizeListedPaths", () => {
  it("excludes directories when directory results are disabled", () => {
    const result = finalizeListedPaths({
      paths: [
        { kind: "directory", path: "src", name: "src" },
        { kind: "file", path: "src/index.ts", name: "index.ts" },
      ],
      includeFiles: true,
      includeDirectories: false,
      limit: 10,
    });

    expect(result.paths).toEqual([
      {
        kind: "file",
        path: "src/index.ts",
        name: "index.ts",
        score: 0,
        positions: [],
      },
    ]);
    expect(result.truncated).toBe(false);
  });

  it("includes directories with typed path metadata when requested", () => {
    const result = finalizeListedPaths({
      paths: [
        { kind: "directory", path: "src", name: "src" },
        { kind: "file", path: "src/index.ts", name: "index.ts" },
      ],
      includeFiles: true,
      includeDirectories: true,
      limit: 10,
    });

    expect(result.paths.map((pathEntry) => pathEntry.kind)).toEqual([
      "directory",
      "file",
    ]);
    expect(result.paths[0]).toEqual({
      kind: "directory",
      path: "src",
      name: "src",
      score: 0,
      positions: [],
    });
  });

  it("applies fuzzy ranking before truncating mixed path results", () => {
    const result = finalizeListedPaths({
      paths: [
        {
          kind: "file",
          path: "src/components/Button.tsx",
          name: "Button.tsx",
        },
        {
          kind: "directory",
          path: "apps/app/src/components/promptbox",
          name: "promptbox",
        },
        {
          kind: "file",
          path: "apps/app/src/components/promptbox/PromptBox.tsx",
          name: "PromptBox.tsx",
        },
      ],
      query: "prompt",
      includeFiles: true,
      includeDirectories: true,
      limit: 1,
    });

    expect(result.paths).toHaveLength(1);
    expect(result.paths[0]?.path).toBe(
      "apps/app/src/components/promptbox/PromptBox.tsx",
    );
    expect(result.paths[0]?.score).toBeGreaterThan(0);
    expect(result.paths[0]?.positions.length).toBeGreaterThan(0);
    expect(result.truncated).toBe(true);
  });
});

describe("listPathsRecursively", () => {
  let root: string;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "bb-file-list-"));
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it("returns slash-separated relative paths for nested entries", async () => {
    await fs.mkdir(path.join(root, "src", "components"), { recursive: true });
    await fs.writeFile(path.join(root, "src", "components", "Button.tsx"), "");

    const result = await listPathsRecursively({ ...WALK_ALL, dir: root, root });

    expect(result.paths).toEqual([
      { kind: "directory", path: "src", name: "src" },
      { kind: "directory", path: "src/components", name: "components" },
      { kind: "file", path: "src/components/Button.tsx", name: "Button.tsx" },
    ]);
    expect(result.truncated).toBe(false);
  });

  it("does not return symlinked files as regular path entries", async () => {
    await fs.writeFile(path.join(root, "state.json"), "{}");
    await fs.symlink(path.join(root, "state.json"), path.join(root, "logo.svg"));

    const result = await listPathsRecursively({
      ...WALK_ALL,
      dir: root,
      root,
      includeDirectories: false,
    });

    expect(result.paths).toEqual([
      { kind: "file", path: "state.json", name: "state.json" },
    ]);
  });

  it("walks dot paths when hidden entries are included but never .git (#2093)", async () => {
    await fs.mkdir(path.join(root, ".github", "workflows"), { recursive: true });
    await fs.writeFile(path.join(root, ".github", "workflows", "ci.yml"), "");
    await fs.mkdir(path.join(root, ".git"), { recursive: true });
    await fs.writeFile(path.join(root, ".git", "config"), "[core]\n");
    await fs.writeFile(path.join(root, "AGENTS.md"), "");

    const result = await listPathsRecursively({ ...WALK_ALL, dir: root, root });
    const paths = result.paths.map((entry) => entry.path);

    expect(paths).toContain("AGENTS.md");
    expect(paths).toContain(".github/workflows/ci.yml");
    expect(paths).not.toContain(".git");
    expect(paths).not.toContain(".git/config");
  });

  it("applies includeHidden and excludeNames at the entry, pruning the subtree", async () => {
    await fs.mkdir(path.join(root, ".github"), { recursive: true });
    await fs.writeFile(path.join(root, ".github", "ci.yml"), "");
    await fs.mkdir(path.join(root, "node_modules", "pkg"), { recursive: true });
    await fs.writeFile(path.join(root, "node_modules", "pkg", "index.js"), "");
    await fs.writeFile(path.join(root, "index.ts"), "");

    const result = await listPathsRecursively({
      ...WALK_ALL,
      dir: root,
      root,
      includeHidden: false,
      excludeNames: new Set(["node_modules"]),
    });

    expect(result.paths.map((entry) => entry.path)).toEqual(["index.ts"]);
  });

  it("stops at the entry cap and reports truncation", async () => {
    for (let index = 0; index < 6; index += 1) {
      await fs.writeFile(path.join(root, `file-${index}.txt`), "");
    }

    const result = await listPathsRecursively({
      ...WALK_ALL,
      dir: root,
      root,
      maxEntries: 4,
    });

    expect(result.paths).toHaveLength(4);
    expect(result.truncated).toBe(true);
  });

  it("normalizes Windows separators before returning paths", () => {
    expect(normalizeListedPath("src\\components\\Button.tsx")).toBe(
      "src/components/Button.tsx",
    );
  });
});

describe("listRootPaths", () => {
  let root: string;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "bb-file-list-git-"));
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  async function seedRepo(): Promise<void> {
    await initGitRepo(root);
    await fs.mkdir(path.join(root, ".github", "workflows"), { recursive: true });
    await fs.writeFile(path.join(root, ".github", "workflows", "ci.yml"), "");
    await fs.mkdir(path.join(root, "src"), { recursive: true });
    await fs.writeFile(path.join(root, "src", "index.ts"), "");
    await fs.writeFile(path.join(root, ".gitignore"), ".venv/\n.env\n");
    await fs.mkdir(path.join(root, ".venv", "lib", "site-packages"), {
      recursive: true,
    });
    await fs.writeFile(
      path.join(root, ".venv", "lib", "site-packages", "config.py"),
      "",
    );
    await fs.writeFile(path.join(root, ".env"), "SECRET=1\n");
    await fs.mkdir(path.join(root, "node_modules", "pkg"), { recursive: true });
    await fs.writeFile(path.join(root, "node_modules", "pkg", "index.js"), "");
  }

  it("lists tracked and untracked-not-ignored paths from git, synthesising directories", async () => {
    await seedRepo();
    await runGit(["add", ".github", "src", ".gitignore"], root);
    await runGit(["commit", "-q", "-m", "init"], root);
    await fs.writeFile(path.join(root, "untracked.md"), "");

    const result = await listRootPaths({
      root,
      includeFiles: true,
      includeDirectories: true,
      includeHidden: true,
      excludeNames: ["node_modules"],
      respectGitignore: true,
    });

    expect(result.paths).toEqual([
      { kind: "directory", path: ".github", name: ".github" },
      { kind: "directory", path: ".github/workflows", name: "workflows" },
      { kind: "file", path: ".github/workflows/ci.yml", name: "ci.yml" },
      { kind: "file", path: ".gitignore", name: ".gitignore" },
      { kind: "directory", path: "src", name: "src" },
      { kind: "file", path: "src/index.ts", name: "index.ts" },
      { kind: "file", path: "untracked.md", name: "untracked.md" },
    ]);
    expect(result.truncated).toBe(false);
  });

  it("keeps gitignored trees, node_modules and .git out of the listing", async () => {
    await seedRepo();

    const result = await listRootPaths({
      root,
      includeFiles: true,
      includeDirectories: true,
      includeHidden: true,
      excludeNames: ["node_modules"],
      respectGitignore: true,
    });
    const paths = result.paths.map((entry) => entry.path);

    expect(paths).toContain(".github/workflows/ci.yml");
    expect(paths.filter((entry) => entry.startsWith(".venv"))).toEqual([]);
    expect(paths).not.toContain(".env");
    expect(paths.filter((entry) => entry.startsWith("node_modules"))).toEqual(
      [],
    );
    expect(paths.filter((entry) => entry.startsWith(".git/"))).toEqual([]);
    expect(paths).not.toContain(".git");
  });

  it("hides dot paths from the git listing when includeHidden is false", async () => {
    await seedRepo();

    const result = await listRootPaths({
      root,
      includeFiles: true,
      includeDirectories: false,
      includeHidden: false,
      excludeNames: [],
      respectGitignore: true,
    });

    expect(result.paths.map((entry) => entry.path)).toEqual([
      "node_modules/pkg/index.js",
      "src/index.ts",
    ]);
  });

  it("walks the disk when gitignore is not to be respected", async () => {
    await seedRepo();

    const result = await listRootPaths({
      root,
      includeFiles: true,
      includeDirectories: false,
      includeHidden: true,
      excludeNames: ["node_modules"],
      respectGitignore: false,
    });
    const paths = result.paths.map((entry) => entry.path);

    expect(paths).toContain(".venv/lib/site-packages/config.py");
    expect(paths).toContain(".env");
    expect(paths).toContain(".github/workflows/ci.yml");
    expect(paths.filter((entry) => entry.startsWith(".git/"))).toEqual([]);
  });

  it("falls back to the disk walk outside a git worktree", async () => {
    await fs.mkdir(path.join(root, ".github"), { recursive: true });
    await fs.writeFile(path.join(root, ".github", "ci.yml"), "");
    await fs.writeFile(path.join(root, "notes.md"), "");

    const result = await listRootPaths({
      root,
      includeFiles: true,
      includeDirectories: false,
      includeHidden: true,
      excludeNames: [],
      respectGitignore: true,
    });

    expect(result.paths.map((entry) => entry.path).sort()).toEqual([
      ".github/ci.yml",
      "notes.md",
    ]);
  });

  it("falls back to the disk walk when the root itself is gitignored", async () => {
    await initGitRepo(root);
    await fs.writeFile(path.join(root, ".gitignore"), "scratch/\n");
    await fs.mkdir(path.join(root, "scratch"), { recursive: true });
    await fs.writeFile(path.join(root, "scratch", "notes.md"), "");

    const result = await listRootPaths({
      root: path.join(root, "scratch"),
      includeFiles: true,
      includeDirectories: false,
      includeHidden: true,
      excludeNames: [],
      respectGitignore: true,
    });

    expect(result.paths.map((entry) => entry.path)).toEqual(["notes.md"]);
  });
});


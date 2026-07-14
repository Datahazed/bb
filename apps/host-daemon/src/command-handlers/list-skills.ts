import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { resolveDataDirSkillsRootPath } from "@bb/config/skill-storage-paths";
import type {
  HostDaemonOnlineRpcResult,
  SkillRootKind,
} from "@bb/host-daemon-contract";
import {
  CommandDispatchError,
  type CommandOf,
  ExpectedCommandDispatchError,
} from "../command-dispatch-support.js";
import {
  type CommandScanRoot,
  discoverSkills,
  type SkillScanRoot,
} from "../command-discovery.js";
import {
  type CommandRootResolution,
  resolveCodexHome,
  resolveProviderCommandScanRoots,
} from "./list-commands.js";

const SKILL_FILE_NAME = "SKILL.md";

/**
 * Classify a scan root by its originating identity so the server can map it to a
 * product scope. Plugin roots are tagged structurally (they always carry a
 * `namePrefix`); the bb/provider base roots are matched by exact path against
 * the same resolution that produced them, keeping a single source of truth for
 * the paths in `resolveProviderCommandScanRoots`. Returns `null` for roots that
 * are not surfaced as skills (legacy command roots, or an unrecognized root).
 */
function classifySkillRootKind(
  root: CommandScanRoot,
  resolution: CommandRootResolution,
): SkillRootKind | null {
  if (root.source !== "skill") {
    return null;
  }
  if (root.namePrefix !== "") {
    return "plugin";
  }
  // All non-plugin skill base roots are directory-shaped.
  if (root.shape !== "skill") {
    return null;
  }
  const { rootPath } = root;
  if (
    resolution.cwd !== null &&
    rootPath === path.join(resolution.cwd, ".bb", "skills")
  ) {
    return "bb-project";
  }
  if (rootPath === resolveDataDirSkillsRootPath(resolution.dataDir)) {
    return "bb-data-dir";
  }
  if (rootPath === resolution.builtinSkillsRootPath) {
    return "bb-builtin";
  }
  if (
    resolution.cwd !== null &&
    (rootPath === path.join(resolution.cwd, ".claude", "skills") ||
      rootPath === path.join(resolution.cwd, ".codex", "skills"))
  ) {
    return "provider-project";
  }
  if (
    rootPath === path.join(resolution.homeDir, ".claude", "skills") ||
    rootPath === path.join(resolution.codexHome, "skills") ||
    rootPath === path.join(resolution.codexHome, "skills", ".system")
  ) {
    return "provider-user";
  }
  return null;
}

/**
 * Resolve the skill scan roots for a provider and tag each with its `rootKind`.
 * Reuses the command-typeahead root resolution verbatim (single source of root
 * paths), then drops non-skill roots and roots that do not classify.
 */
export async function resolveSkillScanRoots(
  resolution: CommandRootResolution,
): Promise<SkillScanRoot[]> {
  const roots = await resolveProviderCommandScanRoots(resolution);
  const skillRoots: SkillScanRoot[] = [];
  for (const root of roots) {
    const rootKind = classifySkillRootKind(root, resolution);
    if (rootKind === null) {
      continue;
    }
    skillRoots.push({ ...root, rootKind });
  }
  return skillRoots;
}

export async function listHostSkills(
  command: CommandOf<"host.list_skills">,
  options: { dataDir: string },
): Promise<HostDaemonOnlineRpcResult<"host.list_skills">> {
  if (command.cwd !== null && !path.isAbsolute(command.cwd)) {
    throw new CommandDispatchError("invalid_path", "cwd must be absolute");
  }
  if (!path.isAbsolute(command.builtinSkillsRootPath)) {
    throw new CommandDispatchError(
      "invalid_path",
      "builtinSkillsRootPath must be absolute",
    );
  }
  const homeDir = os.homedir();
  const roots = await resolveSkillScanRoots({
    cwd: command.cwd,
    builtinSkillsRootPath: command.builtinSkillsRootPath,
    // Skill listing does not surface managed-dev-app inherited roots; they are
    // not classified as skills (see classifySkillRootKind) and `host.list_skills`
    // carries no such field.
    additionalSkillsRootPaths: [],
    dataDir: options.dataDir,
    homeDir,
    codexHome: resolveCodexHome(homeDir),
    providerId: command.providerId,
  });
  const skills = await discoverSkills({ roots });
  return { skills };
}

function isSafeSkillName(name: string): boolean {
  return (
    name.length > 0 &&
    name !== "." &&
    name !== ".." &&
    name === path.basename(name) &&
    !name.includes("/") &&
    !name.includes("\\")
  );
}

/**
 * Resolve the root that owns a deletable skill. bb roots are derived locally;
 * provider roots are supplied by the server after authoritative discovery.
 */
function resolveDeletableSkillRoot(
  args: {
    scope: CommandOf<"host.delete_skill">["scope"];
    cwd: string | null;
    rootPath: string | null;
  },
  dataDir: string,
): string {
  if (args.scope === "bb-user") {
    return resolveDataDirSkillsRootPath(dataDir);
  }
  if (args.scope === "bb-project") {
    const cwd = args.cwd;
    if (cwd === null) {
      throw new CommandDispatchError(
        "invalid_path",
        "cwd is required for a bb-project skill",
      );
    }
    if (!path.isAbsolute(cwd)) {
      throw new CommandDispatchError("invalid_path", "cwd must be absolute");
    }
    return path.join(cwd, ".bb", "skills");
  }
  if (args.rootPath === null || !path.isAbsolute(args.rootPath)) {
    throw new CommandDispatchError(
      "invalid_path",
      "rootPath must be absolute for a provider skill",
    );
  }
  return args.rootPath;
}

async function realpathOrNull(targetPath: string): Promise<string | null> {
  try {
    return await fs.realpath(targetPath);
  } catch {
    return null;
  }
}

/**
 * Delete a user-owned skill directory. Defense-in-depth confinement requires a
 * safe single-segment name and an exact realpath match to the named direct
 * child `<root>/<name>`, refusing symlink leaves before recursive removal.
 */
export async function deleteHostSkill(
  command: CommandOf<"host.delete_skill">,
  options: { dataDir: string },
): Promise<HostDaemonOnlineRpcResult<"host.delete_skill">> {
  if (!isSafeSkillName(command.name)) {
    throw new CommandDispatchError(
      "invalid_skill_name",
      "Skill name must be a single path segment",
    );
  }
  const root = resolveDeletableSkillRoot(
    {
      scope: command.scope,
      cwd: command.cwd,
      rootPath: command.rootPath,
    },
    options.dataDir,
  );
  const skillDirPath = path.join(root, command.name);

  const realRoot = await realpathOrNull(root);
  const realTarget = await realpathOrNull(skillDirPath);
  if (realRoot === null || realTarget === null) {
    throw new ExpectedCommandDispatchError(
      "skill_not_found",
      `Skill "${command.name}" not found`,
    );
  }
  // Must resolve to the named direct child — a symlinked leaf pointing anywhere
  // else (in or out of the root) is refused for this destructive op.
  if (realTarget !== path.join(realRoot, command.name)) {
    throw new CommandDispatchError(
      "skill_outside_root",
      "Refusing to delete a skill that resolves outside its skill root",
    );
  }

  const targetStat = await fs.stat(realTarget).catch(() => null);
  if (targetStat === null || !targetStat.isDirectory()) {
    throw new ExpectedCommandDispatchError(
      "skill_not_found",
      `Skill "${command.name}" not found`,
    );
  }
  const skillFileStat = await fs
    .stat(path.join(realTarget, SKILL_FILE_NAME))
    .catch(() => null);
  if (skillFileStat === null || !skillFileStat.isFile()) {
    throw new CommandDispatchError(
      "not_a_skill",
      `"${command.name}" is not a skill directory`,
    );
  }

  await fs.rm(realTarget, { recursive: true, force: false });
  return { deletedPath: realTarget };
}

/**
 * Overwrite an existing bb skill's SKILL.md. Same confinement as delete: path
 * built host-side from `(scope, name, cwd)`, name a single safe segment, and the
 * resolved target must be exactly `<bb-root>/<name>` of an existing skill (one
 * whose SKILL.md already exists). Edits only — never creates a new skill.
 */
export async function writeHostSkill(
  command: CommandOf<"host.write_skill">,
  options: { dataDir: string },
): Promise<HostDaemonOnlineRpcResult<"host.write_skill">> {
  if (!isSafeSkillName(command.name)) {
    throw new CommandDispatchError(
      "invalid_skill_name",
      "Skill name must be a single path segment",
    );
  }
  const root = resolveDeletableSkillRoot(
    { scope: command.scope, cwd: command.cwd, rootPath: null },
    options.dataDir,
  );
  const realRoot = await realpathOrNull(root);
  const realTarget = await realpathOrNull(path.join(root, command.name));
  if (realRoot === null || realTarget === null) {
    throw new ExpectedCommandDispatchError(
      "skill_not_found",
      `Skill "${command.name}" not found`,
    );
  }
  if (realTarget !== path.join(realRoot, command.name)) {
    throw new CommandDispatchError(
      "skill_outside_root",
      "Refusing to edit a skill that resolves outside its bb root",
    );
  }
  const skillFilePath = path.join(realTarget, SKILL_FILE_NAME);
  // Edit-only: the SKILL.md must already exist (creation is via prompt).
  const skillFileStat = await fs.stat(skillFilePath).catch(() => null);
  if (skillFileStat === null || !skillFileStat.isFile()) {
    throw new ExpectedCommandDispatchError(
      "skill_not_found",
      `Skill "${command.name}" not found`,
    );
  }
  await fs.writeFile(skillFilePath, command.content, "utf8");
  return { filePath: skillFilePath };
}

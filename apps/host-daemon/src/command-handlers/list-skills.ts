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
 * The bb root that owns a deletable scope. `bb-user` is the data-dir skills
 * root; `bb-project` is `<cwd>/.bb/skills`. These are the only roots the daemon
 * will ever delete from.
 */
function resolveDeletableSkillRoot(
  command: CommandOf<"host.delete_skill">,
  dataDir: string,
): string {
  if (command.scope === "bb-user") {
    return resolveDataDirSkillsRootPath(dataDir);
  }
  if (command.cwd === null) {
    throw new CommandDispatchError(
      "invalid_path",
      "cwd is required to delete a bb-project skill",
    );
  }
  if (!path.isAbsolute(command.cwd)) {
    throw new CommandDispatchError("invalid_path", "cwd must be absolute");
  }
  return path.join(command.cwd, ".bb", "skills");
}

async function realpathOrNull(targetPath: string): Promise<string | null> {
  try {
    return await fs.realpath(targetPath);
  } catch {
    return null;
  }
}

/**
 * Delete a bb skill directory. Defense-in-depth confinement: the target path is
 * built server-side from `(scope, name)` (never a client path), `name` must be a
 * single safe path segment, and after realpath resolution the target must be
 * exactly the direct child `<root>/<name>` of its allowed bb root. That exact
 * match both confines the delete inside the root and refuses any symlink leaf
 * that would redirect it elsewhere. Only then is `<root>/<name>/` removed.
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
  const root = resolveDeletableSkillRoot(command, options.dataDir);
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
      "Refusing to delete a skill that resolves outside its bb root",
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

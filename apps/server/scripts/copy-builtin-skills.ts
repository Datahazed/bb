import { rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  BUILTIN_SKILLS_DIRECTORY_NAME,
  copyBuiltinSkills,
  resolveBuiltinSkillsRootPath,
} from "../src/services/skills/builtin-skills-copy.js";

// Build step: copies the built-in injected skills into dist so the bundled
// server resolves them beside its dist entry points, mirroring the app
// scaffold template copy.
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const targetPath = path.resolve(
  scriptDir,
  "../dist",
  BUILTIN_SKILLS_DIRECTORY_NAME,
);

const skillsRootPath = resolveBuiltinSkillsRootPath();
await rm(targetPath, { force: true, recursive: true });
await copyBuiltinSkills({ skillsRootPath, targetPath });

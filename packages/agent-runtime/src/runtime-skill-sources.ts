import path from "node:path";
import type { AgentRuntimeSkillSource } from "./types.js";

export function normalizeSkillSources(
  skillSources: readonly AgentRuntimeSkillSource[] | undefined,
): readonly AgentRuntimeSkillSource[] {
  return (skillSources ?? []).map((source) => {
    if (!path.isAbsolute(source.rootPath)) {
      throw new Error(
        `Agent runtime skill source "${source.id}" must use an absolute rootPath: ${source.rootPath}`,
      );
    }
    return {
      id: source.id,
      rootPath: source.rootPath,
      skills: source.skills.map((skill) => ({
        description: skill.description,
        name: skill.name,
      })),
    };
  });
}

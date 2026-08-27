import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const skillRoot = fileURLToPath(
  new URL(
    "../../src/services/skills/builtin-skills/plugin-listing-screenshots/",
    import.meta.url,
  ),
);
const skillPath = path.join(skillRoot, "SKILL.md");
const submitSkillPath = fileURLToPath(
  new URL(
    "../../src/services/skills/builtin-skills/submit-a-plugin/SKILL.md",
    import.meta.url,
  ),
);

describe("plugin-listing-screenshots skill", () => {
  it("keeps the capture workflow and quality gate operational", async () => {
    const skill = await readFile(skillPath, "utf8");

    expect(skill).toContain("name: plugin-listing-screenshots");
    expect(skill).toContain("`bb plugin screenshot [path] --capture <dir>`");
    expect(skill).toContain("Seed first, capture second, review every shot.");
    expect(skill).toContain(
      "The first screenshot must show the plugin doing its job with realistic data.",
    );
    for (const rejection of [
      "An empty state as the first image",
      "Skeleton rows, spinners, half-painted lists",
      "A panel with one lonely row",
      "Real secrets, tokens, private repos, customer names",
      "`lorem ipsum`, `test test`, `asdf`",
    ]) {
      expect(skill).toContain(rejection);
    }
    expect(skill).toContain("--fixture-thread <id>");
    expect(skill).toContain("Open every image.");
    expect(skill).toContain("Crop to the surface, not the desktop.");
  });

  it("gates capture on host safety, seeded data, and being a product surface", async () => {
    const skill = await readFile(skillPath, "utf8");

    // These three ran as review rules until a capture on a working machine
    // photographed a real personal vault. They only help before the shutter.
    expect(skill).toContain("## Before you capture anything");
    expect(skill).toContain("Is this host safe to photograph?");
    expect(skill).toContain("Does the surface have anything in it yet?");
    expect(skill).toContain("Is this a product surface at all?");
  });

  it("is explicitly part of the marketplace submission procedure", async () => {
    const submitSkill = await readFile(submitSkillPath, "utf8");

    expect(submitSkill).toContain(
      "`bb plugin screenshot [path] --capture <dir>`",
    );
    expect(submitSkill).toContain("`plugin-listing-screenshots` skill");
    expect(submitSkill).toContain("Seed the plugin's data before capturing");
  });
});

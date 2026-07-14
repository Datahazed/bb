import { mkdir, mkdtemp, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DiscoveredSkill } from "@bb/host-daemon-contract";
import { discoverSkills } from "../command-discovery.js";
import { CommandDispatchError } from "../command-dispatch-support.js";
import { deleteHostSkill, resolveSkillScanRoots } from "./list-skills.js";

interface WorkspaceFixture {
  cwd: string;
  builtinSkillsRootPath: string;
  dataDir: string;
  homeDir: string;
  codexHome: string;
}

let tempRoot: string;

async function writeSkill(filePath: string, name: string): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(
    filePath,
    `---\nname: ${name}\ndescription: ${name} skill\n---\n`,
    "utf8",
  );
}

async function makeWorkspaceFixture(): Promise<WorkspaceFixture> {
  const cwd = path.join(tempRoot, "workspace");
  const builtinSkillsRootPath = path.join(tempRoot, "builtin-skills");
  const dataDir = path.join(tempRoot, "bb-data");
  const homeDir = path.join(tempRoot, "home");
  const codexHome = path.join(homeDir, ".codex");
  await mkdir(cwd, { recursive: true });
  await mkdir(builtinSkillsRootPath, { recursive: true });
  await mkdir(dataDir, { recursive: true });
  await mkdir(homeDir, { recursive: true });
  await mkdir(codexHome, { recursive: true });
  return { cwd, builtinSkillsRootPath, dataDir, homeDir, codexHome };
}

async function listSkills(
  fixture: WorkspaceFixture,
  providerId: "claude-code" | "codex",
  cwd: string | null,
): Promise<DiscoveredSkill[]> {
  return discoverSkills({
    roots: await resolveSkillScanRoots({
      providerId,
      cwd,
      builtinSkillsRootPath: fixture.builtinSkillsRootPath,
      additionalSkillsRootPaths: [],
      dataDir: fixture.dataDir,
      homeDir: fixture.homeDir,
      codexHome: fixture.codexHome,
    }),
  });
}

function byName(
  skills: DiscoveredSkill[],
  name: string,
): DiscoveredSkill | undefined {
  return skills.find((skill) => skill.name === name);
}

beforeEach(async () => {
  tempRoot = await mkdtemp(path.join(tmpdir(), "bb-list-skills-"));
});

afterEach(async () => {
  await rm(tempRoot, { recursive: true, force: true });
});

describe("resolveSkillScanRoots + discoverSkills (claude-code)", () => {
  it("classifies each bb / provider root and emits filePath", async () => {
    const fixture = await makeWorkspaceFixture();
    const files = {
      "proj-bb": path.join(fixture.cwd, ".bb", "skills", "proj-bb", "SKILL.md"),
      "data-bb": path.join(fixture.dataDir, "skills", "data-bb", "SKILL.md"),
      "builtin-bb": path.join(
        fixture.builtinSkillsRootPath,
        "builtin-bb",
        "SKILL.md",
      ),
      "proj-claude": path.join(
        fixture.cwd,
        ".claude",
        "skills",
        "proj-claude",
        "SKILL.md",
      ),
      "user-claude": path.join(
        fixture.homeDir,
        ".claude",
        "skills",
        "user-claude",
        "SKILL.md",
      ),
    };
    for (const [name, filePath] of Object.entries(files)) {
      await writeSkill(filePath, name);
    }

    const skills = await listSkills(fixture, "claude-code", fixture.cwd);

    expect(byName(skills, "proj-bb")).toEqual({
      name: "proj-bb",
      description: "proj-bb skill",
      filePath: files["proj-bb"],
      rootKind: "bb-project",
    });
    expect(byName(skills, "data-bb")?.rootKind).toBe("bb-data-dir");
    expect(byName(skills, "builtin-bb")?.rootKind).toBe("bb-builtin");
    expect(byName(skills, "proj-claude")?.rootKind).toBe("provider-project");
    expect(byName(skills, "user-claude")?.rootKind).toBe("provider-user");
    // Every record carries its absolute SKILL.md path.
    expect(byName(skills, "user-claude")?.filePath).toBe(files["user-claude"]);
  });

  it("drops project roots when cwd is null", async () => {
    const fixture = await makeWorkspaceFixture();
    await writeSkill(
      path.join(fixture.cwd, ".bb", "skills", "proj-bb", "SKILL.md"),
      "proj-bb",
    );
    await writeSkill(
      path.join(fixture.dataDir, "skills", "data-bb", "SKILL.md"),
      "data-bb",
    );

    const skills = await listSkills(fixture, "claude-code", null);

    expect(byName(skills, "proj-bb")).toBeUndefined();
    expect(byName(skills, "data-bb")?.rootKind).toBe("bb-data-dir");
  });
});

describe("resolveSkillScanRoots + discoverSkills (codex)", () => {
  it("classifies codex project/user roots", async () => {
    const fixture = await makeWorkspaceFixture();
    await writeSkill(
      path.join(fixture.cwd, ".codex", "skills", "proj-codex", "SKILL.md"),
      "proj-codex",
    );
    await writeSkill(
      path.join(fixture.codexHome, "skills", "user-codex", "SKILL.md"),
      "user-codex",
    );
    await writeSkill(
      path.join(fixture.cwd, ".bb", "skills", "proj-bb", "SKILL.md"),
      "proj-bb",
    );

    const skills = await listSkills(fixture, "codex", fixture.cwd);

    expect(byName(skills, "proj-codex")?.rootKind).toBe("provider-project");
    expect(byName(skills, "user-codex")?.rootKind).toBe("provider-user");
    // bb roots are shared across providers.
    expect(byName(skills, "proj-bb")?.rootKind).toBe("bb-project");
  });
});

describe("deleteHostSkill", () => {
  it("deletes a bb-user skill directory", async () => {
    const fixture = await makeWorkspaceFixture();
    const skillDir = path.join(fixture.dataDir, "skills", "doomed");
    await writeSkill(path.join(skillDir, "SKILL.md"), "doomed");

    const result = await deleteHostSkill(
      {
        type: "host.delete_skill",
        scope: "bb-user",
        name: "doomed",
        cwd: null,
        rootPath: null,
      },
      { dataDir: fixture.dataDir },
    );

    expect(await stat(skillDir).catch(() => null)).toBeNull();
    expect(result.deletedPath).toContain("doomed");
  });

  it("deletes a bb-project skill directory under cwd/.bb/skills", async () => {
    const fixture = await makeWorkspaceFixture();
    const skillDir = path.join(fixture.cwd, ".bb", "skills", "proj-doomed");
    await writeSkill(path.join(skillDir, "SKILL.md"), "proj-doomed");

    await deleteHostSkill(
      {
        type: "host.delete_skill",
        scope: "bb-project",
        name: "proj-doomed",
        cwd: fixture.cwd,
        rootPath: null,
      },
      { dataDir: fixture.dataDir },
    );

    expect(await stat(skillDir).catch(() => null)).toBeNull();
  });

  it("deletes a user-owned provider skill inside its discovered root", async () => {
    const fixture = await makeWorkspaceFixture();
    const providerRoot = path.join(fixture.homeDir, ".claude", "skills");
    const skillDir = path.join(providerRoot, "notes");
    await writeSkill(path.join(skillDir, "SKILL.md"), "notes");

    await deleteHostSkill(
      {
        type: "host.delete_skill",
        scope: "claude-user",
        name: "notes",
        cwd: null,
        rootPath: providerRoot,
      },
      { dataDir: fixture.dataDir },
    );

    expect(await stat(skillDir).catch(() => null)).toBeNull();
  });

  it("refuses a name that escapes the root via path traversal", async () => {
    const fixture = await makeWorkspaceFixture();
    await expect(
      deleteHostSkill(
        {
          type: "host.delete_skill",
          scope: "bb-user",
          name: "../evil",
          cwd: null,
          rootPath: null,
        },
        { dataDir: fixture.dataDir },
      ),
    ).rejects.toMatchObject({ code: "invalid_skill_name" });
  });

  it("refuses a skill symlinked outside the bb root after realpath", async () => {
    const fixture = await makeWorkspaceFixture();
    // A real skill dir living outside any bb root.
    const outside = path.join(tempRoot, "outside", "secret");
    await writeSkill(path.join(outside, "SKILL.md"), "secret");
    // A symlink inside the bb-user root pointing at it.
    const skillsRoot = path.join(fixture.dataDir, "skills");
    await mkdir(skillsRoot, { recursive: true });
    await symlink(outside, path.join(skillsRoot, "link"));

    await expect(
      deleteHostSkill(
        {
          type: "host.delete_skill",
          scope: "bb-user",
          name: "link",
          cwd: null,
          rootPath: null,
        },
        { dataDir: fixture.dataDir },
      ),
    ).rejects.toMatchObject({ code: "skill_outside_root" });
    // The real target survives the refusal.
    expect(
      await stat(path.join(outside, "SKILL.md")).catch(() => null),
    ).not.toBeNull();
  });

  it("refuses a skill symlinked to a sibling inside the same root", async () => {
    const fixture = await makeWorkspaceFixture();
    const skillsRoot = path.join(fixture.dataDir, "skills");
    // A real sibling skill, and a symlink that resolves to it.
    await writeSkill(path.join(skillsRoot, "real", "SKILL.md"), "real");
    await symlink(
      path.join(skillsRoot, "real"),
      path.join(skillsRoot, "alias"),
    );

    await expect(
      deleteHostSkill(
        {
          type: "host.delete_skill",
          scope: "bb-user",
          name: "alias",
          cwd: null,
          rootPath: null,
        },
        { dataDir: fixture.dataDir },
      ),
    ).rejects.toMatchObject({ code: "skill_outside_root" });
    // The sibling the alias pointed at is untouched.
    expect(
      await stat(path.join(skillsRoot, "real", "SKILL.md")).catch(() => null),
    ).not.toBeNull();
  });

  it("reports skill_not_found for a missing skill", async () => {
    const fixture = await makeWorkspaceFixture();
    await mkdir(path.join(fixture.dataDir, "skills"), { recursive: true });
    await expect(
      deleteHostSkill(
        {
          type: "host.delete_skill",
          scope: "bb-user",
          name: "ghost",
          cwd: null,
          rootPath: null,
        },
        { dataDir: fixture.dataDir },
      ),
    ).rejects.toBeInstanceOf(CommandDispatchError);
  });

  it("refuses a directory that is not a skill (no SKILL.md)", async () => {
    const fixture = await makeWorkspaceFixture();
    const notSkill = path.join(fixture.dataDir, "skills", "plain");
    await mkdir(notSkill, { recursive: true });
    await writeFile(path.join(notSkill, "README.md"), "not a skill", "utf8");

    await expect(
      deleteHostSkill(
        {
          type: "host.delete_skill",
          scope: "bb-user",
          name: "plain",
          cwd: null,
          rootPath: null,
        },
        { dataDir: fixture.dataDir },
      ),
    ).rejects.toMatchObject({ code: "not_a_skill" });
    expect(await stat(notSkill).catch(() => null)).not.toBeNull();
  });
});

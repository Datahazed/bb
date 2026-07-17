import { describe, expect, it, vi } from "vitest";
import {
  collectLogLines,
  getHelpOutput,
  runCommand,
  setupCommandOutputTestEnvironment,
  stubServerApi,
  type CommandRegistrar,
} from "../helpers/command-output-harness.js";
import { registerSkillCommands } from "../../commands/skill.js";

describe("bb skill commands", () => {
  setupCommandOutputTestEnvironment();

  const register: CommandRegistrar = (program) =>
    registerSkillCommands(
      program,
      () => "http://server",
      () => ({ projectId: "project-context", serverUrl: "http://server" }),
    );

  it("lists installed skills through the public SDK", async () => {
    const get = vi.fn(async () => ({
      skills: [
        {
          name: "review",
          description: "Review the current diff",
          provider: "codex",
          scope: "codex-user",
          filePath: "/home/user/.agents/skills/review/SKILL.md",
          manageable: true,
        },
      ],
    }));
    stubServerApi({ "v1.projects.:id.skills.$get": get });

    await runCommand(["skill", "list"], register);

    expect(get).toHaveBeenCalledWith({
      param: { id: "project-context" },
      query: { environmentId: "" },
    });
    expect(collectLogLines(vi.mocked(console.log)).join("\n")).toContain(
      "review",
    );
  });

  it("installs only by canonical registry identity", async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(
      new Response(
        JSON.stringify({
          ok: true,
          filePath: "/home/user/.bb/skills/review/SKILL.md",
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );

    await runCommand(
      ["skill", "install", "owner/repo/review", "--json"],
      register,
    );

    const [input, init] = vi.mocked(globalThis.fetch).mock.calls[0] ?? [];
    expect(String(input)).toBe("http://server/api/v1/skills-registry/install");
    expect(JSON.parse(String(init?.body))).toEqual({
      registrySkillId: "owner/repo/review",
      projectId: "project-context",
    });
  });

  it("documents the installed and registry lifecycle", async () => {
    const help = await getHelpOutput(["skill"], register);
    for (const command of [
      "list",
      "show",
      "files",
      "update",
      "delete",
      "search",
      "install",
    ]) {
      expect(help).toContain(command);
    }
  });
});

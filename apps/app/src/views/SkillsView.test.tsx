import { renderToStaticMarkup } from "react-dom/server";
import type { SkillSummary } from "@bb/server-contract";
import { describe, expect, it } from "vitest";
import { SkillsOverview, groupSkillsByProvider } from "./SkillsView";

function makeSkill(overrides: Partial<SkillSummary> = {}): SkillSummary {
  return {
    name: "code-review",
    description: "Review the current diff.",
    provider: "claude-code",
    scope: "claude-user",
    filePath: "/home/u/.claude/skills/code-review/SKILL.md",
    manageable: false,
    ...overrides,
  };
}

function render(props: Partial<Parameters<typeof SkillsOverview>[0]>): string {
  return renderToStaticMarkup(
    <SkillsOverview
      skills={props.skills ?? []}
      isLoading={props.isLoading ?? false}
      hasError={props.hasError ?? false}
    />,
  );
}

describe("groupSkillsByProvider", () => {
  it("groups by provider with bb-agnostic skills last", () => {
    const groups = groupSkillsByProvider([
      makeSkill({ name: "bb-skill", provider: null, scope: "bb-user" }),
      makeSkill({ name: "claude-skill", provider: "claude-code" }),
      makeSkill({ name: "codex-skill", provider: "codex", scope: "codex" }),
    ]);
    expect(groups.map((g) => g.key)).toEqual(["claude-code", "codex", "bb"]);
    expect(groups.at(-1)?.label).toBe("bb");
  });
});

describe("SkillsOverview", () => {
  it("renders provider groups with calm name + description rows", () => {
    const markup = render({
      skills: [
        makeSkill({ name: "claude-skill", provider: "claude-code" }),
        makeSkill({ name: "bb-skill", provider: null, scope: "bb-user" }),
      ],
    });
    expect(markup).toContain("claude-skill");
    expect(markup).toContain("Review the current diff.");
    // bb group header renders, and after the provider group
    expect(markup).toContain(">bb<");
    expect(markup.indexOf("claude-skill")).toBeLessThan(
      markup.indexOf("bb-skill"),
    );
  });

  it("shows the empty state when there are no skills", () => {
    expect(render({ skills: [] })).toContain("No skills yet.");
  });

  it("shows a loading state", () => {
    const markup = render({ skills: [], isLoading: true });
    expect(markup).toContain("Loading...");
    expect(markup).not.toContain("No skills yet.");
  });

  it("shows a destructive error state", () => {
    const markup = render({ skills: [], hasError: true });
    expect(markup).toContain("Failed to load skills.");
    expect(markup).toContain("text-destructive");
  });
});

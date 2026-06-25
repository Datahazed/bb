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
      onCreateSkill={props.onCreateSkill ?? (() => {})}
      onSelectSkill={props.onSelectSkill ?? (() => {})}
      onRetry={props.onRetry}
    />,
  );
}

describe("groupSkillsByProvider", () => {
  it("groups by provider with bb-agnostic skills first", () => {
    const groups = groupSkillsByProvider([
      makeSkill({ name: "claude-skill", provider: "claude-code" }),
      makeSkill({ name: "bb-skill", provider: null, scope: "bb-user" }),
      makeSkill({ name: "codex-skill", provider: "codex", scope: "codex" }),
    ]);
    expect(groups.map((g) => g.key)).toEqual(["bb", "claude-code", "codex"]);
    expect(groups[0]?.label).toBe("bb");
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
    // bb group header renders, and bb comes before the provider group
    expect(markup).toContain(">bb<");
    expect(markup.indexOf("bb-skill")).toBeLessThan(
      markup.indexOf("claude-skill"),
    );
    // collapsible section headers, expanded by default
    expect(markup).toContain('aria-expanded="true"');
  });

  it("renders a New bb skill create action", () => {
    expect(render({ skills: [] })).toContain("New bb skill");
  });

  it("keeps create out of the list (templates live in the menu, not a panel)", () => {
    // The page is never truly empty (built-ins always ship), so there is no
    // persistent teaching panel; the create templates live in the closed menu.
    const markup = render({ skills: [] });
    expect(markup).toContain("New bb skill");
    expect(markup).not.toContain("Start from an example");
  });

  it("shows a loading skeleton", () => {
    const markup = render({ skills: [], isLoading: true });
    expect(markup).toContain('aria-label="Loading skills"');
    expect(markup).toContain("animate-pulse");
    expect(markup).not.toContain("Start from an example");
  });

  it("shows a recoverable error state with a retry", () => {
    const markup = render({ skills: [], hasError: true, onRetry: () => {} });
    // Apostrophe is HTML-escaped in static markup, so match the stable fragment.
    expect(markup).toContain("load skills.");
    expect(markup).toContain("Retry");
    expect(markup).toContain('role="alert"');
  });
});

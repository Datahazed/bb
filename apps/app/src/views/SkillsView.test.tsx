// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render as renderDom,
  screen,
  waitFor,
} from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import type { SkillSummary } from "@bb/server-contract";
import { afterEach, describe, expect, it } from "vitest";
import { SkillsOverview } from "./SkillsView";

afterEach(cleanup);

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

describe("SkillsOverview", () => {
  it("renders flat rows with provider filter and sort controls", () => {
    const markup = render({
      skills: [
        makeSkill({ name: "claude-skill", provider: "claude-code" }),
        makeSkill({ name: "bb-skill", provider: null, scope: "bb-user" }),
      ],
    });
    expect(markup).toContain("claude-skill");
    expect(markup).toContain("Review the current diff.");
    expect(markup).toContain("Provider");
    expect(markup).toContain("Sort");
    expect(markup.indexOf("bb-skill")).toBeLessThan(
      markup.indexOf("claude-skill"),
    );
    expect(markup).not.toContain('aria-expanded="true"');
  });

  it("disables provider filters that have no matching skills", async () => {
    renderDom(
      <SkillsOverview
        skills={[
          makeSkill({
            name: "codex-skill",
            provider: "codex",
            scope: "codex",
          }),
        ]}
        isLoading={false}
        hasError={false}
        onCreateSkill={() => {}}
        onSelectSkill={() => {}}
      />,
    );

    fireEvent.pointerDown(screen.getByRole("button", { name: "Provider" }));

    await waitFor(() => {
      expect(
        screen
          .getByRole("menuitem", { name: "Claude Code" })
          .getAttribute("aria-disabled"),
      ).toBe("true");
    });
    expect(
      screen
        .getByRole("menuitem", { name: "Codex" })
        .getAttribute("aria-disabled"),
    ).toBeNull();
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

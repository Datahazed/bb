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
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  installRegistrySkill,
  SkillsOverview,
  type RegistrySkill,
} from "./SkillsView";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

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
    expect(markup).toContain('aria-label="Agent"');
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

    fireEvent.pointerDown(screen.getByRole("button", { name: "Agent" }));

    await waitFor(() => {
      expect(
        screen
          .getByRole("menuitemcheckbox", { name: "Claude Code" })
          .getAttribute("aria-disabled"),
      ).toBe("true");
    });
    expect(
      screen
        .getByRole("menuitemcheckbox", { name: "Codex" })
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
    expect(markup).toContain('role="status"');
    expect(markup).toContain("Loading skills");
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

describe("installRegistrySkill", () => {
  it("installs at user scope for every configured provider", async () => {
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) => ({
        ok: true,
        json: async () => ({ ok: true }),
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const skill: RegistrySkill = {
      id: "owner/repo/skill",
      source: "owner/repo",
      skillId: "skill",
      name: "Skill",
      installs: 100,
      stars: 20,
      installUrl: null,
      url: "https://skills.sh/owner/repo/skill",
      topic: "Development",
      summary: "A useful skill.",
      worksWith: ["claude-code", "codex"],
    };

    await installRegistrySkill({
      skill,
      providers: ["claude-code", "codex"],
    });

    expect(fetchMock).toHaveBeenCalledOnce();
    const request = fetchMock.mock.calls[0];
    expect(request?.[0]).toBe("/api/v1/skills-registry/install");
    expect(JSON.parse(String(request?.[1]?.body))).toMatchObject({
      source: "owner/repo",
      skillId: "skill",
      scope: "user",
      providers: ["claude-code", "codex"],
    });
  });
});

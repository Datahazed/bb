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
  SkillDetailDialogView,
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
      onEditSkill={props.onEditSkill}
      onDeleteSkill={props.onDeleteSkill}
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

  it("shows edit and delete hover actions only for manageable skills", () => {
    const markup = render({
      skills: [
        makeSkill({
          name: "bb-skill",
          provider: null,
          scope: "bb-user",
          manageable: true,
        }),
        makeSkill({ name: "provider-skill" }),
      ],
      onEditSkill: () => {},
      onDeleteSkill: () => {},
    });
    expect(markup).toContain('aria-label="Edit bb-skill"');
    expect(markup).toContain('aria-label="Delete bb-skill"');
    expect(markup).not.toContain('aria-label="Edit provider-skill"');
    expect(markup).not.toContain('aria-label="Delete provider-skill"');
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

describe("SkillDetailDialogView", () => {
  it("uses a hoverable copy target and section-header icon actions", async () => {
    const skill = makeSkill({
      name: "bb-skill",
      provider: null,
      scope: "bb-user",
      manageable: true,
      filePath: "/home/u/.bb/skills/bb-skill/SKILL.md",
    });
    const onInitialEditStarted = vi.fn();
    renderDom(
      <SkillDetailDialogView
        skill={skill}
        content="# bb skill"
        isLoadingContent={false}
        isRefreshingContent={false}
        isContentError={false}
        canManage
        canOpenInEditor={false}
        initiallyEditing
        isSaving={false}
        isDeleting={false}
        onInitialEditStarted={onInitialEditStarted}
        onSave={async () => true}
        onDelete={() => {}}
        onOpenInEditor={() => {}}
      />,
    );

    const pathButton = screen.getByRole("button", {
      name: `Copy skill path: ${skill.filePath}`,
    });
    expect(pathButton.className).toContain("cursor-pointer");
    expect(pathButton.className).toContain("hover:bg-state-hover");
    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "Cancel editing" }),
      ).toBeTruthy();
      expect(screen.getByRole("button", { name: "Save skill" })).toBeTruthy();
    });
    expect(onInitialEditStarted).toHaveBeenCalledOnce();
  });

  it("waits for a fresh SKILL.md before entering route-requested edit mode", async () => {
    const skill = makeSkill({
      name: "bb-skill",
      provider: null,
      scope: "bb-user",
      manageable: true,
    });
    const onInitialEditStarted = vi.fn();
    const props = {
      skill,
      isLoadingContent: false,
      isContentError: false,
      canManage: true,
      canOpenInEditor: false,
      initiallyEditing: true,
      isSaving: false,
      isDeleting: false,
      onInitialEditStarted,
      onSave: async () => true,
      onDelete: () => {},
      onOpenInEditor: () => {},
    };
    const view = renderDom(
      <SkillDetailDialogView
        {...props}
        content="# stale cache"
        isRefreshingContent
      />,
    );

    expect(screen.queryByRole("button", { name: "Save skill" })).toBeNull();
    expect(onInitialEditStarted).not.toHaveBeenCalled();

    view.rerender(
      <SkillDetailDialogView
        {...props}
        content="# fresh file"
        isRefreshingContent={false}
      />,
    );

    await waitFor(() => {
      expect(
        screen.getByRole<HTMLTextAreaElement>("textbox", { name: "SKILL.md" })
          .value,
      ).toBe("# fresh file");
    });
    expect(onInitialEditStarted).toHaveBeenCalledOnce();
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

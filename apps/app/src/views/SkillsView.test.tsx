// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render as renderDom,
  screen,
  waitFor,
} from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { PERSONAL_PROJECT_ID } from "@bb/domain";
import type { SkillSummary } from "@bb/server-contract";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SkillDetailView } from "../components/tools/SkillDetailView";
import {
  fetchRegistrySkills,
  installRegistrySkill,
  RegistrySkillsBrowsePage,
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
    manageable: true,
    ...overrides,
  };
}

function makeRegistrySkill(
  overrides: Partial<RegistrySkill> = {},
): RegistrySkill {
  return {
    id: "owner/repo/useful-skill",
    source: "owner/repo",
    skillId: "useful-skill",
    name: "Useful skill",
    installs: 100,
    stars: 20,
    installUrl: null,
    url: "https://skills.sh/owner/repo/useful-skill",
    topic: "Development",
    summary: "A useful skill.",
    worksWith: ["claude-code", "codex"],
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
    expect(markup).toContain("Installed skills");
    expect(markup).not.toContain('aria-label="Open bb-skill"');
    expect(markup).not.toContain("group-hover:translate-x-1");
    expect(markup).toContain("text-muted-foreground/65");
    expect(markup).toContain(
      "h-8 gap-0.5 rounded-md bg-surface-recessed p-0.5",
    );
    expect(markup.indexOf("Installed skills")).toBeLessThan(
      markup.indexOf('placeholder="Search skills"'),
    );
    expect(markup.indexOf("bb-skill")).toBeLessThan(
      markup.indexOf("claude-skill"),
    );
    expect(markup).not.toContain('aria-expanded="true"');
  });

  it("keeps installed registry skills in a clickable Browse card", () => {
    const registrySkill = makeRegistrySkill({ installs: 123_456, stars: 654 });
    const markup = renderToStaticMarkup(
      <SkillsOverview
        skills={[]}
        isLoading={false}
        hasError={false}
        registrySkills={[
          registrySkill,
          makeRegistrySkill({
            id: "owner/repo/second-skill",
            skillId: "second-skill",
            name: "Second skill",
          }),
          makeRegistrySkill({
            id: "owner/repo/third-skill",
            skillId: "third-skill",
            name: "Third skill",
          }),
          makeRegistrySkill({
            id: "owner/repo/fourth-skill",
            skillId: "fourth-skill",
            name: "Fourth skill",
          }),
        ]}
        onCreateSkill={() => {}}
        onSelectSkill={() => {}}
        onSelectRegistrySkill={() => {}}
        onInstallRegistrySkill={() => {}}
        onUninstallRegistrySkill={() => {}}
        isRegistrySkillInstalled={(skill) => skill.id === registrySkill.id}
      />,
    );

    expect(markup).toContain("Useful skill");
    expect(markup).toContain('href="https://www.skills.sh/"');
    expect(markup).toContain("powered by");
    expect(markup).toContain("text-success");
    expect(markup).toContain("fill-attention/20 text-attention");
    expect(markup).toContain('aria-label="123.5K installs"');
    expect(markup).toContain('aria-label="654 stars"');
    expect(markup).toContain(
      "items-center justify-end gap-[var(--resource-source-shelf-card-action-gap)]",
    );
    expect(markup).toContain("items-center justify-end pt-2");
    expect(markup).toContain("min-h-14 line-clamp-2");
    expect(markup).toContain(
      "rounded-lg bg-surface-recessed/70 p-[var(--resource-source-shelf-inset)]",
    );
    expect(markup).toContain(
      "-ml-[var(--resource-source-shelf-shadow-left-bleed)] -my-[var(--resource-source-shelf-shadow-bleed)] overflow-x-auto pl-[var(--resource-source-shelf-shadow-left-bleed)] py-[var(--resource-source-shelf-shadow-bleed)]",
    );
    expect(markup).toContain(
      "snap-x snap-mandatory gap-[var(--resource-source-shelf-item-gap)]",
    );
    expect(markup).toContain("right-0");
    expect(markup).toContain("w-[var(--resource-source-shelf-fade-ramp)]");
    expect(markup).toContain("Uninstall Useful skill from bb");
    expect(markup).toContain('aria-label="View details for Useful skill"');
    expect(markup).toContain('class="absolute inset-0 cursor-pointer');
    expect(markup).toContain(
      "hover:border-[color:var(--resource-source-shelf-card-hover-border)] hover:shadow-[var(--resource-source-shelf-card-hover-shadow)]",
    );
    expect(markup).not.toContain(
      "hover:bg-[var(--resource-source-shelf-card-hover)]",
    );
    expect(
      markup.match(/text-sm font-medium leading-5 text-muted-foreground/g),
    ).toHaveLength(2);
  });

  it("confirms before uninstalling an installed skill from a Browse card", () => {
    const registrySkill = makeRegistrySkill();
    const onUninstall = vi.fn();
    renderDom(
      <SkillsOverview
        skills={[]}
        isLoading={false}
        hasError={false}
        registrySkills={[registrySkill]}
        onCreateSkill={() => {}}
        onSelectSkill={() => {}}
        onUninstallRegistrySkill={onUninstall}
        isRegistrySkillInstalled={() => true}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", {
        name: "Uninstall Useful skill from bb",
      }),
    );
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(
      screen.getByText('Remove "Useful skill" from your bb skills?'),
    ).toBeTruthy();
    expect(onUninstall).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Uninstall skill" }));
    expect(onUninstall).toHaveBeenCalledOnce();
    expect(onUninstall).toHaveBeenCalledWith(registrySkill);
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

  it("allows full lifecycle management for local provider skills", () => {
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
    expect(markup).toContain('aria-label="Edit provider-skill"');
    expect(markup).toContain('aria-label="Delete provider-skill"');
    expect(markup).not.toMatch(
      /aria-label="Edit provider-skill"[^>]*aria-disabled="true"/,
    );
    expect(markup).not.toMatch(
      /aria-label="Delete provider-skill"[^>]*aria-disabled="true"/,
    );
  });

  it("shows disabled manage actions for built-in bb skills", () => {
    const onSelectSkill = vi.fn();
    renderDom(
      <SkillsOverview
        skills={[
          makeSkill({
            name: "bb-cli",
            provider: null,
            scope: "bb-builtin",
            manageable: false,
          }),
        ]}
        isLoading={false}
        hasError={false}
        onCreateSkill={() => {}}
        onSelectSkill={onSelectSkill}
      />,
    );

    const editButton = screen.getByRole("button", { name: "Edit bb-cli" });
    expect(editButton.getAttribute("aria-disabled")).toBe("true");
    expect(
      screen
        .getByRole("button", { name: "Delete bb-cli" })
        .getAttribute("aria-disabled"),
    ).toBe("true");
    expect(screen.queryByRole("button", { name: "Open bb-cli" })).toBeNull();
    expect(editButton.closest("[data-row-action]")?.className).toContain(
      "group-hover:opacity-100",
    );

    fireEvent.click(editButton);
    expect(onSelectSkill).not.toHaveBeenCalled();

    const row = screen.getByText("bb-cli").closest(".group");
    expect(row?.className).toContain("cursor-pointer");
    const caret = row?.querySelector('[data-icon="ChevronRight"]');
    expect(caret?.classList.contains("text-muted-foreground/65")).toBe(true);
    expect(caret?.classList.contains("group-hover:translate-x-1")).toBe(false);
    expect(caret?.classList.contains("transition-colors")).toBe(true);
    expect(caret?.closest("button")).toBeNull();
    const caretTarget = caret?.parentElement;
    expect(caretTarget?.classList.contains("hover:bg-state-hover")).toBe(true);
    fireEvent.click(caretTarget!);
    expect(onSelectSkill).toHaveBeenCalledOnce();
    fireEvent.click(row!);
    expect(onSelectSkill).toHaveBeenCalledTimes(2);
  });

  it("explains bundled provider restrictions without claiming a bb-only delete policy", async () => {
    renderDom(
      <SkillsOverview
        skills={[
          makeSkill({
            name: "imagegen",
            provider: "codex",
            scope: "codex",
            filePath: "/home/u/.codex/skills/.system/imagegen/SKILL.md",
            manageable: false,
          }),
        ]}
        isLoading={false}
        hasError={false}
        onCreateSkill={() => {}}
        onSelectSkill={() => {}}
        onEditSkill={() => {}}
        onDeleteSkill={() => {}}
      />,
    );
    fireEvent.pointerMove(
      screen.getByRole("button", { name: "Edit imagegen" }),
    );
    expect((await screen.findByRole("tooltip")).textContent).toBe(
      "Bundled with Codex",
    );
    expect(
      screen.queryByText("Only bb skills can be deleted in bb"),
    ).toBeNull();
    expect(screen.queryByText("This skill is read-only in bb")).toBeNull();
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

describe("RegistrySkillsBrowsePage", () => {
  it("renders rows, sorts Skill name A-Z, exposes Stars, and pages forward", async () => {
    const onPageChange = vi.fn();
    const alpha = makeRegistrySkill({
      id: "owner/repo/alpha",
      skillId: "alpha",
      name: "Alpha",
      installs: 10,
      stars: 100,
    });
    const zulu = makeRegistrySkill({
      id: "owner/repo/zulu",
      skillId: "zulu",
      name: "Zulu",
      installs: 20,
      stars: 10,
    });
    const onSelect = vi.fn();
    const onBack = vi.fn();
    renderDom(
      <RegistrySkillsBrowsePage
        skills={[alpha, zulu]}
        pagination={{ page: 0, perPage: 24, total: 48, hasMore: true }}
        isLoading={false}
        hasError={false}
        query=""
        pendingSkillId={null}
        onBack={onBack}
        onQueryChange={() => {}}
        onPageChange={onPageChange}
        onInstall={() => {}}
        onSelect={onSelect}
        isInstalled={(skill) => skill.id === alpha.id}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Back to skills" }));
    expect(onBack).toHaveBeenCalledOnce();
    const alphaRowButton = screen.getByText("Alpha").closest("button");
    expect(alphaRowButton).toBeTruthy();
    fireEvent.click(alphaRowButton!);
    expect(onSelect).toHaveBeenCalledWith(alpha);
    expect(screen.getByText("1–2 of 48")).toBeTruthy();
    expect(screen.getByRole("textbox", { name: "Search skills" })).toBeTruthy();
    expect(screen.queryByRole("link", { name: /skills\.sh/ })).toBeNull();
    expect(screen.queryByText("powered by")).toBeNull();
    expect(screen.getByLabelText("10 installs")).toBeTruthy();
    expect(screen.getByLabelText("100 stars")).toBeTruthy();
    expect(screen.getByLabelText("Installed Alpha as a bb skill")).toBeTruthy();

    fireEvent.pointerDown(screen.getByRole("button", { name: "Sort" }));
    expect(await screen.findByRole("menuitem", { name: "Stars" })).toBeTruthy();
    fireEvent.click(screen.getByRole("menuitem", { name: "Skill name" }));

    await waitFor(() => {
      const alphaTitle = screen.getByText("Alpha");
      const zuluTitle = screen.getByText("Zulu");
      expect(
        alphaTitle.compareDocumentPosition(zuluTitle) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    });

    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => {
      expect(screen.queryByRole("menuitem", { name: "Stars" })).toBeNull();
    });
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(onPageChange).toHaveBeenCalledWith(1);
  });
});

describe("SkillDetailDialogView", () => {
  it("keeps disabled menu labels clean and explains restrictions in tooltips", async () => {
    const skill = makeSkill({
      name: "bb-cli",
      provider: null,
      scope: "bb-builtin",
      manageable: false,
    });
    renderDom(
      <SkillDetailDialogView
        skill={skill}
        files={["SKILL.md"]}
        selectedPath="SKILL.md"
        onSelectPath={() => {}}
        content="# bb CLI"
        isLoadingContent={false}
        isRefreshingContent={false}
        isContentError={false}
        canEdit={false}
        canDelete={false}
        canOpenInEditor={false}
        isSaving={false}
        isDeleting={false}
        onSave={async () => true}
        onRetry={() => {}}
        onDelete={() => {}}
        onOpenInEditor={() => {}}
      />,
    );

    expect(screen.queryByText("Built-in", { exact: true })).toBeNull();
    fireEvent.pointerDown(
      screen.getByRole("button", { name: "bb-cli actions" }),
    );
    expect(
      screen
        .getByRole("menuitem", { name: /Edit SKILL\.md/ })
        .getAttribute("aria-disabled"),
    ).toBe("true");
    expect(
      screen
        .getByRole("menuitem", { name: /Delete/ })
        .getAttribute("aria-disabled"),
    ).toBe("true");
    expect(screen.queryByText("Built-in skill")).toBeNull();
    fireEvent.pointerMove(
      screen.getByRole("menuitem", { name: "Edit SKILL.md" }),
    );
    expect((await screen.findByRole("tooltip")).textContent).toBe(
      "Built-in skill",
    );
  });

  it("shows bundled plugin provenance as passive identity metadata", async () => {
    const skill = makeSkill({
      name: "documents",
      provider: "codex",
      scope: "plugin",
      manageable: false,
    });
    renderDom(
      <SkillDetailDialogView
        skill={skill}
        files={["SKILL.md"]}
        selectedPath="SKILL.md"
        onSelectPath={() => {}}
        content="# Documents"
        isLoadingContent={false}
        isRefreshingContent={false}
        isContentError={false}
        canEdit={false}
        canDelete={false}
        canOpenInEditor={false}
        isSaving={false}
        isDeleting={false}
        onSave={async () => true}
        onRetry={() => {}}
        onDelete={() => {}}
        onOpenInEditor={() => {}}
      />,
    );

    expect(
      screen.getByText("Bundled with Documents (Codex plugin)").textContent,
    ).toBe("Bundled with Documents (Codex plugin)");
    expect(
      screen.queryByRole("button", { name: /documents plugin/i }),
    ).toBeNull();
    expect(screen.queryByTestId("plugin-logo-documents")).toBeNull();
    expect(screen.queryByText("Editable", { exact: true })).toBeNull();

    fireEvent.pointerDown(
      screen.getByRole("button", { name: "documents actions" }),
    );
    expect(screen.queryByText("Bundled with documents")).toBeNull();
    fireEvent.pointerMove(
      screen.getByRole("menuitem", { name: "Edit SKILL.md" }),
    );
    expect((await screen.findByRole("tooltip")).textContent).toBe(
      "Bundled with documents",
    );
  });

  it("labels externally discovered provider skills as imported", async () => {
    const skill = makeSkill({
      name: "code-review",
      provider: "claude-code",
      scope: "claude-user",
      manageable: true,
    });
    renderDom(
      <SkillDetailDialogView
        skill={skill}
        files={["SKILL.md"]}
        selectedPath="SKILL.md"
        onSelectPath={() => {}}
        content="# Code review"
        isLoadingContent={false}
        isRefreshingContent={false}
        isContentError={false}
        canEdit
        canDelete
        canOpenInEditor={false}
        isSaving={false}
        isDeleting={false}
        onSave={async () => true}
        onRetry={() => {}}
        onDelete={() => {}}
        onOpenInEditor={() => {}}
      />,
    );

    const imported = screen.getByLabelText(
      "code-review is imported from Claude Code",
    );
    expect(imported.textContent).toBe("Imported");
    expect(imported.className).not.toContain("border");
    fireEvent.pointerMove(imported);
    expect((await screen.findByRole("tooltip")).textContent).toBe(
      "Discovered from Claude Code",
    );
  });

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
        files={["SKILL.md"]}
        selectedPath="SKILL.md"
        onSelectPath={() => {}}
        content="# bb skill"
        isLoadingContent={false}
        isRefreshingContent={false}
        isContentError={false}
        canEdit
        canDelete
        canOpenInEditor={false}
        initiallyEditing
        isSaving={false}
        isDeleting={false}
        onInitialEditStarted={onInitialEditStarted}
        onSave={async () => true}
        onRetry={() => {}}
        onDelete={() => {}}
        onOpenInEditor={() => {}}
      />,
    );

    const pathButton = screen.getByRole("button", {
      name: `Copy skill path: ${skill.filePath}`,
    });
    expect(screen.queryByText("Editable", { exact: true })).toBeNull();
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
      files: ["SKILL.md"],
      selectedPath: "SKILL.md",
      onSelectPath: () => {},
      isLoadingContent: false,
      isContentError: false,
      canEdit: true,
      canDelete: true,
      canOpenInEditor: false,
      initiallyEditing: true,
      isSaving: false,
      isDeleting: false,
      onInitialEditStarted,
      onSave: async () => true,
      onRetry: () => {},
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

describe("SkillDetailView registry states", () => {
  it("omits social proof, links before install, and confirms uninstall", () => {
    const onInstall = vi.fn();
    const onUninstall = vi.fn();
    const view = renderDom(
      <SkillDetailView
        leading={<span>Skill</span>}
        title="find-skills"
        path="skills.sh/vercel-labs/skills/find-skills"
        pathHref="https://www.skills.sh/vercel-labs/skills/find-skills"
        headerControl={{
          kind: "install",
          skillName: "find-skills",
          installed: false,
          pending: false,
          onInstall,
          onUninstall,
        }}
        files={["SKILL.md"]}
        selectedPath="SKILL.md"
        onSelectFile={() => {}}
        contentState={{ kind: "ready", content: "# Find skills" }}
      />,
    );

    const sourceLink = screen.getByRole("link", {
      name: "Open skills.sh/vercel-labs/skills/find-skills in a new tab",
    });
    expect(sourceLink.getAttribute("href")).toBe(
      "https://www.skills.sh/vercel-labs/skills/find-skills",
    );
    expect(sourceLink.getAttribute("target")).toBe("_blank");
    expect(sourceLink.textContent).not.toContain("/SKILL.md");
    expect(screen.queryByText("Registry social proof")).toBeNull();
    const installButton = screen.getByRole("button", {
      name: /Install find-skills/,
    });
    expect(installButton.className).toContain("border-input");
    fireEvent.click(installButton);
    expect(onInstall).toHaveBeenCalledOnce();

    view.rerender(
      <SkillDetailView
        leading={<span>Skill</span>}
        title="find-skills"
        path="~/.bb/skills/find-skills/SKILL.md"
        headerControl={{
          kind: "install",
          skillName: "find-skills",
          installed: true,
          pending: false,
          onInstall,
          onUninstall,
        }}
        files={["SKILL.md"]}
        selectedPath="SKILL.md"
        onSelectFile={() => {}}
        contentState={{ kind: "ready", content: "# Find skills" }}
      />,
    );

    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.queryByText("Registry social proof")).toBeNull();
    const uninstallButton = screen.getByRole("button", {
      name: "Uninstall find-skills from bb",
    });
    expect(uninstallButton.className).toContain("border-input");
    fireEvent.click(uninstallButton);
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(onUninstall).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Uninstall skill" }));
    expect(onUninstall).toHaveBeenCalledOnce();
  });
});

describe("installRegistrySkill", () => {
  it("imports one bb-owned user skill", async () => {
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) => ({
        ok: true,
        json: async () => ({
          ok: true,
          filePath: "/home/u/.bb/skills/skill/SKILL.md",
        }),
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const skill = makeRegistrySkill({
      id: "owner/repo/skill",
      skillId: "skill",
      name: "Skill",
      url: "https://skills.sh/owner/repo/skill",
    });

    await expect(installRegistrySkill({ skill })).resolves.toEqual({
      ok: true,
      filePath: "/home/u/.bb/skills/skill/SKILL.md",
    });

    expect(fetchMock).toHaveBeenCalledOnce();
    const request = fetchMock.mock.calls[0];
    expect(request?.[0]).toBe("/api/v1/skills-registry/install");
    expect(JSON.parse(String(request?.[1]?.body))).toMatchObject({
      source: "owner/repo",
      skillId: "skill",
      projectId: PERSONAL_PROJECT_ID,
    });
    expect(JSON.parse(String(request?.[1]?.body))).not.toHaveProperty(
      "providers",
    );
    expect(JSON.parse(String(request?.[1]?.body))).not.toHaveProperty("scope");
  });
});

describe("fetchRegistrySkills", () => {
  it("requests and validates a registry page", async () => {
    const skill = makeRegistrySkill();
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        skills: [skill],
        pagination: { page: 2, perPage: 24, total: 73, hasMore: true },
      }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchRegistrySkills({ query: "useful", page: 2 });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/skills-registry?q=useful&page=2&perPage=24",
    );
    expect(result.skills).toEqual([skill]);
    expect(result.pagination).toEqual({
      page: 2,
      perPage: 24,
      total: 73,
      hasMore: true,
    });
  });
});

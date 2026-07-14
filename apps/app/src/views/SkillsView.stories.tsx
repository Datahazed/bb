import { useState } from "react";
import type { SkillSummary } from "@bb/server-contract";
import {
  SkillDetailDialogView,
  SkillsOverview,
  type SkillsOverviewProps,
} from "./SkillsView";

export default {
  title: "Skills",
};

function makeSkill(overrides: Partial<SkillSummary> = {}): SkillSummary {
  return {
    name: "code-review",
    description: "Review the current diff against our conventions.",
    provider: "claude-code",
    scope: "claude-user",
    filePath: "/home/u/.claude/skills/code-review/SKILL.md",
    manageable: true,
    ...overrides,
  };
}

// Every bb install ships these two built-in bb skills, so they're always present
// (read-only — built-ins aren't user-managed).
const defaultBbSkills: SkillSummary[] = [
  makeSkill({
    name: "bb-cli",
    provider: null,
    scope: "bb-builtin",
    manageable: false,
    description: "Inspect and orchestrate bb from the CLI.",
  }),
  makeSkill({
    name: "skill-creator",
    provider: null,
    scope: "bb-builtin",
    manageable: false,
    description: "Author new bb skills.",
  }),
];

// Local provider skills a developer might also have installed. User-authored
// files are editable and deletable; bundled/system skills remain protected.
const providerSkills: SkillSummary[] = [
  makeSkill({
    name: "branch",
    description: "Create a branch, commit, and open a PR.",
  }),
  makeSkill({ name: "moss-notes", description: "Author and edit Moss notes." }),
  makeSkill({
    name: "deep-research",
    provider: "codex",
    scope: "codex",
    description: "Fan-out web research with citations.",
    filePath: "/home/u/.codex/skills/deep-research/SKILL.md",
  }),
  makeSkill({
    name: "imagegen",
    provider: "codex",
    scope: "codex",
    manageable: false,
    description: "Generate or edit raster images.",
    filePath: "/home/u/.codex/skills/.system/imagegen/SKILL.md",
  }),
];

// User-created bb skills, which are both editable and deletable.
const bbSkills: SkillSummary[] = [
  makeSkill({
    name: "repro-and-fix",
    provider: null,
    scope: "bb-user",
    manageable: true,
    description: "Turn a bug report into a failing test, then a fix.",
  }),
  makeSkill({
    name: "scaffold-component",
    provider: null,
    scope: "bb-user",
    manageable: true,
    description: "Scaffold a component, test, and story to our patterns.",
  }),
];

const NOOP = () => {};

// Sample SKILL.md shown in the detail view when a row is clicked. Exercises the shared
// markdown viewer (heading, list, code, table, blockquote) and the frontmatter
// strip — the body should start at "Code review", not the YAML.
const SAMPLE_SKILL_MD = `---
name: code-review
description: Review the current diff against our conventions.
---

# Code review

Review the **current working diff** for correctness and clarity. Lead with the
highest-severity findings; skip nits unless asked.

## When to use

- Before opening a PR, or when the user asks to "review my changes".
- Not for whole-repo audits — scope to the diff.

## Steps

1. Run \`git diff\` and read every hunk.
2. Group findings by severity, and cite each as \`file:line\`.

\`\`\`ts
// Flag anything that mutates shared state without a lock.
if (!resolution.additionalSkillsRootPaths) throw new Error("unresolved");
\`\`\`

| Severity | Meaning        | Action          |
| -------- | -------------- | --------------- |
| P0       | Correctness    | Block the merge |
| P1       | Latent risk    | Flag, recommend |
| P2       | Style / polish | Optional        |

> Summary first — what's wrong and where — then the detail.
`;

function storyCanEdit(skill: SkillSummary | null): boolean {
  return (
    skill !== null &&
    (skill.scope === "bb-user" ||
      skill.scope === "bb-project" ||
      skill.scope === "claude-user" ||
      skill.scope === "claude-project" ||
      (skill.scope === "codex" &&
        !/(^|[\\/])\.system([\\/]|$)/u.test(skill.filePath)))
  );
}

function storyCanDelete(skill: SkillSummary | null): boolean {
  return skill?.manageable ?? false;
}

// Clicking a row opens the actual detail view (SkillDetailDialogView) seeded
// with a sample SKILL.md -- the production interaction, minus the live
// content/save/delete queries. Shared across stories so every state can open it.
function Story(props: Partial<SkillsOverviewProps>) {
  const [selected, setSelected] = useState<SkillSummary | null>(null);
  return (
    <main className="flex h-screen min-w-0 flex-col p-4 md:p-5">
      <SkillsOverview
        skills={
          props.skills ?? [...bbSkills, ...defaultBbSkills, ...providerSkills]
        }
        isLoading={props.isLoading ?? false}
        hasError={props.hasError ?? false}
        onCreateSkill={NOOP}
        onSelectSkill={setSelected}
        onEditSkill={setSelected}
        onDeleteSkill={setSelected}
        onRetry={NOOP}
      />
      <SkillDetailDialogView
        skill={selected}
        files={["SKILL.md"]}
        selectedPath="SKILL.md"
        onSelectPath={NOOP}
        content={SAMPLE_SKILL_MD}
        isLoadingContent={false}
        isRefreshingContent={false}
        isContentError={false}
        canEdit={storyCanEdit(selected)}
        canDelete={storyCanDelete(selected)}
        canOpenInEditor={false}
        isSaving={false}
        isDeleting={false}
        onSave={() => Promise.resolve(true)}
        onRetry={NOOP}
        onDelete={() => setSelected(null)}
        onOpenInEditor={NOOP}
      />
    </main>
  );
}

// Has user-created bb skills — no teaching, full provider-grouped list. Type in
// the search to exercise filtering and the no-match state; click any row to open
// the detail view. User-owned local skills enable both Edit and Delete.
export function Overview() {
  return <Story />;
}

// The true minimum every install starts at: just the two default bb skills, plus
// the teaching (no user-created skills yet).
export function Empty() {
  return <Story skills={defaultBbSkills} />;
}

export function Loading() {
  return <Story skills={[]} isLoading />;
}

export function Error() {
  return <Story skills={[]} hasError />;
}

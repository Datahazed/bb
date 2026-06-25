import type { SkillSummary } from "@bb/server-contract";
import {
  SkillContentPreview,
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
    manageable: false,
    ...overrides,
  };
}

// Every bb install ships these two built-in bb skills, so they're always present
// (read-only — built-ins aren't user-managed).
const defaultBbSkills: SkillSummary[] = [
  makeSkill({ name: "bb-cli", provider: null, scope: "bb-builtin", description: "Inspect and orchestrate bb from the CLI." }),
  makeSkill({ name: "skill-creator", provider: null, scope: "bb-builtin", description: "Author new bb skills." }),
];

// Provider skills a developer might also have installed (read-only, per provider).
const providerSkills: SkillSummary[] = [
  makeSkill({ name: "branch", description: "Create a branch, commit, and open a PR." }),
  makeSkill({ name: "moss-notes", description: "Author and edit Moss notes." }),
  makeSkill({ name: "deep-research", provider: "codex", scope: "codex", description: "Fan-out web research with citations." }),
];

// User-created (manageable) bb skills.
const bbSkills: SkillSummary[] = [
  makeSkill({ name: "repro-and-fix", provider: null, scope: "bb-user", manageable: true, description: "Turn a bug report into a failing test, then a fix." }),
  makeSkill({ name: "scaffold-component", provider: null, scope: "bb-user", manageable: true, description: "Scaffold a component, test, and story to our patterns." }),
];

const NOOP = () => {};

function Story(props: Partial<SkillsOverviewProps>) {
  return (
    <main className="flex h-screen min-w-0 flex-col p-4 md:p-5">
      <SkillsOverview
        skills={props.skills ?? [...bbSkills, ...defaultBbSkills, ...providerSkills]}
        isLoading={props.isLoading ?? false}
        hasError={props.hasError ?? false}
        onCreateSkill={NOOP}
        onSelectSkill={NOOP}
      />
    </main>
  );
}

// Has user-created bb skills — no teaching, full provider-grouped list. Type in
// the search to exercise filtering and the no-match state.
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

// The skill detail body now reuses the thread file viewer's markdown rendering
// (MarkdownPreview) instead of raw monospace `<pre>`. Rendered at the detail
// dialog's width with a representative SKILL.md so the rendering is iterable on
// its own.
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

export function Detail() {
  return (
    <main className="flex h-screen min-w-0 flex-col p-4 md:p-5">
      <div className="max-w-2xl">
        <SkillContentPreview content={SAMPLE_SKILL_MD} />
      </div>
    </main>
  );
}

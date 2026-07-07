import type {
  AutomationDetail,
  PluginDetail,
  SkillDetail,
  ToolAutomation,
  ToolPlugin,
  ToolSkill,
} from "./types";

/**
 * Seed data transcribed from the finalized static mock
 * (plans/tools-hub-redesign/direction-a-gallery.html). Names, copy, versions,
 * statuses, and schedules match the mock so the stories render the same content
 * a reviewer approved.
 */

// ---------------------------------------------------------------------------
// Skills — grouped by provider in the Skills filter (bb, then Claude Code).
// ---------------------------------------------------------------------------

export const SKILLS: readonly ToolSkill[] = [
  {
    id: "architect",
    name: "architect",
    description:
      "Architect product capabilities as cohesive systems instead of isolated features.",
    provider: "bb",
    scope: "built-in",
    manageable: false,
  },
  {
    id: "design",
    name: "design",
    description:
      "Design product features and workflows that are simple, powerful, and intuitive.",
    provider: "bb",
    scope: "built-in",
    manageable: false,
  },
  {
    id: "crit",
    name: "crit",
    description:
      "Review proposed product, UX, and UI designs like a senior product designer.",
    provider: "bb",
    scope: "built-in",
    manageable: false,
  },
  {
    id: "deep-research",
    name: "deep-research",
    description:
      "Fan-out web searches, verify claims, and synthesize a cited research report.",
    provider: "bb",
    scope: "user",
    manageable: true,
  },
  {
    id: "prototype",
    name: "prototype",
    description:
      "Run a UI prototyping session in Ladle, iterating on a design before build.",
    provider: "bb",
    scope: "user",
    manageable: true,
  },
  {
    id: "merge-ready",
    name: "merge-ready",
    description:
      "Get the current branch's PR green and mergeable — commit, push, drive CI.",
    provider: "bb",
    scope: "built-in",
    manageable: false,
  },
  {
    id: "frontend-design",
    name: "frontend-design",
    description:
      "Guidance for distinctive, intentional visual design when building new UI.",
    provider: "Claude",
    scope: "user",
    manageable: false,
  },
  {
    id: "security-review",
    name: "security-review",
    description:
      "Complete a security review of the pending changes on the current branch.",
    provider: "Claude",
    scope: "user",
    manageable: false,
  },
];

// ---------------------------------------------------------------------------
// Automations — three active, two paused.
// ---------------------------------------------------------------------------

export const AUTOMATIONS: readonly ToolAutomation[] = [
  {
    id: "nightly-pr-babysit",
    name: "Nightly PR babysit",
    description:
      "Agent · reviews open PRs, nudges CI, and reports back each night.",
    enabled: true,
    kind: "agent",
    schedule: "9PM daily · America/New_York",
    lastRunStatus: "running",
    nextRunAt: "Jul 8, 9:00 PM",
  },
  {
    id: "weekly-usage-report",
    name: "Weekly usage report",
    description: "Script · bash · rolls up thread + token usage into a Moss note.",
    enabled: true,
    kind: "script",
    schedule: "8AM Mon · America/New_York",
    lastRunStatus: "failed",
    nextRunAt: "Jul 13, 8:00 AM",
  },
  {
    id: "dependency-update-check",
    name: "Dependency update check",
    description: "Agent · scans for outdated deps and opens a PR when safe.",
    enabled: true,
    kind: "agent",
    schedule: "6AM daily · America/New_York",
    lastRunStatus: "succeeded",
    nextRunAt: "Jul 8, 6:00 AM",
  },
  {
    id: "inbox-triage",
    name: "Inbox triage",
    description: "Agent · summarizes new mentions and drafts replies for review.",
    enabled: false,
    kind: "agent",
    schedule: "Every 30m",
    lastRunStatus: null,
    nextRunAt: null,
  },
  {
    id: "backup-snapshots",
    name: "Backup snapshots",
    description: "Script · node · snapshots the workspace db nightly to cold storage.",
    enabled: false,
    kind: "script",
    schedule: "Nightly · 2AM",
    lastRunStatus: null,
    nextRunAt: null,
  },
];

// ---------------------------------------------------------------------------
// Plugins — the builtin + example plugin catalog, one card per status.
// ---------------------------------------------------------------------------

export const PLUGINS: readonly ToolPlugin[] = [
  {
    id: "automations",
    version: "1.2.0",
    enabled: true,
    status: "running",
    statusDetail: null,
    description:
      "Schedule agent and script runs; the engine behind the Automations tab.",
  },
  {
    id: "connect",
    version: "0.9.0",
    enabled: true,
    status: "running",
    statusDetail: null,
    description: "Link external accounts and expose them to threads as tools.",
  },
  {
    id: "simple-notes",
    version: "0.1.0",
    enabled: true,
    status: "needs-configuration",
    statusDetail: "Add a notes folder to finish setup.",
    description:
      "A minimal notes panel — needs a storage folder before it can run.",
  },
  {
    id: "posthog-dashboard",
    version: "2.0.1",
    enabled: true,
    status: "error",
    statusDetail: "Failed to start: missing API key.",
    description: "Error-dashboard review. Failed to start: missing API key.",
  },
  {
    id: "markdown-editor",
    version: "0.3.0",
    enabled: false,
    status: "disabled",
    statusDetail: null,
    description: "Rich markdown editing surface for notes and specs.",
  },
  {
    id: "dataviz",
    version: "1.0.4",
    enabled: true,
    status: "running",
    statusDetail: null,
    description: "Chart and dashboard rendering for thread artifacts.",
  },
];

// ---------------------------------------------------------------------------
// Detail-page content for the three detail stories.
// ---------------------------------------------------------------------------

export const DEEP_RESEARCH_DETAIL: SkillDetail = {
  filePath: "~/.bb/skills/deep-research/SKILL.md",
  invocation: "/deep-research",
  availableTo: "Claude · Codex",
  readme: [
    { type: "heading", text: "# Deep Research" },
    {
      type: "paragraph",
      text: "A harness for multi-source, fact-checked research. Fan out web searches, fetch sources, adversarially verify claims, then synthesize a cited report.",
    },
    { type: "heading", text: "## When to use" },
    {
      type: "paragraph",
      text: "When the user wants a deep, multi-source report. If the question is underspecified, ask 2–3 clarifying questions first, then weave the answers into the query.",
    },
    { type: "code", text: 'args: "<refined research question>"' },
  ],
  rail: [
    { label: "Invocation", value: "/deep-research" },
    { label: "Scope", value: "bb · user (editable)" },
    { label: "Available to", value: "Claude · Codex" },
    { label: "Last edited", value: "3 days ago" },
  ],
  railAction: { icon: "ExternalLink", label: "Open in editor" },
};

export const NIGHTLY_PR_DETAIL: AutomationDetail = {
  prompt:
    'Review every open PR on the bb repo. For each: check CI, summarize failures, and post a one-line status. If a PR is green and approved, comment "ready to merge". Report a digest to this thread.',
  execution: "Agent · codex / gpt-5.4 · workspace-write",
  nextRunLabel: "Next Jul 8, 9:00 PM",
  runs: [
    { status: "running", label: "Running · started 0:42 ago", timestamp: "manual" },
    {
      status: "succeeded",
      label: "Succeeded · 6 PRs reviewed",
      timestamp: "Jul 6, 9:00 PM",
    },
    {
      status: "succeeded",
      label: "Succeeded · 5 PRs reviewed",
      timestamp: "Jul 5, 9:00 PM",
    },
    {
      status: "failed",
      label: "Failed · provider timeout",
      timestamp: "Jul 4, 9:00 PM",
    },
  ],
  rail: [
    { label: "Trigger", value: "Schedule · cron" },
    { label: "Execution", value: "Agent · codex / gpt-5.4" },
    { label: "Runs", value: "142 total · 3 failed" },
    { label: "Created by", value: "human · from thread" },
  ],
};

export const SIMPLE_NOTES_DETAIL: PluginDetail = {
  source: "builtin",
  settings: [
    {
      label: "Notes folder",
      help: "Where notes are written. Required before the panel can render.",
      control: { type: "text", placeholder: "~/Notes", icon: "Folder" },
    },
    {
      label: "Open on new thread",
      help: "Show the notes panel automatically when a thread starts.",
      control: { type: "boolean", value: false },
    },
  ],
  permissions: [
    {
      icon: "Lock",
      text: "Read & write files in the notes folder",
      scopeLabel: "read / write",
    },
    {
      icon: "Terminal",
      text: "Contribute a panel to the thread view",
      scopeLabel: "ui",
    },
  ],
  rail: [
    { label: "Version", value: "v0.1.0" },
    { label: "Source", value: "builtin" },
    { label: "Status", value: "needs configuration" },
  ],
  railAction: { icon: "ExternalLink", label: "Plugin docs" },
};

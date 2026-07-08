import { ResourceCreateButton } from "@bb/shared-ui/resource-list";
import {
  CREATE_AUTOMATION_PROMPT,
  CREATE_SKILL_PROMPT,
} from "@/lib/automation-prompt";

export type CreateViaPromptKind = "skill" | "plugin" | "automation";

export const CREATE_PLUGIN_PROMPT = "Create a new bb plugin that ";

interface Example {
  label: string;
  /** Completes the "Create a new bb {kind} …" prompt; also shown on the card. */
  description: string;
}

interface KindConfig {
  prefix: string;
  explainer: string;
  examples: readonly Example[];
}

// The description completes the prompt prefix, so each card both teaches and
// seeds the composer. Skills are standard Agent Skills whose bb edge is being
// cross-provider; automations run scripts and can escalate to threads.
const CONFIG: Record<CreateViaPromptKind, KindConfig> = {
  skill: {
    prefix: CREATE_SKILL_PROMPT,
    explainer:
      "Write a skill once, and every agent in bb can run it, whatever the provider.",
    examples: [
      {
        label: "PR review",
        description:
          "reviews a GitHub PR, checks changed files, runs focused tests, and returns blocking findings first",
      },
      {
        label: "Release notes",
        description:
          "turns merged PRs into concise customer-facing release notes with links and risk notes",
      },
      {
        label: "Incident debug",
        description:
          "collects logs, recent deploys, and failing checks before proposing the smallest fix",
      },
    ],
  },
  plugin: {
    prefix: CREATE_PLUGIN_PROMPT,
    explainer:
      "Add app surfaces, commands, background work, or agent tools through a plugin.",
    examples: [
      {
        label: "GitHub triage",
        description:
          "adds a GitHub panel that lists assigned PRs and lets agents open review threads",
      },
      {
        label: "Slack notifier",
        description:
          "adds a background service that posts thread failures to a configured Slack webhook",
      },
      {
        label: "Project commands",
        description:
          "adds bb CLI commands for the team's deploy and rollback workflow",
      },
    ],
  },
  automation: {
    prefix: CREATE_AUTOMATION_PROMPT,
    explainer:
      "Run scripts on a schedule and spawn agent threads only when there is real work.",
    examples: [
      {
        label: "CI failure triage",
        description:
          "runs every weekday morning, checks failed main-branch CI, and opens fixer threads only for new failures",
      },
      {
        label: "Dependency drift",
        description:
          "checks weekly for stale dependencies and opens an update thread when risk is low",
      },
      {
        label: "Release readiness",
        description:
          "checks the release branch hourly, summarizes blocking checks, and alerts only when the status changes",
      },
    ],
  },
};

export interface CreateExample {
  label: string;
  description: string;
  /** Full composer prompt seeded when this example is picked. */
  prompt: string;
}

/**
 * The shared create-via-prompt content for a kind: the marketing one-liner and
 * the examples with their full seeded prompts. Surfaces render it how they like
 * (cards, chips) without duplicating the copy.
 */
export function getCreateExamples(kind: CreateViaPromptKind): {
  explainer: string;
  examples: CreateExample[];
} {
  const config = CONFIG[kind];
  return {
    explainer: config.explainer,
    examples: config.examples.map((example) => ({
      label: example.label,
      description: example.description,
      prompt: `${config.prefix}${example.description}.`,
    })),
  };
}

export interface CreateViaPromptExamplesProps {
  kind: CreateViaPromptKind;
  /** Opens the composer seeded with the given full prompt. */
  onCreate: (prompt: string) => void;
}

/**
 * Empty-state examples that seed the create-via-prompt composer.
 */
export function CreateViaPromptExamples({
  kind,
  onCreate,
}: CreateViaPromptExamplesProps) {
  const { explainer, examples } = getCreateExamples(kind);
  return (
    <div>
      <p className="max-w-prose text-sm text-muted-foreground">{explainer}</p>
      <p className="mt-3 text-xs font-medium text-subtle-foreground">
        Start from an example
      </p>
      <div className="mt-1.5 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {examples.map((example) => (
          <button
            key={example.label}
            type="button"
            onClick={() => onCreate(example.prompt)}
            className="rounded-lg border border-border bg-background p-3 text-left transition-colors hover:border-file-accent/50 hover:bg-state-hover focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          >
            <span className="block text-sm font-medium text-foreground">
              {example.label}
            </span>
            <span className="mt-1 block text-xs leading-snug text-subtle-foreground">
              {example.description}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

export interface CreateWithTemplatesButtonProps {
  kind: CreateViaPromptKind;
  /** Main-button text, e.g. "New automation" or "New bb skill". */
  label: string;
  /** Blank when called with no argument; seeded when given an example prompt. */
  onCreate: (prompt?: string) => void;
}

/**
 * Split (combo) button: the left half creates a blank one immediately; the right
 * half opens a menu of example templates that seed the composer. Shared by the
 * Skills and Automations library toolbars.
 */
export function CreateWithTemplatesButton({
  kind,
  label,
  onCreate,
}: CreateWithTemplatesButtonProps) {
  const { examples } = getCreateExamples(kind);
  return (
    <ResourceCreateButton
      label={label}
      templates={examples}
      onCreate={onCreate}
    />
  );
}

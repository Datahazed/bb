import { Button } from "@/components/ui/button.js";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu.js";
import { Icon } from "@/components/ui/icon.js";
import {
  CREATE_LOOP_PROMPT,
  CREATE_SKILL_PROMPT,
} from "@/components/promptbox/PromptBoxActionsMenu";

export type CreateViaPromptKind = "skill" | "loop";

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
// cross-provider; loops are cheap scripts that escalate to threads.
const CONFIG: Record<CreateViaPromptKind, KindConfig> = {
  skill: {
    prefix: CREATE_SKILL_PROMPT,
    explainer:
      "Write a skill once, and every agent in bb can run it, whatever the provider.",
    examples: [
      {
        label: "Repro & fix",
        description:
          "turns a bug report into a failing test, then makes it pass",
      },
      {
        label: "Scaffold to our patterns",
        description:
          "scaffolds a new component with its test and story to match our conventions",
      },
      {
        label: "Onboard to a subsystem",
        description:
          "traces how a feature works across the codebase and writes an explainer",
      },
    ],
  },
  loop: {
    prefix: CREATE_LOOP_PROMPT,
    explainer:
      "Pay for agents only when there's real work, and fan a problem out across many threads in parallel.",
    examples: [
      {
        label: "Flaky-test sweep",
        description:
          "run nightly, find flaky tests with a script, and spawn a fixer thread for each one",
      },
      {
        label: "Silent health watch",
        description:
          "check the app every 15 minutes with a cheap script and spawn a thread only when something breaks",
      },
      {
        label: "Error sentinel",
        description:
          "poll the error dashboard hourly and spawn a triage thread only on a new spike",
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
 * Teaching panel for the Loops empty state: a one-line explainer plus clickable
 * example cards that seed the create-via-prompt composer.
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
  /** Main-button text, e.g. "New loop" or "New bb skill". */
  label: string;
  /** Blank when called with no argument; seeded when given an example prompt. */
  onCreate: (prompt?: string) => void;
}

/**
 * Split (combo) button: the left half creates a blank one immediately; the right
 * half opens a menu of example templates that seed the composer. Shared by the
 * Skills and Loops library toolbars.
 */
export function CreateWithTemplatesButton({
  kind,
  label,
  onCreate,
}: CreateWithTemplatesButtonProps) {
  const { examples } = getCreateExamples(kind);
  return (
    <div className="flex shrink-0 items-stretch">
      <Button
        type="button"
        size="sm"
        className="rounded-r-none"
        onClick={() => onCreate()}
      >
        <Icon name="Plus" className="size-4" />
        {label}
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            size="sm"
            aria-label={`${label} from a template`}
            className="rounded-l-none border-l border-background/25 px-1.5"
          >
            <Icon name="ChevronDown" className="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          className="w-72"
          mobileTitle="Start from an example"
        >
          <DropdownMenuLabel className="text-xs font-normal text-subtle-foreground">
            Start from an example
          </DropdownMenuLabel>
          {examples.map((example) => (
            <DropdownMenuItem
              key={example.label}
              onSelect={() => onCreate(example.prompt)}
            >
              <div className="flex min-w-0 flex-col">
                <span className="text-sm text-foreground">{example.label}</span>
                <span className="text-xs text-muted-foreground">
                  {example.description}
                </span>
              </div>
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

import type { IconName } from "@bb/shared-ui/icon";
import { CREATE_PLUGIN_PROMPT } from "@bb/client-core";
import type { ShowcaseArchetype } from "@bb/showcase-hero";

export { BROWSE_ARCHETYPES } from "@bb/showcase-hero";

type BrowseArchetype = ShowcaseArchetype;

export function archetypePrompt(archetype: BrowseArchetype): string {
  return `${CREATE_PLUGIN_PROMPT}${archetype.brief}.`;
}

interface UtilityExample {
  id: string;
  label: string;
  icon: IconName;
  brief: string;
}

export const UTILITY_EXAMPLES: readonly UtilityExample[] = [
  {
    id: "panel",
    label: "Panel",
    icon: "PanelLeft",
    brief:
      "adds a nav panel that lists my saved prompts and inserts one into the composer on click",
  },
  {
    id: "homepage-section",
    label: "Homepage section",
    icon: "SectionAdd",
    brief:
      "adds a homepage section showing yesterday's merged PRs and my review queue",
  },
  {
    id: "file-opener",
    label: "File opener",
    icon: "FileText",
    brief:
      "adds a file opener that renders CSV files as sortable, filterable tables",
  },
  {
    id: "cli-command",
    label: "CLI command",
    icon: "Terminal",
    brief:
      "adds a bb CLI command that deploys the current branch to staging and reports status",
  },
  {
    id: "background-service",
    label: "Background service",
    icon: "Zap",
    brief:
      "adds a background service that posts thread failures to a Slack webhook",
  },
  {
    id: "prompt-mentions",
    label: "Prompt mentions",
    icon: "MessageCirclePlus",
    brief: "connects Linear issues to the prompt box as searchable @-mentions",
  },
];

export function utilityPrompt(example: UtilityExample): string {
  return `${CREATE_PLUGIN_PROMPT}${example.brief}.`;
}

const COMPOSER_REQUEST_NONCE_KEY = "__bbBrowseComposerRequestNonce";
export function nextComposerRequestNonce(): number {
  const holder = globalThis as typeof globalThis & {
    [COMPOSER_REQUEST_NONCE_KEY]?: number;
  };
  const next = (holder[COMPOSER_REQUEST_NONCE_KEY] ?? 0) + 1;
  holder[COMPOSER_REQUEST_NONCE_KEY] = next;
  return next;
}

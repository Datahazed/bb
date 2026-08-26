import type { IconName } from "@bb/shared-ui/icon";
import { CREATE_PLUGIN_PROMPT } from "@bb/client-core";
import type { ShowcaseArchetype } from "@bb/showcase-hero";

export { BROWSE_ARCHETYPES } from "@bb/showcase-hero";

/**
 * The Browse hero's job is two questions answered in one glance: what can a
 * plugin do, and what would mine be? Each archetype carries a plain noun (what
 * bb becomes), a hook written as an outcome rather than an API, and the brief
 * that seeds the composer — the same prompt shape `create-via-prompt-examples`
 * uses, so the hero and the New plugin menu stay one voice.
 *
 * `capability` names the real slot or backend surface behind the scene so the
 * inspiration is checkable: every archetype here is buildable with the plugin
 * SDK as it ships today.
 *
 * The portable package owns the hero's archetypes. This app-local module adds
 * the bb composer prompt helpers and utility examples used around that hero.
 */
type BrowseArchetype = ShowcaseArchetype;

/** The full composer prompt for an archetype, matching the New plugin menu. */
export function archetypePrompt(archetype: BrowseArchetype): string {
  return `${CREATE_PLUGIN_PROMPT}${archetype.brief}.`;
}

/**
 * The second example tier: one small, concrete brief per plugin API surface.
 *
 * The archetypes above are outcome-shaped for someone deciding whether plugins
 * are worth their time; these are for the developer who already knows they
 * want "a panel" or "a CLI command" and needs the shortest path to seeding it.
 * Both tiers feed every create-plugin surface (hero cards, New plugin menu),
 * so the lists cannot drift apart.
 */
interface UtilityExample {
  id: string;
  /** The API surface this example exercises, in plain words. */
  label: string;
  icon: IconName;
  /** Completes CREATE_PLUGIN_PROMPT. */
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

/** The full composer prompt for a utility example. */
export function utilityPrompt(example: UtilityExample): string {
  return `${CREATE_PLUGIN_PROMPT}${example.brief}.`;
}

/**
 * Monotonic nonce for open-the-composer requests. Both producers (the page
 * header and the example cards) draw from one counter, so the hero can merge
 * the two channels by simple comparison instead of relaying through effects.
 *
 * The counter lives on `globalThis`: a module-level `let` re-evaluates to 0 on
 * HMR while React state holds higher nonces, making stale requests win the
 * newest-wins merge (close clicks stop closing during dev).
 */
const COMPOSER_REQUEST_NONCE_KEY = "__bbBrowseComposerRequestNonce";
export function nextComposerRequestNonce(): number {
  const holder = globalThis as typeof globalThis & {
    [COMPOSER_REQUEST_NONCE_KEY]?: number;
  };
  const next = (holder[COMPOSER_REQUEST_NONCE_KEY] ?? 0) + 1;
  holder[COMPOSER_REQUEST_NONCE_KEY] = next;
  return next;
}

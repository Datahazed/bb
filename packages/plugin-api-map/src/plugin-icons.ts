/**
 * The shipped bb plugins named in each surface's "Used by" list: their real
 * branding icon and their page in bb.
 *
 * Both come from the plugin's own package.json — `bb.branding.icon` resolved
 * through the same hugeicons set the app's icon registry uses, and the plugin
 * id that `/extensions/plugins/<id>` routes to. Provider plugins brand with
 * bundled SVG files the docs cannot import, so they share one provider glyph.
 */
import {
  ArrowReloadHorizontalIcon,
  BrainIcon,
  BrowserIcon,
  CheckListIcon,
  Clock01Icon,
  Coffee01Icon,
  Edit04Icon,
  File01Icon,
  GithubIcon,
  LockIcon,
  MessageAdd02Icon,
  MessageQuestionIcon,
  SmartPhone01Icon,
  SparklesIcon,
  WorkflowCircle03Icon,
} from "@hugeicons/core-free-icons";
import type { IconSvgElement } from "@hugeicons/react";

interface FirstPartyPlugin {
  /** Installed plugin id; the last segment of its page URL. */
  id: string;
  icon: IconSvgElement;
}

/** Keyed by the display name surfaces.ts lists in `firstParty`. */
const FIRST_PARTY_PLUGINS: Record<string, FirstPartyPlugin> = {
  "Ask User Question": { id: "ask-user-question", icon: MessageQuestionIcon },
  Automations: { id: "automations", icon: Clock01Icon },
  "Custom instructions": { id: "custom-instructions", icon: Edit04Icon },
  Docs: { id: "docs", icon: File01Icon },
  GitHub: { id: "github", icon: GithubIcon },
  "Inline visualizations": { id: "inline-vis", icon: BrowserIcon },
  "Keep Awake": { id: "keep-awake", icon: Coffee01Icon },
  Memory: { id: "memory", icon: BrainIcon },
  "Provider retry": { id: "provider-retry", icon: ArrowReloadHorizontalIcon },
  "Remote access": { id: "connect", icon: SmartPhone01Icon },
  Secrets: { id: "secrets", icon: LockIcon },
  "Side chat": { id: "side-chat", icon: MessageAdd02Icon },
  Tasks: { id: "tasks", icon: CheckListIcon },
  Workflows: { id: "workflows", icon: WorkflowCircle03Icon },
  "ACP providers": { id: "provider-acp", icon: SparklesIcon },
  "Claude Code provider": { id: "provider-claude-code", icon: SparklesIcon },
  "Codex provider": { id: "provider-codex", icon: SparklesIcon },
  "Pi provider": { id: "provider-pi", icon: SparklesIcon },
};

export function pluginIcon(displayName: string): IconSvgElement | null {
  return FIRST_PARTY_PLUGINS[displayName]?.icon ?? null;
}

/**
 * The installed-plugin id bb knows this plugin by, or null when the name is
 * not one of the shipped plugins.
 *
 * Deliberately NOT turned into a URL here. A plugin only has a page when the
 * running bb actually knows it (installed, or present in that host's
 * catalog), so whether to link is a question only the host can answer; see
 * `pluginPageHref` on ProductMap. Matching is by id rather than display name
 * because names collide: the community catalog ships a "Docs" plugin whose id
 * is `simple-notes`, which is a different plugin from bb's built-in Docs.
 */
export function firstPartyPluginId(displayName: string): string | null {
  return FIRST_PARTY_PLUGINS[displayName]?.id ?? null;
}
